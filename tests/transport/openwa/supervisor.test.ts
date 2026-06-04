import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/logging/logger";
import { createOpenWaConfig } from "../../../src/transport/openwa/client";
import { createOpenWaSupervisor } from "../../../src/transport/openwa/supervisor";
import type { OpenWaRuntimeClient } from "../../../src/transport/openwa/types";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createRuntimeClient = (): OpenWaRuntimeClient => ({
  onMessage: vi.fn().mockResolvedValue(undefined),
  sendText: vi.fn().mockResolvedValue(undefined),
  checkLiveness: vi.fn().mockResolvedValue({
    mode: "noop"
  }),
  kill: vi.fn().mockResolvedValue(true)
});

describe("openwa supervisor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in the starting state before client creation", () => {
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient: vi.fn(),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    expect(supervisor.getHealth()).toMatchObject({
      state: "starting",
      ready: false,
      startupAttempt: 0,
      startupAttempts: 0,
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      remainingStartupAttempts: 1,
      shutdownRequested: false,
      clientActive: false,
      listenerRegistered: false,
      livenessEnabled: true,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3,
      livenessFailureCount: 0
    });
  });

  it("moves to ready after client creation and listener registration", async () => {
    const logger = createLogger();
    const registerListener = vi.fn().mockResolvedValue(undefined);
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger,
      createClient: vi.fn().mockResolvedValue(createRuntimeClient()),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3,
      registerListener
    });

    await supervisor.start();

    expect(supervisor.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      startupAttempt: 1,
      startupAttempts: 1,
      remainingStartupAttempts: 0,
      clientActive: true,
      listenerRegistered: true,
      livenessEnabled: true,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3,
      livenessFailureCount: 0
    });
    expect(registerListener).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_ready", {
      startup_attempt: 1,
      startup_max_attempts: 1
    });
  });

  it("moves to degraded after startup failure", async () => {
    const logger = createLogger();
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger,
      createClient: vi.fn().mockRejectedValue(new Error("openwa_boot_failed")),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    await expect(supervisor.start()).rejects.toThrow("openwa_boot_failed");

    expect(supervisor.getHealth()).toMatchObject({
      state: "degraded",
      ready: false,
      startupAttempt: 1,
      startupAttempts: 1,
      remainingStartupAttempts: 0,
      clientActive: false,
      listenerRegistered: false,
      livenessEnabled: true,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3,
      livenessFailureCount: 0,
      lastError: "openwa_boot_failed"
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_supervisor_degraded", {
      startup_attempt: 1,
      startup_max_attempts: 1,
      startup_retry_delay_seconds: 5,
      will_retry: false,
      error: "openwa_boot_failed"
    });
  });

  it("stops retrying after the configured attempt limit", async () => {
    vi.useFakeTimers();

    const createClient = vi.fn().mockRejectedValue(new Error("openwa_boot_failed"));
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient,
      startupMaxAttempts: 3,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    const startPromise = supervisor.start();
    const startExpectation = expect(startPromise).rejects.toThrow("openwa_boot_failed");

    await vi.runAllTimersAsync();

    await startExpectation;
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(supervisor.getHealth().state).toBe("degraded");
  });

  it("stops the retry loop when shutdown is requested", async () => {
    vi.useFakeTimers();

    const createClient = vi.fn().mockRejectedValue(new Error("openwa_boot_failed"));
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient,
      startupMaxAttempts: 3,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    const startPromise = supervisor.start();
    const startExpectation = expect(startPromise).rejects.toThrow("openwa_startup_stopped");

    await Promise.resolve();
    await supervisor.stop("test_shutdown");
    await vi.runAllTimersAsync();

    await startExpectation;
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(supervisor.getHealth()).toMatchObject({
      state: "stopped",
      shutdownRequested: true,
      clientActive: false,
      listenerRegistered: false
    });
  });

  it("does not duplicate listener registration when a retry succeeds", async () => {
    vi.useFakeTimers();

    const registerListener = vi.fn().mockResolvedValue(undefined);
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockRejectedValueOnce(new Error("openwa_boot_failed"))
      .mockResolvedValueOnce(createRuntimeClient());
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient,
      startupMaxAttempts: 2,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3,
      registerListener
    });

    const startPromise = supervisor.start();

    await vi.advanceTimersByTimeAsync(5_000);
    await startPromise;

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(registerListener).toHaveBeenCalledTimes(1);
    expect(supervisor.getHealth()).toMatchObject({
      state: "ready",
      startupAttempts: 2,
      listenerRegistered: true
    });
  });

  it("starts liveness checks after ready and keeps the supervisor ready when heartbeat succeeds", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const checkLiveness = vi.fn().mockResolvedValue({
      mode: "read_only",
      connectionState: "CONNECTED",
      connected: true
    });
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger,
      createClient: vi.fn().mockResolvedValue({
        ...createRuntimeClient(),
        checkLiveness
      }),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(checkLiveness).toHaveBeenCalledTimes(1);
    expect(supervisor.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      livenessFailureCount: 0
    });
    expect(supervisor.getHealth().lastLivenessOkAt).toEqual(expect.any(String));
    expect(logger.info).toHaveBeenCalledWith("openwa_liveness_check_ok", {
      mode: "read_only",
      connectionState: "CONNECTED",
      connected: true,
      liveness_failure_count: 0,
      liveness_failure_threshold: 3,
      last_liveness_ok_at: expect.any(String)
    });
  });

  it("increments liveness failures and transitions from ready to degraded at the threshold", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const checkLiveness = vi.fn().mockRejectedValue(new Error("openwa_not_connected"));
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger,
      createClient: vi.fn().mockResolvedValue({
        ...createRuntimeClient(),
        checkLiveness
      }),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(checkLiveness).toHaveBeenCalledTimes(3);
    expect(supervisor.getHealth()).toMatchObject({
      state: "degraded",
      ready: false,
      livenessFailureCount: 3
    });
    expect(supervisor.getHealth().lastLivenessFailureAt).toEqual(expect.any(String));
    expect(logger.warn).toHaveBeenCalledWith("openwa_liveness_degraded", {
      error: "openwa_not_connected",
      liveness_failure_count: 3,
      liveness_failure_threshold: 3,
      last_liveness_failure_at: expect.any(String)
    });
  });

  it("recovers from degraded to ready after a successful liveness check", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const checkLiveness = vi
      .fn()
      .mockRejectedValueOnce(new Error("openwa_not_connected"))
      .mockRejectedValueOnce(new Error("openwa_not_connected"))
      .mockResolvedValueOnce({
        mode: "read_only",
        connectionState: "CONNECTED",
        connected: true
      });
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger,
      createClient: vi.fn().mockResolvedValue({
        ...createRuntimeClient(),
        checkLiveness
      }),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 2
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(supervisor.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      livenessFailureCount: 0
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_liveness_recovered", {
      mode: "read_only",
      connectionState: "CONNECTED",
      connected: true,
      last_liveness_ok_at: expect.any(String)
    });
  });

  it("stops the liveness timer on shutdown", async () => {
    vi.useFakeTimers();

    const checkLiveness = vi.fn().mockResolvedValue({
      mode: "noop"
    });
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient: vi.fn().mockResolvedValue({
        ...createRuntimeClient(),
        checkLiveness
      }),
      startupMaxAttempts: 1,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    await supervisor.start();
    await supervisor.stop("test_shutdown");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(checkLiveness).not.toHaveBeenCalled();
  });

  it("does not duplicate the liveness timer after a retry succeeds", async () => {
    vi.useFakeTimers();

    const checkLiveness = vi.fn().mockResolvedValue({
      mode: "noop"
    });
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockRejectedValueOnce(new Error("openwa_boot_failed"))
      .mockResolvedValueOnce({
        ...createRuntimeClient(),
        checkLiveness
      });
    const supervisor = createOpenWaSupervisor({
      config: createOpenWaConfig({
        sessionId: "legalbot-smoke"
      }),
      logger: createLogger(),
      createClient,
      startupMaxAttempts: 2,
      startupRetryDelaySeconds: 5,
      livenessIntervalSeconds: 30,
      livenessFailureThreshold: 3
    });

    const startPromise = supervisor.start();

    await vi.advanceTimersByTimeAsync(5_000);
    await startPromise;

    checkLiveness.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(checkLiveness).toHaveBeenCalledTimes(1);
  });
});

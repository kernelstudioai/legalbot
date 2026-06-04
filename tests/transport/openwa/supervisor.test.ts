import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/logging/logger";
import { createOpenWaConfig } from "../../../src/transport/openwa/client";
import {
  createOpenWaSupervisor,
  type OpenWaRecoveryMode,
  type OpenWaSupervisorDependencies
} from "../../../src/transport/openwa/supervisor";
import type { OpenWaRuntimeClient } from "../../../src/transport/openwa/types";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createRuntimeClient = (
  overrides: Partial<OpenWaRuntimeClient> = {}
): OpenWaRuntimeClient => ({
  onMessage: vi.fn().mockResolvedValue(undefined),
  sendText: vi.fn().mockResolvedValue(undefined),
  checkLiveness: vi.fn().mockResolvedValue({
    mode: "noop"
  }),
  kill: vi.fn().mockResolvedValue(true),
  ...overrides
});

interface CreateSupervisorOptions {
  logger?: Logger;
  createClient?: OpenWaSupervisorDependencies["createClient"];
  startupMaxAttempts?: number;
  startupRetryDelaySeconds?: number;
  livenessIntervalSeconds?: number;
  livenessFailureThreshold?: number;
  recoveryMode?: OpenWaRecoveryMode;
  recoveryMaxAttempts?: number;
  recoveryRetryDelaySeconds?: number;
  registerListener?: OpenWaSupervisorDependencies["registerListener"];
}

const createSupervisor = ({
  logger = createLogger(),
  createClient = vi.fn().mockResolvedValue(createRuntimeClient()),
  startupMaxAttempts = 1,
  startupRetryDelaySeconds = 5,
  livenessIntervalSeconds = 30,
  livenessFailureThreshold = 3,
  recoveryMode = "manual",
  recoveryMaxAttempts,
  recoveryRetryDelaySeconds = 10,
  registerListener = vi.fn().mockResolvedValue(undefined)
}: CreateSupervisorOptions = {}) =>
  createOpenWaSupervisor({
    config: createOpenWaConfig({
      sessionId: "legalbot-smoke"
    }),
    logger,
    createClient,
    startupMaxAttempts,
    startupRetryDelaySeconds,
    livenessIntervalSeconds,
    livenessFailureThreshold,
    recoveryMode,
    ...(recoveryMaxAttempts !== undefined ? { recoveryMaxAttempts } : {}),
    recoveryRetryDelaySeconds,
    registerListener
  });

describe("openwa supervisor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in the starting state before client creation", () => {
    const supervisor = createSupervisor({
      createClient: vi.fn()
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
      livenessFailureCount: 0,
      recoveryMode: "manual",
      recoveryAttempt: 0,
      recoveryMaxAttempts: 0,
      recoveryInProgress: false,
      recoveryRetryDelaySeconds: 10
    });
  });

  it("moves to ready after client creation and listener registration", async () => {
    const logger = createLogger();
    const registerListener = vi.fn().mockResolvedValue(undefined);
    const supervisor = createSupervisor({
      logger,
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
      livenessFailureCount: 0,
      recoveryMode: "manual",
      recoveryAttempt: 0,
      recoveryMaxAttempts: 0,
      recoveryInProgress: false
    });
    expect(registerListener).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("openwa_supervisor_ready", {
      startup_attempt: 1,
      startup_max_attempts: 1
    });
  });

  it("moves to degraded after startup failure", async () => {
    const logger = createLogger();
    const supervisor = createSupervisor({
      logger,
      createClient: vi.fn().mockRejectedValue(new Error("openwa_boot_failed"))
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
      lastError: "openwa_boot_failed",
      recoveryAttempt: 0,
      recoveryInProgress: false
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_supervisor_degraded", {
      startup_attempt: 1,
      startup_max_attempts: 1,
      startup_retry_delay_seconds: 5,
      will_retry: false,
      error: "openwa_boot_failed"
    });
  });

  it("stops retrying after the configured startup attempt limit", async () => {
    vi.useFakeTimers();

    const createClient = vi.fn().mockRejectedValue(new Error("openwa_boot_failed"));
    const supervisor = createSupervisor({
      createClient,
      startupMaxAttempts: 3
    });

    const startPromise = supervisor.start();
    const startExpectation = expect(startPromise).rejects.toThrow("openwa_boot_failed");

    await vi.runAllTimersAsync();

    await startExpectation;
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(supervisor.getHealth().state).toBe("degraded");
  });

  it("stops the startup retry loop when shutdown is requested", async () => {
    vi.useFakeTimers();

    const createClient = vi.fn().mockRejectedValue(new Error("openwa_boot_failed"));
    const supervisor = createSupervisor({
      createClient,
      startupMaxAttempts: 3
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

  it("does not duplicate listener registration when a startup retry succeeds", async () => {
    vi.useFakeTimers();

    const registerListener = vi.fn().mockResolvedValue(undefined);
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockRejectedValueOnce(new Error("openwa_boot_failed"))
      .mockResolvedValueOnce(createRuntimeClient());
    const supervisor = createSupervisor({
      createClient,
      startupMaxAttempts: 2,
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
    const supervisor = createSupervisor({
      logger,
      createClient: vi.fn().mockResolvedValue(
        createRuntimeClient({
          checkLiveness
        })
      )
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

  it("increments liveness failures and logs manual recovery required without restarting", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const client = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const createClient = vi.fn().mockResolvedValue(client);
    const supervisor = createSupervisor({
      logger,
      createClient,
      livenessFailureThreshold: 3,
      recoveryMode: "manual"
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(supervisor.getHealth()).toMatchObject({
      state: "degraded",
      ready: false,
      livenessFailureCount: 3,
      recoveryMode: "manual",
      recoveryAttempt: 0,
      recoveryMaxAttempts: 0,
      recoveryInProgress: false
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_liveness_degraded", {
      error: "openwa_not_connected",
      liveness_failure_count: 3,
      liveness_failure_threshold: 3,
      last_liveness_failure_at: expect.any(String)
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_recovery_required", {
      recovery_mode: "manual",
      recovery_attempt: 0,
      recovery_max_attempts: 0,
      recovery_retry_delay_seconds: 10,
      last_liveness_failure_at: expect.any(String),
      error: "openwa_not_connected"
    });
  });

  it("recovers from degraded to ready after a later successful liveness check", async () => {
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
    const supervisor = createSupervisor({
      logger,
      createClient: vi.fn().mockResolvedValue(
        createRuntimeClient({
          checkLiveness
        })
      ),
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

  it("restart_client mode kills the old client and creates a new client", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const secondClient = createRuntimeClient();
    const registerListener = vi.fn().mockResolvedValue(undefined);
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const supervisor = createSupervisor({
      logger,
      createClient,
      registerListener,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 1,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(firstClient.kill).toHaveBeenCalledWith("openwa_recovery_restart_client");
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(registerListener).toHaveBeenCalledTimes(2);
    expect(supervisor.getHealth()).toMatchObject({
      state: "ready",
      ready: true,
      recoveryMode: "restart_client",
      recoveryAttempt: 1,
      recoveryMaxAttempts: 1,
      recoveryInProgress: false,
      lastRecoveryStartedAt: expect.any(String),
      lastRecoverySucceededAt: expect.any(String)
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_recovery_starting", {
      recovery_attempt: 1,
      recovery_max_attempts: 1,
      recovery_retry_delay_seconds: 10,
      last_recovery_started_at: expect.any(String)
    });
    expect(logger.info).toHaveBeenCalledWith("openwa_recovery_succeeded", {
      recovery_attempt: 1,
      recovery_max_attempts: 1,
      last_recovery_started_at: expect.any(String),
      last_recovery_succeeded_at: expect.any(String)
    });
  });

  it("recovery failure increments the attempt counter and exposes the failure timestamp", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockRejectedValueOnce(new Error("openwa_recovery_boot_failed"));
    const supervisor = createSupervisor({
      logger,
      createClient,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 2,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(supervisor.getHealth()).toMatchObject({
      state: "degraded",
      recoveryAttempt: 1,
      recoveryMaxAttempts: 2,
      recoveryInProgress: false,
      lastRecoveryStartedAt: expect.any(String),
      lastRecoveryFailedAt: expect.any(String),
      lastError: "openwa_recovery_boot_failed"
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_recovery_attempt_failed", {
      recovery_attempt: 1,
      recovery_max_attempts: 2,
      recovery_retry_delay_seconds: 10,
      last_recovery_started_at: expect.any(String),
      last_recovery_failed_at: expect.any(String),
      error: "openwa_recovery_boot_failed"
    });
  });

  it("recovery exhausted stays degraded", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockRejectedValueOnce(new Error("openwa_recovery_boot_failed"));
    const supervisor = createSupervisor({
      logger,
      createClient,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 1,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(supervisor.getHealth()).toMatchObject({
      state: "degraded",
      ready: false,
      recoveryAttempt: 1,
      recoveryMaxAttempts: 1,
      recoveryInProgress: false,
      clientActive: false
    });
    expect(logger.warn).toHaveBeenCalledWith("openwa_recovery_exhausted", {
      recovery_attempt: 1,
      recovery_max_attempts: 1,
      recovery_retry_delay_seconds: 10,
      state: "degraded"
    });
  });

  it("shutdown cancels pending recovery", async () => {
    vi.useFakeTimers();

    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(createRuntimeClient());
    const supervisor = createSupervisor({
      createClient,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 1,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await supervisor.stop("test_shutdown");
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(supervisor.getHealth()).toMatchObject({
      state: "stopped",
      shutdownRequested: true,
      recoveryInProgress: false
    });
  });

  it("does not duplicate listener registration after recovery", async () => {
    vi.useFakeTimers();

    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const secondClient = createRuntimeClient();
    const registerListener = vi.fn().mockResolvedValue(undefined);
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    const supervisor = createSupervisor({
      createClient,
      registerListener,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 1,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(registerListener).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate the liveness timer after recovery", async () => {
    vi.useFakeTimers();

    const firstClient = createRuntimeClient({
      checkLiveness: vi.fn().mockRejectedValue(new Error("openwa_not_connected"))
    });
    const secondCheckLiveness = vi.fn().mockResolvedValue({
      mode: "noop"
    });
    const createClient = vi
      .fn<() => Promise<OpenWaRuntimeClient>>()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(
        createRuntimeClient({
          checkLiveness: secondCheckLiveness
        })
      );
    const supervisor = createSupervisor({
      createClient,
      livenessFailureThreshold: 1,
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 1,
      recoveryRetryDelaySeconds: 10
    });

    await supervisor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    secondCheckLiveness.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(secondCheckLiveness).toHaveBeenCalledTimes(1);
  });

  it("getHealth exposes recovery fields", async () => {
    const supervisor = createSupervisor({
      recoveryMode: "restart_client",
      recoveryMaxAttempts: 3,
      recoveryRetryDelaySeconds: 12
    });

    await supervisor.start();

    expect(supervisor.getHealth()).toMatchObject({
      recoveryMode: "restart_client",
      recoveryAttempt: 0,
      recoveryMaxAttempts: 3,
      recoveryInProgress: false,
      recoveryRetryDelaySeconds: 12
    });
  });
});

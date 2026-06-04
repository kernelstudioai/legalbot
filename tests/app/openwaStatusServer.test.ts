import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger";
import {
  sanitizeSupervisorHealth,
  startOpenWaStatusServer
} from "../../src/app/openwaStatusServer";
import type { OpenWaSupervisorHealth } from "../../src/transport/openwa/supervisor";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createHealth = (
  overrides: Partial<OpenWaSupervisorHealth> = {}
): OpenWaSupervisorHealth => ({
  state: "ready",
  ready: true,
  startupAttempt: 1,
  startupAttempts: 1,
  startupMaxAttempts: 1,
  startupRetryDelaySeconds: 5,
  remainingStartupAttempts: 0,
  shutdownRequested: false,
  clientActive: true,
  listenerRegistered: true,
  livenessEnabled: true,
  livenessIntervalSeconds: 30,
  livenessFailureThreshold: 3,
  livenessFailureCount: 0,
  recoveryMode: "manual",
  recoveryAttempt: 0,
  recoveryMaxAttempts: 0,
  recoveryInProgress: false,
  recoveryRetryDelaySeconds: 10,
  ...overrides
});

const getJson = async (url: string) => {
  const response = await fetch(url);
  return {
    response,
    json: await response.json()
  };
};

describe("openwa status server", () => {
  const activeServers: Array<{ stop(): Promise<void> }> = [];

  afterEach(async () => {
    while (activeServers.length > 0) {
      await activeServers.pop()?.stop();
    }
  });

  it("returns an alive sanitized health response", async () => {
    const server = await startOpenWaStatusServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0
      },
      logger: createLogger(),
      getHealth: () =>
        createHealth({
          lastError:
            "browser failed at C:\\Users\\Jacopo\\Documents\\legalbot\\openwa-session while sending body hello to +15551234567"
        })
    });
    activeServers.push(server);

    const { response, json } = await getJson(
      `http://${server.address?.host}:${server.address?.port}/health`
    );

    expect(response.status).toBe(200);
    expect(json).toEqual({
      alive: true,
      transport: {
        state: "ready",
        ready: true,
        shutdownRequested: false,
        clientActive: true,
        listenerRegistered: true,
        livenessEnabled: true,
        livenessFailureCount: 0,
        recoveryMode: "manual",
        recoveryInProgress: false
      }
    });
  });

  it("returns 200 on ready only when the supervisor is ready", async () => {
    const readyServer = await startOpenWaStatusServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0
      },
      logger: createLogger(),
      getHealth: () => createHealth()
    });
    activeServers.push(readyServer);

    const degradedServer = await startOpenWaStatusServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0
      },
      logger: createLogger(),
      getHealth: () =>
        createHealth({
          state: "degraded",
          ready: false,
          livenessFailureCount: 3
        })
    });
    activeServers.push(degradedServer);

    const readyResult = await getJson(
      `http://${readyServer.address?.host}:${readyServer.address?.port}/ready`
    );
    const degradedResult = await getJson(
      `http://${degradedServer.address?.host}:${degradedServer.address?.port}/ready`
    );

    expect(readyResult.response.status).toBe(200);
    expect(readyResult.json).toEqual({
      ready: true,
      state: "ready"
    });
    expect(degradedResult.response.status).toBe(503);
    expect(degradedResult.json).toEqual({
      ready: false,
      state: "degraded"
    });
  });

  it("returns the full sanitized supervisor health object", async () => {
    const health = createHealth({
      state: "degraded",
      ready: false,
      recoveryMode: "restart_client",
      recoveryAttempt: 1,
      recoveryMaxAttempts: 2,
      recoveryInProgress: true,
      lastError:
        "browser failed at C:\\Users\\Jacopo\\AppData\\Local\\Chrome with qr token and body hello for +15551234567"
    });
    const server = await startOpenWaStatusServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0
      },
      logger: createLogger(),
      getHealth: () => health
    });
    activeServers.push(server);

    const { response, json } = await getJson(
      `http://${server.address?.host}:${server.address?.port}/status`
    );

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ...health,
      lastError: "redacted_sensitive_error"
    });
    expect(JSON.stringify(json)).not.toContain("AppData");
    expect(JSON.stringify(json)).not.toContain("+15551234567");
    expect(JSON.stringify(json)).not.toContain("body hello");
  });

  it("closes the status server on shutdown", async () => {
    const logger = createLogger();
    const server = await startOpenWaStatusServer({
      config: {
        enabled: true,
        host: "127.0.0.1",
        port: 0
      },
      logger,
      getHealth: () => createHealth()
    });

    const url = `http://${server.address?.host}:${server.address?.port}/health`;
    await expect(fetch(url)).resolves.toBeDefined();

    await server.stop();

    await expect(fetch(url)).rejects.toThrow();
    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_stopped", {
      host: server.address?.host,
      port: server.address?.port
    });
  });

  it("sanitizes sensitive lastError values and preserves safe ones", () => {
    expect(
      sanitizeSupervisorHealth(
        createHealth({
          lastError: "openwa_not_connected"
        })
      ).lastError
    ).toBe("openwa_not_connected");

    expect(
      sanitizeSupervisorHealth(
        createHealth({
          lastError: "browser path C:\\Users\\Jacopo\\Chrome"
        })
      ).lastError
    ).toBe("redacted_sensitive_error");
  });
});

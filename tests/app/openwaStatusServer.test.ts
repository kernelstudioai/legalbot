import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger";
import {
  createOpenWaStatusServerHandler,
  sanitizeSupervisorHealth,
  startOpenWaStatusServer,
  type OpenWaStatusHttpServer
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

const invokeHandler = (
  path: string,
  getHealth: () => OpenWaSupervisorHealth,
  method = "GET"
) => {
  const handler = createOpenWaStatusServerHandler(getHealth);
  const headers = new Map<string, string>();
  let payload = "";
  const responseState: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(chunk?: string): void;
  } = {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(chunk = "") {
      payload = chunk;
    }
  };
  const request = {
    method,
    url: path
  } as IncomingMessage;

  handler(request, responseState as unknown as ServerResponse);

  return {
    headers,
    payload: JSON.parse(payload),
    statusCode: responseState.statusCode
  };
};

const createFakeHttpServer = (options?: {
  address?: AddressInfo;
  listenError?: Error;
}) => {
  const onceListeners = new Map<"error" | "listening", (...args: any[]) => void>();
  const address =
    options?.address ??
    ({
      address: "127.0.0.1",
      family: "IPv4",
      port: 4010
    } satisfies AddressInfo);

  const server: OpenWaStatusHttpServer = {
    once(event, listener) {
      onceListeners.set(event, listener);
      return this;
    },
    off(event, listener) {
      const current = onceListeners.get(event);

      if (current === listener) {
        onceListeners.delete(event);
      }

      return this;
    },
    listen() {
      if (options?.listenError) {
        onceListeners.get("error")?.(options.listenError);
        onceListeners.delete("error");
        return this;
      }

      onceListeners.get("listening")?.();
      onceListeners.delete("listening");
      return this;
    },
    address() {
      return address;
    },
    close(callback) {
      callback();
      return this;
    }
  };

  return server;
};

describe("openwa status server", () => {
  it("returns an alive sanitized health response", () => {
    const { headers, payload, statusCode } = invokeHandler("/health", () =>
      createHealth({
        lastError:
          "browser failed at C:\\Users\\Jacopo\\Documents\\legalbot\\openwa-session while sending body hello to +15551234567"
      })
    );

    expect(statusCode).toBe(200);
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(payload).toEqual({
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

  it("returns 200 on ready only when the supervisor is ready", () => {
    const readyResult = invokeHandler("/ready", () => createHealth());
    const degradedResult = invokeHandler("/ready", () =>
      createHealth({
        state: "degraded",
        ready: false,
        livenessFailureCount: 3
      })
    );

    expect(readyResult.statusCode).toBe(200);
    expect(readyResult.payload).toEqual({
      ready: true,
      state: "ready"
    });
    expect(degradedResult.statusCode).toBe(503);
    expect(degradedResult.payload).toEqual({
      ready: false,
      state: "degraded"
    });
  });

  it("returns the full sanitized supervisor health object", () => {
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
    const { payload, statusCode } = invokeHandler("/status", () => health);

    expect(statusCode).toBe(200);
    expect(payload).toEqual({
      ...health,
      lastError: "redacted_sensitive_error"
    });
    expect(JSON.stringify(payload)).not.toContain("AppData");
    expect(JSON.stringify(payload)).not.toContain("+15551234567");
    expect(JSON.stringify(payload)).not.toContain("body hello");
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
      getHealth: () => createHealth(),
      createHttpServer: () =>
        createFakeHttpServer({
          address: {
            address: "127.0.0.1",
            family: "IPv4",
            port: 4011
          }
        })
    });

    await server.stop();

    expect(logger.info).toHaveBeenCalledWith("openwa_status_server_stopped", {
      host: "127.0.0.1",
      port: 4011
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

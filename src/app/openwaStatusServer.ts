import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../logging/logger.ts";
import type { OpenWaSupervisorHealth } from "../transport/openwa/supervisor.ts";

export interface OpenWaStatusServerConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export interface OpenWaStatusServerAddress {
  host: string;
  port: number;
}

export interface OpenWaStatusServer {
  enabled: boolean;
  address?: OpenWaStatusServerAddress;
  stop(): Promise<void>;
}

export interface OpenWaStatusHttpServer {
  once(event: "error" | "listening", listener: (...args: any[]) => void): this;
  off(event: "error" | "listening", listener: (...args: any[]) => void): this;
  listen(port: number, host: string): this;
  address(): ReturnType<Server["address"]>;
  close(callback: (error?: Error | undefined) => void): this;
}

export interface StartOpenWaStatusServerOptions {
  config: OpenWaStatusServerConfig;
  logger: Logger;
  getHealth: () => OpenWaSupervisorHealth;
  createHttpServer?: (
    handler: (request: IncomingMessage, response: ServerResponse) => void
  ) => OpenWaStatusHttpServer;
}

type HealthStatusResponse = {
  alive: true;
  transport: Pick<
    OpenWaSupervisorHealth,
    | "state"
    | "ready"
    | "shutdownRequested"
    | "clientActive"
    | "listenerRegistered"
    | "livenessEnabled"
    | "livenessFailureCount"
    | "recoveryMode"
    | "recoveryInProgress"
  >;
};

const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s"]+/;
const POSIX_PATH_PATTERN = /\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session)[^\s"]*/i;
const PHONE_PATTERN = /\+[1-9]\d{7,14}/;
const SENSITIVE_ERROR_PATTERN =
  /(session|qr|token|secret|browser|body|message|profile|cookie|auth)/i;

const sanitizeLastError = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (
    WINDOWS_PATH_PATTERN.test(value) ||
    POSIX_PATH_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
    SENSITIVE_ERROR_PATTERN.test(value)
  ) {
    return "redacted_sensitive_error";
  }

  return value;
};

export const sanitizeSupervisorHealth = (
  health: OpenWaSupervisorHealth
): OpenWaSupervisorHealth => ({
  ...health,
  ...(health.lastError !== undefined
    ? { lastError: sanitizeLastError(health.lastError) ?? "redacted_sensitive_error" }
    : {})
});

const createHealthResponse = (health: OpenWaSupervisorHealth): HealthStatusResponse => ({
  alive: true,
  transport: {
    state: health.state,
    ready: health.ready,
    shutdownRequested: health.shutdownRequested,
    clientActive: health.clientActive,
    listenerRegistered: health.listenerRegistered,
    livenessEnabled: health.livenessEnabled,
    livenessFailureCount: health.livenessFailureCount,
    recoveryMode: health.recoveryMode,
    recoveryInProgress: health.recoveryInProgress
  }
});

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const handleRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  getHealth: () => OpenWaSupervisorHealth
): void => {
  if (request.method !== "GET") {
    writeJson(response, 405, {
      error: "method_not_allowed"
    });
    return;
  }

  const path = request.url ?? "/";
  const health = sanitizeSupervisorHealth(getHealth());

  switch (path) {
    case "/health":
      writeJson(response, 200, createHealthResponse(health));
      return;
    case "/ready":
      writeJson(response, health.ready ? 200 : 503, {
        ready: health.ready,
        state: health.state
      });
      return;
    case "/status":
      writeJson(response, 200, health);
      return;
    default:
      writeJson(response, 404, {
        error: "not_found"
      });
  }
};

export const createOpenWaStatusServerHandler = (
  getHealth: () => OpenWaSupervisorHealth
): ((request: IncomingMessage, response: ServerResponse) => void) => {
  return (request, response) => {
    handleRequest(request, response, getHealth);
  };
};

const getServerAddress = (
  server: OpenWaStatusHttpServer,
  configuredHost: string
): OpenWaStatusServerAddress => {
  const address = server.address();

  if (!address || typeof address === "string") {
    return {
      host: configuredHost,
      port: 0
    };
  }

  const serverAddress = address as AddressInfo;

  return {
    host: configuredHost,
    port: serverAddress.port
  };
};

const createDisabledStatusServer = (): OpenWaStatusServer => ({
  enabled: false,
  async stop() {
    return undefined;
  }
});

export const startOpenWaStatusServer = async ({
  config,
  logger,
  getHealth,
  createHttpServer = createServer
}: StartOpenWaStatusServerOptions): Promise<OpenWaStatusServer> => {
  if (!config.enabled) {
    return createDisabledStatusServer();
  }

  logger.info("openwa_status_server_starting", {
    host: config.host,
    port: config.port
  });

  const server = createHttpServer(createOpenWaStatusServerHandler(getHealth));

  const address = await new Promise<OpenWaStatusServerAddress>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      logger.error("openwa_status_server_failed", {
        host: config.host,
        port: config.port,
        error: error.message
      });
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      const nextAddress = getServerAddress(server, config.host);
      logger.info("openwa_status_server_ready", {
        host: nextAddress.host,
        port: nextAddress.port
      });
      resolve(nextAddress);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  let stopPromise: Promise<void> | undefined;

  return {
    enabled: true,
    address,
    async stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          logger.info("openwa_status_server_stopped", {
            host: address.host,
            port: address.port
          });
          resolve();
        });
      });

      return stopPromise;
    }
  };
};

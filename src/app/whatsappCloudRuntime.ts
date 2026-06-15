import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import {
  isProductionNodeEnv,
  loadWhatsAppCloudRuntimeEnv,
  type WhatsAppCloudRuntimeEnv
} from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  assertSqliteMigrationsApplied
} from "../persistence/sqlite/index.ts";
import {
  createBusinessPersistenceService,
  createSqliteBusinessPersistenceServiceFromPersistence,
  createSqlitePersistenceService,
  type BusinessPersistenceService,
  type PersistenceService,
  type SqlitePersistenceService
} from "../persistence/index.ts";
import type {
  ClientConsentPersistence,
  ClientIntakePersistence
} from "../runtime/client/clientRuntime.ts";
import { runInboundPipeline, type PipelineResult } from "./pipeline.ts";
import {
  DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
  createWhatsAppCloudDispatcher,
  createWhatsAppCloudSender,
  parseWhatsAppCloudWebhookPayload,
  validateWhatsAppCloudSignature,
  verifyWhatsAppCloudWebhook,
  type WhatsAppCloudDispatcher,
  type WhatsAppCloudHttpClient
} from "../transport/whatsapp-cloud/index.ts";
import type { TransportInboundMessage } from "../transport/inboundMessage.ts";

const REDACTED_PHONE = "[redacted-phone]";
const HEALTH_PATH = "/health";
const READY_PATH = "/ready";
const STATUS_PATH = "/status";

export interface WhatsAppCloudRuntime {
  env: WhatsAppCloudRuntimeEnv;
  getServerAddress(): AddressInfo | undefined;
  stop(reason?: string): Promise<void>;
}

export interface StartWhatsAppCloudRuntimeOptions {
  cwd?: string;
  createHttpServer?: (
    handler: (request: IncomingMessage, response: ServerResponse) => void
  ) => WhatsAppCloudHttpServer;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  persistenceService?: PersistenceService;
  businessPersistenceService?: BusinessPersistenceService;
  clientConsentPersistence?: ClientConsentPersistence;
  clientIntakePersistence?: ClientIntakePersistence;
  createSqlitePersistence?: (config: {
    databaseUrl: string;
    cwd?: string;
  }) => SqlitePersistenceService;
  createBusinessPersistence?: (
    persistenceService: PersistenceService
  ) => BusinessPersistenceService;
  httpClient?: WhatsAppCloudHttpClient;
}

export interface WhatsAppCloudHttpServer {
  once(event: "error", listener: (error: Error) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  listen(port: number, host: string, callback: () => void): this;
  address(): ReturnType<ReturnType<typeof createServer>["address"]>;
  close(callback: (error?: Error | undefined) => void): this;
}

export interface CreateWhatsAppCloudWebhookRequestHandlerOptions {
  appSecret?: string;
  dispatcher: WhatsAppCloudDispatcher;
  logger: Logger;
  markMessageProcessed?: (
    messageId: string
  ) => Promise<void>;
  path?: string;
  pipelineRunner?: (
    message: TransportInboundMessage
  ) => Promise<PipelineResult>;
  verifyToken: string;
  wasMessageProcessed?: (messageId: string) => Promise<boolean>;
}

const writeResponse = (
  response: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
): void => {
  response.writeHead(statusCode, headers);
  response.end(body);
};

const writeJsonResponse = (
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void => {
  writeResponse(response, statusCode, JSON.stringify(body), {
    "Content-Type": "application/json; charset=utf-8"
  });
};

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const isSqlitePersistenceService = (
  persistenceService: PersistenceService
): persistenceService is SqlitePersistenceService =>
  "databasePath" in persistenceService &&
  "close" in persistenceService &&
  typeof persistenceService.close === "function";

const getCloudSignatureVerificationMode = (
  env: WhatsAppCloudRuntimeEnv
): "enforced" | "optional" => (env.WHATSAPP_CLOUD_APP_SECRET ? "enforced" : "optional");

const createCloudRuntimeStatus = (env: WhatsAppCloudRuntimeEnv): Record<string, unknown> => ({
  transport: env.WHATSAPP_TRANSPORT,
  kind: env.WHATSAPP_TRANSPORT,
  state: "ready",
  ready: true,
  signatureVerification: getCloudSignatureVerificationMode(env),
  webhookPath: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH
});

export const createWhatsAppCloudWebhookRequestHandler = ({
  appSecret,
  dispatcher,
  logger,
  markMessageProcessed,
  path = DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
  pipelineRunner = (message) => runInboundPipeline(message),
  verifyToken,
  wasMessageProcessed
}: CreateWhatsAppCloudWebhookRequestHandlerOptions) => {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname !== path) {
      writeResponse(response, 404, "Not Found");
      return;
    }

    if (method === "GET") {
      const verificationResult = verifyWhatsAppCloudWebhook(
        {
          "hub.mode": url.searchParams.get("hub.mode") ?? undefined,
          "hub.verify_token": url.searchParams.get("hub.verify_token") ?? undefined,
          "hub.challenge": url.searchParams.get("hub.challenge") ?? undefined
        },
        verifyToken
      );

      if (verificationResult.verified) {
        logger.info("whatsapp_cloud_webhook_verified", {
          path
        });
      } else {
        logger.warn("whatsapp_cloud_webhook_verification_failed", {
          path
        });
      }

      writeResponse(response, verificationResult.statusCode, verificationResult.body, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      return;
    }

    if (method !== "POST") {
      writeResponse(response, 405, "Method Not Allowed");
      return;
    }

    const rawBody = await readRequestBody(request);

    if (
      !validateWhatsAppCloudSignature({
        appSecret,
        rawBody,
        signatureHeader: request.headers["x-hub-signature-256"]
      })
    ) {
      logger.warn("whatsapp_cloud_signature_invalid", {
        path,
        app_secret_configured: Boolean(appSecret)
      });
      writeResponse(response, 401, "Unauthorized");
      return;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.warn("whatsapp_cloud_payload_invalid_json", {
        path
      });
      writeResponse(response, 400, "Bad Request");
      return;
    }

    const parsedWebhook = parseWhatsAppCloudWebhookPayload(payload);

    if (parsedWebhook.statusEventCount > 0) {
      logger.info("whatsapp_cloud_status_events_ignored", {
        count: parsedWebhook.statusEventCount
      });
    }

    if (parsedWebhook.unsupportedMessageCount > 0) {
      logger.info("whatsapp_cloud_unsupported_messages_ignored", {
        count: parsedWebhook.unsupportedMessageCount
      });
    }

    for (const message of parsedWebhook.messages) {
      if (wasMessageProcessed && (await wasMessageProcessed(message.id))) {
        logger.info("whatsapp_cloud_message_ignored_duplicate", {
          messageId: message.id
        });
        continue;
      }

      logger.info("whatsapp_cloud_message_received", {
        messageId: message.id
      });

      const pipelineResult = await pipelineRunner(message);
      const dispatchResult = await dispatcher.dispatch(pipelineResult.outputPlan);

      logger.info("whatsapp_cloud_output_dispatched", {
        messageId: message.id,
        outputCount: pipelineResult.outputPlan.messages.length,
        dispatchedCount: dispatchResult.messageCount,
        unsupportedCount: dispatchResult.unsupportedCount
      });

      if (markMessageProcessed) {
        await markMessageProcessed(message.id);
      }
    }

    writeResponse(response, 200, "EVENT_RECEIVED", {
      "Content-Type": "text/plain; charset=utf-8"
    });
  };
};

export const startWhatsAppCloudRuntime = async ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  persistenceService,
  businessPersistenceService,
  clientConsentPersistence,
  clientIntakePersistence,
  createSqlitePersistence = createSqlitePersistenceService,
  createBusinessPersistence = createBusinessPersistenceService,
  createHttpServer = createServer,
  httpClient
}: StartWhatsAppCloudRuntimeOptions = {}): Promise<WhatsAppCloudRuntime> => {
  const env = loadWhatsAppCloudRuntimeEnv(envSource);

  if (isProductionNodeEnv(envSource) && !env.WHATSAPP_CLOUD_APP_SECRET) {
    throw new Error(
      "WHATSAPP_CLOUD_APP_SECRET is required when NODE_ENV=production for the WhatsApp Cloud runtime."
    );
  }

  if (env.BUSINESS_PERSISTENCE_ENABLED !== true) {
    throw new Error(
      "Business persistence is required for the WhatsApp Cloud runtime. Enable BUSINESS_PERSISTENCE_ENABLED before startup."
    );
  }

  const needsDerivedBusinessPersistence =
    businessPersistenceService === undefined &&
    (clientConsentPersistence === undefined || clientIntakePersistence === undefined);
  const shouldCreateSharedPersistence =
    persistenceService === undefined && needsDerivedBusinessPersistence;
  const sharedPersistenceService =
    persistenceService ??
    (shouldCreateSharedPersistence
      ? (() => {
          assertSqliteMigrationsApplied({
            databaseUrl: env.DATABASE_URL,
            cwd
          });
          return createSqlitePersistence({
            databaseUrl: env.DATABASE_URL,
            cwd
          });
        })()
      : undefined);
  const shouldClosePersistence =
    sharedPersistenceService !== undefined && persistenceService === undefined;
  const defaultBusinessPersistence =
    businessPersistenceService ??
    (sharedPersistenceService
      ? isSqlitePersistenceService(sharedPersistenceService)
        ? createSqliteBusinessPersistenceServiceFromPersistence(sharedPersistenceService)
        : createBusinessPersistence(sharedPersistenceService)
      : undefined);
  const resolvedConsentPersistence =
    clientConsentPersistence ?? defaultBusinessPersistence;
  const resolvedIntakePersistence =
    clientIntakePersistence ?? defaultBusinessPersistence;

  if (!resolvedConsentPersistence || !resolvedIntakePersistence) {
    throw new Error(
      "Business persistence is required for the WhatsApp Cloud runtime. Provide explicit consent and intake persistence before startup."
    );
  }

  const closeSharedPersistence = () => {
    if (
      shouldClosePersistence &&
      sharedPersistenceService &&
      "close" in sharedPersistenceService &&
      typeof sharedPersistenceService.close === "function"
    ) {
      sharedPersistenceService.close();
    }
  };

  const sender = createWhatsAppCloudSender({
    accessToken: env.WHATSAPP_CLOUD_ACCESS_TOKEN,
    apiVersion: env.WHATSAPP_CLOUD_API_VERSION,
    phoneNumberId: env.WHATSAPP_CLOUD_PHONE_NUMBER_ID,
    ...(httpClient ? { httpClient } : {})
  });
  const dispatcher = createWhatsAppCloudDispatcher(sender);
  const requestHandler = createWhatsAppCloudWebhookRequestHandler({
    dispatcher,
    logger,
    pipelineRunner: (message) =>
      runInboundPipeline(message, {
        requireBusinessPersistence: true,
        clientConsentPersistence: resolvedConsentPersistence,
        clientIntakePersistence: resolvedIntakePersistence
      }),
    verifyToken: env.WHATSAPP_CLOUD_VERIFY_TOKEN,
    ...(sharedPersistenceService
      ? {
          wasMessageProcessed: (messageId: string) =>
            sharedPersistenceService.isMessageProcessed(messageId),
          markMessageProcessed: async (messageId: string) => {
            await sharedPersistenceService.markMessageProcessed(messageId, {
              senderId: REDACTED_PHONE,
              transportChatId: REDACTED_PHONE
            });
          }
        }
      : {}),
    ...(env.WHATSAPP_CLOUD_APP_SECRET
      ? {
          appSecret: env.WHATSAPP_CLOUD_APP_SECRET
        }
      : {})
  });
  const server = createHttpServer((request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");

    if (method === "GET" && url.pathname === HEALTH_PATH) {
      writeJsonResponse(response, 200, {
        alive: true,
        transport: createCloudRuntimeStatus(env)
      });
      return;
    }

    if (method === "GET" && url.pathname === READY_PATH) {
      writeJsonResponse(response, 200, {
        ready: true,
        state: "ready",
        signatureVerification: getCloudSignatureVerificationMode(env)
      });
      return;
    }

    if (method === "GET" && url.pathname === STATUS_PATH) {
      writeJsonResponse(response, 200, createCloudRuntimeStatus(env));
      return;
    }

    void requestHandler(request, response).catch((error: unknown) => {
      logger.error("whatsapp_cloud_request_failed", {
        error: error instanceof Error ? error.message : "unknown_error"
      });

      if (!response.headersSent) {
        writeResponse(response, 500, "Internal Server Error");
      } else {
        response.end();
      }
    });
  });

  logger.info("whatsapp_cloud_runtime_starting", {
    transport: env.WHATSAPP_TRANSPORT,
    api_version: env.WHATSAPP_CLOUD_API_VERSION,
    webhook_host: env.WHATSAPP_CLOUD_WEBHOOK_HOST,
    webhook_port: env.WHATSAPP_CLOUD_WEBHOOK_PORT,
    webhook_path: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
    signature_verification: getCloudSignatureVerificationMode(env),
    business_persistence_enabled: env.BUSINESS_PERSISTENCE_ENABLED
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        env.WHATSAPP_CLOUD_WEBHOOK_PORT,
        env.WHATSAPP_CLOUD_WEBHOOK_HOST,
        () => {
          server.off("error", reject);
          resolve();
        }
      );
    });
  } catch (error) {
    closeSharedPersistence();
    throw error;
  }

  const getServerAddress = (): AddressInfo | undefined => {
    const address = server.address();
    return address && typeof address !== "string" ? address : undefined;
  };

  logger.info("whatsapp_cloud_runtime_ready", {
    transport: env.WHATSAPP_TRANSPORT,
    webhook_path: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
    server_address: getServerAddress()
  });

  let shutdownPromise: Promise<void> | undefined;

  return {
    env,
    getServerAddress,
    async stop(reason = "shutdown") {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      logger.info("whatsapp_cloud_shutdown_starting", {
        reason
      });

      shutdownPromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            logger.error("whatsapp_cloud_shutdown_failed", {
              reason,
              error: error.message
            });
            closeSharedPersistence();
            reject(error);
            return;
          }

          closeSharedPersistence();
          logger.info("whatsapp_cloud_shutdown_complete", {
            reason
          });
          resolve();
        });
      });

      return shutdownPromise;
    }
  };
};

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
};

const main = async (): Promise<void> => {
  await startWhatsAppCloudRuntime();
};

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    consoleLogger.error("whatsapp_cloud_runtime_startup_failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    process.exit(1);
  });
}

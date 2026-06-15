import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../../src/logging/logger";
import { runInboundPipeline } from "../../src/app";
import {
  createWhatsAppCloudWebhookRequestHandler,
  startWhatsAppCloudRuntime
} from "../../src/app/whatsappCloudRuntime";
import {
  createBusinessPersistenceService,
  createInMemoryPersistenceService
} from "../../src/persistence";
import {
  DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
  createWhatsAppCloudDispatcher,
  createWhatsAppCloudSender
} from "../../src/transport/whatsapp-cloud";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

describe("whatsapp cloud runtime server", () => {
  it("exposes local health endpoints without leaking Cloud secrets", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const businessPersistenceService =
      createBusinessPersistenceService(persistenceService);
    let requestHandler:
      | ((request: IncomingMessage, response: ServerResponse) => void)
      | undefined;
    const serverAddress: AddressInfo = {
      address: "127.0.0.1",
      family: "IPv4",
      port: 3002
    };

    const runtime = await startWhatsAppCloudRuntime({
      envSource: {
        WHATSAPP_TRANSPORT: "cloud",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_MIGRATIONS_ENABLED: "true",
        WHATSAPP_CLOUD_API_VERSION: "v22.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-1234567890",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-1234567890",
        WHATSAPP_CLOUD_APP_SECRET: "app-secret-1234567890",
        WHATSAPP_CLOUD_WEBHOOK_HOST: "127.0.0.1",
        WHATSAPP_CLOUD_WEBHOOK_PORT: "0"
      },
      logger,
      persistenceService,
      businessPersistenceService,
      createHttpServer: (handler) => {
        requestHandler = handler;

        return {
          once() {
            return this;
          },
          off() {
            return this;
          },
          listen(_port, _host, callback) {
            callback();
            return this;
          },
          address() {
            return serverAddress;
          },
          close(callback) {
            callback();
            return this;
          }
        };
      }
    });

    try {
      const address = runtime.getServerAddress();
      expect(address).toBeDefined();
      expect(address).toEqual(serverAddress);
      expect(requestHandler).toBeDefined();

      const healthResponse = createResponse();
      await requestHandler!(
        createRequest({
          method: "GET",
          url: "/health"
        }),
        healthResponse.response
      );

      expect(healthResponse.result.statusCode).toBe(200);
      expect(JSON.parse(healthResponse.result.body)).toMatchObject({
        alive: true,
        transport: {
          kind: "cloud",
          state: "ready",
          ready: true,
          signatureVerification: "enforced",
          webhookPath: "/webhooks/whatsapp/cloud"
        }
      });

      const readyResponse = createResponse();
      await requestHandler!(
        createRequest({
          method: "GET",
          url: "/ready"
        }),
        readyResponse.response
      );

      expect(readyResponse.result.statusCode).toBe(200);
      expect(JSON.parse(readyResponse.result.body)).toMatchObject({
        ready: true,
        state: "ready",
        signatureVerification: "enforced"
      });

      const statusResponse = createResponse();
      await requestHandler!(
        createRequest({
          method: "GET",
          url: "/status"
        }),
        statusResponse.response
      );

      expect(statusResponse.result.statusCode).toBe(200);
      const statusBody = statusResponse.result.body;
      expect(statusBody).toContain("\"transport\":\"cloud\"");
      expect(statusBody).not.toContain("access-token-1234567890");
      expect(statusBody).not.toContain("verify-token-1234567890");
      expect(statusBody).not.toContain("app-secret-1234567890");
      expect(statusBody).not.toContain("1234567890");
    } finally {
      await runtime.stop("test_shutdown");
    }
  });

  it("requires the Cloud app secret in production", async () => {
    await expect(() =>
      startWhatsAppCloudRuntime({
        envSource: {
          NODE_ENV: "production",
          WHATSAPP_TRANSPORT: "cloud",
          BUSINESS_PERSISTENCE_ENABLED: "true",
          DATABASE_MIGRATIONS_ENABLED: "true",
          WHATSAPP_CLOUD_API_VERSION: "v22.0",
          WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1234567890",
          WHATSAPP_CLOUD_VERIFY_TOKEN: "verify-token-1234567890",
          WHATSAPP_CLOUD_ACCESS_TOKEN: "access-token-1234567890",
          WHATSAPP_CLOUD_WEBHOOK_HOST: "127.0.0.1",
          WHATSAPP_CLOUD_WEBHOOK_PORT: "0"
        },
        persistenceService: createInMemoryPersistenceService(),
        businessPersistenceService: createBusinessPersistenceService(
          createInMemoryPersistenceService()
        )
      })
    ).rejects.toThrow("WHATSAPP_CLOUD_APP_SECRET is required");
  });
});

const createRequest = ({
  body = "",
  headers = {},
  method,
  url
}: {
  body?: string;
  headers?: Record<string, string>;
  method: string;
  url: string;
}): IncomingMessage =>
  Object.assign(Readable.from(body.length > 0 ? [body] : []), {
    headers,
    method,
    url
  }) as IncomingMessage;

const createResponse = (): {
  response: ServerResponse;
  result: {
    body: string;
    headers: Record<string, string>;
    statusCode: number | undefined;
  };
} => {
  const result = {
    body: "",
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined
  };
  const responseObject = {
    headersSent: false,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      result.statusCode = statusCode;
      result.headers = headers ?? {};
      responseObject.headersSent = true;
    },
    end(body?: string) {
      result.body = body ?? "";
      responseObject.headersSent = true;
    }
  };

  return {
    response: responseObject as unknown as ServerResponse,
    result
  };
};

describe("whatsapp cloud runtime request handler", () => {
  it("verifies webhooks, processes text messages, ignores unsupported events, and redacts tokens from logs", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const businessPersistenceService =
      createBusinessPersistenceService(persistenceService);
    const post = vi.fn().mockResolvedValue({
      status: 200,
      bodyText: '{"messages":[{"id":"wamid.outbound-1"}]}'
    });
    const sender = createWhatsAppCloudSender({
      apiVersion: "v22.0",
      phoneNumberId: "1234567890",
      accessToken: "access-token-1234567890",
      httpClient: {
        post
      }
    });
    const handler = createWhatsAppCloudWebhookRequestHandler({
      dispatcher: createWhatsAppCloudDispatcher(sender),
      logger,
      pipelineRunner: (message) =>
        runInboundPipeline(message, {
          requireBusinessPersistence: true,
          clientConsentPersistence: businessPersistenceService,
          clientIntakePersistence: businessPersistenceService
        }),
      verifyToken: "verify-token-1234567890",
      wasMessageProcessed: (messageId) =>
        persistenceService.isMessageProcessed(messageId),
      markMessageProcessed: async (messageId) => {
        await persistenceService.markMessageProcessed(messageId, {
          senderId: "[redacted-phone]",
          transportChatId: "[redacted-phone]"
        });
      }
    });

    const verificationResponse = createResponse();
    await handler(
      createRequest({
        method: "GET",
        url: `${DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=verify-token-1234567890&hub.challenge=challenge-ok`
      }),
      verificationResponse.response
    );

    expect(verificationResponse.result.statusCode).toBe(200);
    expect(verificationResponse.result.body).toBe("challenge-ok");

    const failedVerificationResponse = createResponse();
    await handler(
      createRequest({
        method: "GET",
        url: `${DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH}?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-ko`
      }),
      failedVerificationResponse.response
    );

    expect(failedVerificationResponse.result.statusCode).toBe(403);
    expect(failedVerificationResponse.result.body).toBe("Forbidden");

    const webhookResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    contacts: [
                      {
                        wa_id: "393331112222",
                        profile: {
                          name: "Mario Rossi"
                        }
                      }
                    ],
                    messages: [
                      {
                        id: "wamid.cloud-1",
                        from: "393331112222",
                        timestamp: "1718049600",
                        type: "text",
                        text: {
                          body: "Vorrei aiuto"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      }),
      webhookResponse.response
    );

    expect(webhookResponse.result.statusCode).toBe(200);
    expect(webhookResponse.result.body).toBe("EVENT_RECEIVED");
    expect(await persistenceService.getConsentState("393331112222")).toBe("requested");
    expect(post).toHaveBeenCalledTimes(1);

    const [, requestOptions] = post.mock.calls[0] as [
      string,
      {
        body: string;
      }
    ];
    const payload = JSON.parse(requestOptions.body) as {
      text: {
        body: string;
      };
      to: string;
    };

    expect(payload.to).toBe("393331112222");
    expect(payload.text.body).toContain("Acconsento");

    const duplicateWebhookResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    messages: [
                      {
                        id: "wamid.cloud-1",
                        from: "393331112222",
                        timestamp: "1718049600",
                        type: "text",
                        text: {
                          body: "Vorrei aiuto"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      }),
      duplicateWebhookResponse.response
    );

    expect(duplicateWebhookResponse.result.statusCode).toBe(200);
    expect(post).toHaveBeenCalledTimes(1);

    const ignoredResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    messages: [
                      {
                        id: "wamid.cloud-image-1",
                        from: "393331112222",
                        timestamp: "1718049601",
                        type: "image"
                      }
                    ],
                    statuses: [
                      {
                        id: "wamid.status-1",
                        status: "delivered"
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
      }),
      ignoredResponse.response
    );

    expect(ignoredResponse.result.statusCode).toBe(200);
    expect(ignoredResponse.result.body).toBe("EVENT_RECEIVED");
    expect(post).toHaveBeenCalledTimes(1);

    const serializedLogs = JSON.stringify({
      info: (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      warn: (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      error: (logger.error as ReturnType<typeof vi.fn>).mock.calls
    });

    expect(serializedLogs).not.toContain("access-token-1234567890");
    expect(serializedLogs).not.toContain("verify-token-1234567890");
  });
});

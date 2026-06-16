import { Readable } from "node:stream";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "../../src/logging/logger";
import { runInboundPipeline } from "../../src/app";
import {
  createWhatsAppCloudWebhookRequestHandler,
  installWhatsAppCloudSignalHandlers,
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

  it("defaults the Cloud webhook server to loopback", async () => {
    const persistenceService = createInMemoryPersistenceService();
    let listenedHost = "";

    const runtime = await startWhatsAppCloudRuntime({
      envSource: {
        WHATSAPP_TRANSPORT: "cloud",
        BUSINESS_PERSISTENCE_ENABLED: "true",
        DATABASE_MIGRATIONS_ENABLED: "true",
        WHATSAPP_CLOUD_API_VERSION: "v21.0",
        WHATSAPP_CLOUD_PHONE_NUMBER_ID: "000000000000000",
        WHATSAPP_CLOUD_VERIFY_TOKEN: "local-dev-verify-token",
        WHATSAPP_CLOUD_ACCESS_TOKEN: "local-dev-access-token",
        WHATSAPP_CLOUD_WEBHOOK_PORT: "0"
      },
      persistenceService,
      businessPersistenceService: createBusinessPersistenceService(persistenceService),
      createHttpServer: () => ({
        once() {
          return this;
        },
        off() {
          return this;
        },
        listen(_port, host, callback) {
          listenedHost = host;
          callback();
          return this;
        },
        address() {
          return {
            address: listenedHost,
            family: "IPv4",
            port: 3002
          };
        },
        close(callback) {
          callback();
          return this;
        }
      })
    });

    try {
      expect(runtime.env.WHATSAPP_CLOUD_WEBHOOK_HOST).toBe("127.0.0.1");
      expect(listenedHost).toBe("127.0.0.1");
    } finally {
      await runtime.stop("test_shutdown");
    }
  });

  it("stops cleanly on SIGINT and SIGTERM", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const listeners = new Map<
      NodeJS.Signals,
      (signal: NodeJS.Signals) => void
    >();

    installWhatsAppCloudSignalHandlers(
      {
        env: {} as never,
        getServerAddress: () => undefined,
        stop
      },
      {
        on(signal, listener) {
          listeners.set(signal, listener);
        },
        exit
      }
    );

    listeners.get("SIGINT")?.("SIGINT");
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledWith("SIGINT");
      expect(exit).toHaveBeenCalledWith(0);
    });

    listeners.get("SIGTERM")?.("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("surfaces sanitized sender failures outside replay mode", async () => {
    const logger = createLogger();
    const persistenceService = createInMemoryPersistenceService();
    const businessPersistenceService =
      createBusinessPersistenceService(persistenceService);
    let requestHandler:
      | ((request: IncomingMessage, response: ServerResponse) => void)
      | undefined;
    const runtime = await startWhatsAppCloudRuntime({
      envSource: {
        NODE_ENV: "production",
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
      httpClient: {
        post: vi.fn().mockResolvedValue({
          status: 401,
          bodyText: '{"error":"unauthorized"}'
        })
      },
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
            return {
              address: "127.0.0.1",
              family: "IPv4",
              port: 3002
            };
          },
          close(callback) {
            callback();
            return this;
          }
        };
      }
    });

    try {
      const rawBody = JSON.stringify({
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
      });
      const response = createResponse();
      requestHandler!(
        createRequest({
          method: "POST",
          url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${createHmac(
              "sha256",
              "app-secret-1234567890"
            )
              .update(rawBody)
              .digest("hex")}`
          },
          body: rawBody
        }),
        response.response
      );

      await vi.waitFor(() => {
        expect(response.result.statusCode).toBe(500);
      });
      expect(response.result.body).toBe("Internal Server Error");

      const serializedLogs = JSON.stringify({
        info: (logger.info as ReturnType<typeof vi.fn>).mock.calls,
        warn: (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
        error: (logger.error as ReturnType<typeof vi.fn>).mock.calls
      });

      expect(serializedLogs).toContain("WhatsApp Cloud API request failed with status 401.");
      expect(serializedLogs).not.toContain("access-token-1234567890");
      expect(serializedLogs).not.toContain("app-secret-1234567890");
      expect(serializedLogs).not.toContain("Vorrei aiuto");
      expect(serializedLogs).not.toContain("393331112222");
    } finally {
      await runtime.stop("test_shutdown");
    }
  });
});

const createRequest = ({
  body = "",
  headers = {},
  method,
  remoteAddress,
  url
}: {
  body?: string;
  headers?: Record<string, string>;
  method: string;
  remoteAddress?: string;
  url: string;
}): IncomingMessage =>
  Object.assign(Readable.from(body.length > 0 ? [body] : []), {
    headers,
    method,
    socket: {
      remoteAddress
    },
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
  it("requires and validates signatures when an app secret is configured", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const appSecret = "fake-app-secret-for-signature-test";
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: []
    });
    const handler = createWhatsAppCloudWebhookRequestHandler({
      appSecret,
      dispatcher,
      logger,
      verifyToken: "fake-verify-token"
    });

    const unsignedResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: rawBody
      }),
      unsignedResponse.response
    );
    expect(unsignedResponse.result.statusCode).toBe(401);

    const invalidResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: rawBody,
        headers: {
          "x-hub-signature-256": "sha256=invalid"
        }
      }),
      invalidResponse.response
    );
    expect(invalidResponse.result.statusCode).toBe(401);

    const validResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: rawBody,
        headers: {
          "x-hub-signature-256": `sha256=${createHmac("sha256", appSecret)
            .update(rawBody)
            .digest("hex")}`
        }
      }),
      validResponse.response
    );
    expect(validResponse.result.statusCode).toBe(200);
    expect(validResponse.result.body).toBe("EVENT_RECEIVED");
  });

  it("validates local replay payloads without dispatching outbound messages", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const pipelineRunner = vi.fn();
    const handler = createWhatsAppCloudWebhookRequestHandler({
      allowUnsignedLocalReplay: true,
      dispatcher,
      logger,
      pipelineRunner,
      verifyToken: "fake-verify-token"
    });
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.fake-local-replay",
                    from: "12025550101",
                    timestamp: "1718049600",
                    type: "text",
                    text: {
                      body: "Synthetic replay text"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    const response = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-legalbot-cloud-replay": "1"
        },
        body: rawBody
      }),
      response.response
    );

    expect(response.result.statusCode).toBe(200);
    expect(response.result.body).toBe("EVENT_REPLAYED");
    expect(pipelineRunner).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("accepts signed replay validation behind a loopback host header without live dispatch", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const pipelineRunner = vi.fn();
    const appSecret = "fake-app-secret-for-replay";
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.fake-text-001",
                    from: "12025550101",
                    timestamp: "1718049600",
                    type: "text",
                    text: {
                      body: "Synthetic webhook replay text."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    const handler = createWhatsAppCloudWebhookRequestHandler({
      appSecret,
      dispatcher,
      logger,
      pipelineRunner,
      verifyToken: "fake-verify-token"
    });

    const response = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        remoteAddress: "172.18.0.1",
        headers: {
          host: "127.0.0.1:3002",
          "x-hub-signature-256": `sha256=${createHmac("sha256", appSecret)
            .update(rawBody)
            .digest("hex")}`,
          "x-legalbot-cloud-replay": "1"
        },
        body: rawBody
      }),
      response.response
    );

    expect(response.result.statusCode).toBe(200);
    expect(response.result.body).toBe("EVENT_REPLAYED");
    expect(pipelineRunner).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("allows unsigned local replay only when signature enforcement is off", async () => {
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: []
    });

    const unsignedHandler = createWhatsAppCloudWebhookRequestHandler({
      allowUnsignedLocalReplay: true,
      dispatcher,
      logger: createLogger(),
      verifyToken: "local-dev-verify-token"
    });
    const unsignedResponse = createResponse();

    await unsignedHandler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-legalbot-cloud-replay": "1"
        },
        body: rawBody
      }),
      unsignedResponse.response
    );

    expect(unsignedResponse.result.statusCode).toBe(200);

    const enforcedHandler = createWhatsAppCloudWebhookRequestHandler({
      allowUnsignedLocalReplay: true,
      appSecret: "local-dev-app-secret",
      dispatcher,
      logger: createLogger(),
      verifyToken: "local-dev-verify-token"
    });
    const enforcedResponse = createResponse();

    await enforcedHandler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        remoteAddress: "127.0.0.1",
        headers: {
          "x-legalbot-cloud-replay": "1"
        },
        body: rawBody
      }),
      enforcedResponse.response
    );

    expect(enforcedResponse.result.statusCode).toBe(401);
  });

  it("rejects malformed payloads and non-local replay requests safely", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const handler = createWhatsAppCloudWebhookRequestHandler({
      dispatcher,
      logger,
      verifyToken: "fake-verify-token"
    });

    const malformedResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: "{\"entry\":["
      }),
      malformedResponse.response
    );
    expect(malformedResponse.result.statusCode).toBe(400);

    const invalidShapeResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        body: JSON.stringify({
          entry: [
            {
              changes: "invalid"
            }
          ]
        })
      }),
      invalidShapeResponse.response
    );
    expect(invalidShapeResponse.result.statusCode).toBe(400);

    const nonLocalResponse = createResponse();
    await handler(
      createRequest({
        method: "POST",
        url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
        remoteAddress: "203.0.113.10",
        headers: {
          "x-legalbot-cloud-replay": "1"
        },
        body: JSON.stringify({
          object: "whatsapp_business_account",
          entry: []
        })
      }),
      nonLocalResponse.response
    );
    expect(nonLocalResponse.result.statusCode).toBe(403);
  });

  it("keeps signature enforcement active for direct replay validation requests", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        messageCount: 0,
        unsupportedCount: 0
      })
    };
    const appSecret = "fake-app-secret-for-direct-validation";
    const rawBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: []
    });
    const handler = createWhatsAppCloudWebhookRequestHandler({
      appSecret,
      dispatcher,
      logger,
      verifyToken: "fake-verify-token"
    });

    for (const headers of [
      {
        host: "127.0.0.1:3002",
        "x-legalbot-cloud-replay": "1"
      },
      {
        host: "127.0.0.1:3002",
        "x-hub-signature-256": "sha256=invalid",
        "x-legalbot-cloud-replay": "1"
      }
    ]) {
      const response = createResponse();
      await handler(
        createRequest({
          method: "POST",
          url: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
          remoteAddress: "172.18.0.1",
          headers,
          body: rawBody
        }),
        response.response
      );

      expect(response.result.statusCode).toBe(401);
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    }
  });

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

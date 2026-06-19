import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { runInboundPipeline } from "../../src/app/pipeline.ts";
import { createWhatsAppCloudWebhookRequestHandler } from "../../src/app/whatsappCloudRuntime.ts";
import {
  createBusinessPersistenceService,
  createInMemoryPersistenceService
} from "../../src/persistence/index.ts";
import type { AiNormalizationProvider } from "../../src/domain/practices/aiNormalization.ts";
import { DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH } from "../../src/transport/whatsapp-cloud/index.ts";

const operatorPhoneE164 = "+393331112222";
const operatorWaId = "393331112222";
const clientWaId = "393331119999";
const secondClientWaId = "393331118888";
const fakeVerifyToken = "verify-token-must-not-leak";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createRequest = ({
  body,
  method = "POST",
  url = DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH
}: {
  body: string;
  method?: string;
  url?: string;
}): IncomingMessage =>
  Object.assign(Readable.from([body]), {
    headers: {
      "content-type": "application/json"
    },
    method,
    socket: {
      remoteAddress: "127.0.0.1"
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

const buildCloudTextPayload = ({
  body,
  from,
  messageId
}: {
  body: string;
  from: string;
  messageId: string;
}): string =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [
                {
                  wa_id: from,
                  profile: {
                    name: "Fixture Sender"
                  }
                }
              ],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: "1718049600",
                  type: "text",
                  text: {
                    body
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  });

const buildCloudDocumentPayload = ({
  fileName,
  from,
  mediaId,
  messageId
}: {
  fileName: string;
  from: string;
  mediaId: string;
  messageId: string;
}): string =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [
                {
                  wa_id: from,
                  profile: {
                    name: "Fixture Sender"
                  }
                }
              ],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: "1718049660",
                  type: "document",
                  document: {
                    id: mediaId,
                    filename: fileName,
                    mime_type: "application/pdf",
                    sha256: "fake-sha256"
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  });

const createHarness = ({
  aiNormalizationProvider,
  enableDedupe = true
}: {
  aiNormalizationProvider?: AiNormalizationProvider;
  enableDedupe?: boolean;
} = {}) => {
  const logger = createLogger();
  const persistenceService = createInMemoryPersistenceService();
  const businessPersistence = createBusinessPersistenceService(persistenceService);
  const replies: string[] = [];
  const getStatus = () => ({
    runtime: {
      ready: true,
      state: "ready"
    },
    persistence: {
      enabled: true
    },
    migrations: {
      appliedMigrationCount: 12,
      pendingMigrationCount: 0
    }
  });
  const handler = createWhatsAppCloudWebhookRequestHandler({
    dispatcher: {
      async dispatch(plan) {
        for (const message of plan.messages) {
          if (message.kind === "text") {
            replies.push(message.body);
          }
        }

        return {
          delivered: plan.messages.length > 0,
          messageCount: plan.messages.length,
          unsupportedCount: 0
        };
      }
    },
    lawyerPhoneE164: operatorPhoneE164,
    logger,
    operatorStatusProvider: getStatus,
    pipelineRunner: (message) =>
      runInboundPipeline(message, {
        clientConsentPersistence: businessPersistence,
        clientIntakePersistence: businessPersistence,
        practicePersistence: businessPersistence,
        ...(aiNormalizationProvider ? { aiNormalizationProvider } : {}),
        lawyerRuntime: {
          getStatus,
          listPractices: (filter) => businessPersistence.listPractices(filter),
          getPracticeByCode: (practiceCode) =>
            businessPersistence.findPracticeByCode(practiceCode)
        },
        requireBusinessPersistence: true
      }),
    verifyToken: fakeVerifyToken,
    ...(enableDedupe
      ? {
          wasMessageProcessed: (messageId: string) =>
            persistenceService.isMessageProcessed(messageId),
          markMessageProcessed: async (messageId: string) => {
            await persistenceService.markMessageProcessed(messageId, {
              senderId: "[redacted-phone]",
              transportChatId: "[redacted-phone]"
            });
          }
        }
      : {})
  });

  const sendPayload = async (body: string): Promise<string> => {
    const response = createResponse();
    const replyCount = replies.length;

    await handler(
      createRequest({
        body
      }),
      response.response
    );

    expect(response.result.statusCode).toBe(200);
    expect(response.result.body).toBe("EVENT_RECEIVED");

    return replies.slice(replyCount).at(-1) ?? "";
  };

  const sendText = (input: {
    body: string;
    from: string;
    messageId: string;
  }): Promise<string> => sendPayload(buildCloudTextPayload(input));

  const sendDocument = (input: {
    fileName: string;
    from: string;
    mediaId: string;
    messageId: string;
  }): Promise<string> => sendPayload(buildCloudDocumentPayload(input));

  const serializedLogs = () =>
    JSON.stringify({
      debug: (logger.debug as ReturnType<typeof vi.fn>).mock.calls,
      info: (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      warn: (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      error: (logger.error as ReturnType<typeof vi.fn>).mock.calls
    });

  return {
    businessPersistence,
    replies,
    sendDocument,
    sendText,
    serializedLogs
  };
};

const completePractice = async (
  harness: ReturnType<typeof createHarness>,
  {
    client = clientWaId,
    messagePrefix = "client",
    issue = "Ho bisogno di assistenza per un problema di lavoro."
  }: {
    client?: string;
    messagePrefix?: string;
    issue?: string;
  } = {}
) => {
  await harness.sendText({
    body: "Buongiorno",
    from: client,
    messageId: `wamid.${messagePrefix}-1`
  });
  await harness.sendText({
    body: "Acconsento",
    from: client,
    messageId: `wamid.${messagePrefix}-2`
  });
  await harness.sendText({
    body: "Mario Rossi, 01/01/1980, Roma",
    from: client,
    messageId: `wamid.${messagePrefix}-3`
  });
  await harness.sendText({
    body: issue,
    from: client,
    messageId: `wamid.${messagePrefix}-4`
  });

  return harness.sendText({
    body: "Salta",
    from: client,
    messageId: `wamid.${messagePrefix}-5`
  });
};

describe("whatsapp cloud product slice", () => {
  it("shows only implemented lawyer help and status commands", async () => {
    const harness = createHarness();

    const help = await harness.sendText({
      body: "aiuto",
      from: operatorWaId,
      messageId: "wamid.operator-help"
    });
    expect(help).toContain("pratiche");
    expect(help).toContain("pratica AA001");
    expect(help).toContain("automaticamente");
    expect(help).toContain("PDF");
    expect(help).not.toContain("ping");
    expect(help).not.toContain("case:create");
    expect(help).not.toContain("open practice");

    const status = await harness.sendText({
      body: "stato",
      from: operatorWaId,
      messageId: "wamid.operator-status"
    });
    expect(status).toContain("migrations_pending: 0");

    const unknown = await harness.sendText({
      body: "comando sconosciuto",
      from: operatorWaId,
      messageId: "wamid.operator-unknown"
    });
    expect(unknown).toContain("Comando operatore non riconosciuto");
    expect(unknown).toContain("pratica AA001");
  });

  it("runs client consent, identity, legal issue, attachment skip, and automatic practice creation", async () => {
    const harness = createHarness();

    await expect(
      harness.sendText({
        body: "Buongiorno",
        from: clientWaId,
        messageId: "wamid.flow-1"
      })
    ).resolves.toContain("- Acconsento");
    await expect(
      harness.sendText({
        body: "Acconsento",
        from: clientWaId,
        messageId: "wamid.flow-2"
      })
    ).resolves.toContain("nome");
    await expect(
      harness.sendText({
        body: "Mario Rossi",
        from: clientWaId,
        messageId: "wamid.flow-3"
      })
    ).resolves.toContain("data di nascita");
    await expect(
      harness.sendText({
        body: "Mario Rossi, 01/01/1980, Roma",
        from: clientWaId,
        messageId: "wamid.flow-4"
      })
    ).resolves.toContain("Descriva brevemente il problema");
    await expect(
      harness.sendText({
        body: "Ho bisogno di assistenza per un problema di lavoro.",
        from: clientWaId,
        messageId: "wamid.flow-5"
      })
    ).resolves.toContain("allegati");
    await expect(
      harness.sendText({
        body: "Salta",
        from: clientWaId,
        messageId: "wamid.flow-6"
      })
    ).resolves.toContain("pratica AA001");

    const practices = await harness.businessPersistence.listPractices();
    expect(practices).toHaveLength(1);
    expect(practices[0]).toMatchObject({
      practiceCode: "AA001",
      subjectId: clientWaId,
      status: "draft",
      clientFirstName: "Mario",
      clientLastName: "Rossi",
      birthDate: "01/01/1980",
      city: "Roma",
      legalIssueText: "Ho bisogno di assistenza per un problema di lavoro.",
      attachmentMetadata: []
    });
    expect(practices[0]).not.toHaveProperty("rawBody");
    expect(practices[0]).not.toHaveProperty("transcript");

    const logs = harness.serializedLogs();
    expect(logs).toContain("cloud_client_turn_received");
    expect(logs).not.toContain(operatorPhoneE164);
    expect(logs).not.toContain(operatorWaId);
    expect(logs).not.toContain(clientWaId);
    expect(logs).not.toContain(fakeVerifyToken);
    expect(logs).not.toContain("Ho bisogno di assistenza");
  });

  it("stores safe Cloud attachment metadata on the practice", async () => {
    const harness = createHarness();

    await harness.sendText({
      body: "Buongiorno",
      from: clientWaId,
      messageId: "wamid.attach-1"
    });
    await harness.sendText({
      body: "Acconsento",
      from: clientWaId,
      messageId: "wamid.attach-2"
    });
    await harness.sendText({
      body: "Mario Rossi, 01/01/1980, Roma",
      from: clientWaId,
      messageId: "wamid.attach-3"
    });
    await harness.sendText({
      body: "Problema con un contratto firmato.",
      from: clientWaId,
      messageId: "wamid.attach-4"
    });
    await expect(
      harness.sendDocument({
        fileName: "contratto.pdf",
        from: clientWaId,
        mediaId: "media-provider-id-1",
        messageId: "wamid.attach-5"
      })
    ).resolves.toContain("pratica AA001");

    const practice = (await harness.businessPersistence.listPractices())[0]!;
    expect(practice.attachmentMetadata).toEqual([
      {
        kind: "document",
        providerMediaId: "media-provider-id-1",
        mimeType: "application/pdf",
        fileName: "contratto.pdf",
        sha256: "fake-sha256",
        receivedAt: expect.any(String)
      }
    ]);

    const detail = await harness.sendText({
      body: "pratica AA001",
      from: operatorWaId,
      messageId: "wamid.attach-lawyer-detail"
    });
    expect(detail).toContain("contratto.pdf");
    expect(detail).not.toContain("media-provider-id-1");
  });

  it("lets one client own multiple automatically created practices", async () => {
    const harness = createHarness();

    await expect(completePractice(harness)).resolves.toContain("pratica AA001");
    await expect(
      harness.sendText({
        body: "Vorrei aprire una nuova richiesta",
        from: clientWaId,
        messageId: "wamid.multi-6"
      })
    ).resolves.toContain("Descriva brevemente il problema");
    await expect(
      harness.sendText({
        body: "Ho anche un problema con il contratto di locazione.",
        from: clientWaId,
        messageId: "wamid.multi-7"
      })
    ).resolves.toContain("allegati");
    await expect(
      harness.sendText({
        body: "Salta",
        from: clientWaId,
        messageId: "wamid.multi-8"
      })
    ).resolves.toContain("pratica AA002");

    const practices = await harness.businessPersistence.listPractices();
    expect(practices.map((practice) => practice.practiceCode).sort()).toEqual(["AA001", "AA002"]);
    expect(new Set(practices.map((practice) => practice.subjectId))).toEqual(new Set([clientWaId]));
  });

  it("keeps completion retries idempotent without creating duplicate practices", async () => {
    const harness = createHarness({
      enableDedupe: false
    });

    await completePractice(harness, {
      messagePrefix: "retry"
    });
    await expect(
      harness.sendText({
        body: "Salta",
        from: clientWaId,
        messageId: "wamid.retry-5"
      })
    ).resolves.toContain("pratica AA001");

    await expect(harness.businessPersistence.listPractices()).resolves.toHaveLength(1);
  });

  it("implements lawyer practice list and detail while keeping non-lawyers in client flow", async () => {
    const harness = createHarness();

    await completePractice(harness);

    const list = await harness.sendText({
      body: "pratiche",
      from: operatorWaId,
      messageId: "wamid.lawyer-list"
    });
    expect(list).toContain("AA001");
    expect(list).toContain("Mario R.");
    expect(list).toContain("Roma");
    expect(list).not.toContain(clientWaId);
    expect(list).not.toContain("problema di lavoro");

    await expect(
      harness.sendText({
        body: "pratiche oggi",
        from: operatorWaId,
        messageId: "wamid.lawyer-list-today"
      })
    ).resolves.toContain("AA001");
    await expect(
      harness.sendText({
        body: "pratiche ultimi 7 giorni",
        from: operatorWaId,
        messageId: "wamid.lawyer-list-week"
      })
    ).resolves.toContain("AA001");

    const detail = await harness.sendText({
      body: "pratica AA001",
      from: operatorWaId,
      messageId: "wamid.lawyer-detail"
    });
    expect(detail).toContain("Pratica AA001");
    expect(detail).toContain("Cliente:");
    expect(detail).toContain("Questione legale:");
    expect(detail).toContain("Allegati:");
    expect(detail).toContain("Ho bisogno di assistenza per un problema di lavoro.");
    expect(detail).not.toContain(clientWaId);

    const nonLawyerReply = await harness.sendText({
      body: "pratiche",
      from: secondClientWaId,
      messageId: "wamid.non-lawyer-pratiche"
    });
    expect(nonLawyerReply).toContain("- Acconsento");
  });

  it("uses the controlled AI seam only after deterministic identity parsing fails", async () => {
    const normalizeIdentity = vi.fn(() => ({
      acceptedFields: {
        firstName: "Giulia",
        lastName: "Bianchi",
        birthDate: "02/02/1985",
        city: "Milano"
      },
      missingFields: []
    }));
    const summarizeLegalIssue = vi.fn(() => ({
      cleanedIssueText: "Richiesta di assistenza per una controversia di lavoro."
    }));
    const harness = createHarness({
      aiNormalizationProvider: {
        normalizeIdentity,
        summarizeLegalIssue
      }
    });

    await harness.sendText({
      body: "Buongiorno",
      from: clientWaId,
      messageId: "wamid.ai-1"
    });
    await harness.sendText({
      body: "Acconsento",
      from: clientWaId,
      messageId: "wamid.ai-2"
    });
    await expect(
      harness.sendText({
        body: "i miei dati sono scritti in modo difficile",
        from: clientWaId,
        messageId: "wamid.ai-3"
      })
    ).resolves.toContain("Descriva brevemente il problema");
    await harness.sendText({
      body: "Ho una controversia di lavoro.",
      from: clientWaId,
      messageId: "wamid.ai-4"
    });
    await harness.sendText({
      body: "Salta",
      from: clientWaId,
      messageId: "wamid.ai-5"
    });

    expect(normalizeIdentity).toHaveBeenCalledTimes(1);
    expect(summarizeLegalIssue).toHaveBeenCalledTimes(1);
    const practice = (await harness.businessPersistence.listPractices())[0]!;
    expect(practice).toMatchObject({
      clientFirstName: "Giulia",
      clientLastName: "Bianchi",
      birthDate: "02/02/1985",
      city: "Milano",
      legalIssueText: "Ho una controversia di lavoro.",
      cleanedIssueText: "Richiesta di assistenza per una controversia di lavoro."
    });
  });
});

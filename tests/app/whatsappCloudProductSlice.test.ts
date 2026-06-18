import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { runInboundPipeline } from "../../src/app/pipeline.ts";
import {
  createWhatsAppCloudWebhookRequestHandler
} from "../../src/app/whatsappCloudRuntime.ts";
import {
  InMemoryConsentStore,
  InMemoryIntakeStore,
  intakeFieldNames,
  toOperatorSubjectId,
  type BusinessReadyIntakeCandidate
} from "../../src/persistence/index.ts";
import { DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH } from "../../src/transport/whatsapp-cloud/index.ts";

const operatorPhoneE164 = "+393331112222";
const operatorWaId = "393331112222";
const clientWaId = "393331119999";
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

const createHarness = () => {
  const logger = createLogger();
  const consentStore = new InMemoryConsentStore();
  const intakeStore = new InMemoryIntakeStore();
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
      appliedMigrationCount: 11,
      pendingMigrationCount: 0
    }
  });
  const listReadyIntakes = (): BusinessReadyIntakeCandidate[] =>
    intakeStore
      .snapshotStates()
      .filter((state) => state.state === "intake_complete")
      .map((state) => {
        const fieldNamesPresent = intakeFieldNames.filter((fieldName) =>
          intakeStore
            .snapshotFields()
            .some(
              (field) =>
                field.subjectId === state.subjectId &&
                field.fieldName === fieldName
            )
        );

        return {
          subjectId: state.subjectId,
          intakeState: "intake_complete",
          updatedAt: state.updatedAt,
          fieldNamesPresent
        };
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
        clientConsentPersistence: consentStore,
        clientIntakePersistence: intakeStore,
        lawyerRuntime: {
          getStatus,
          listReadyIntakes
        }
      }),
    readyIntakeLister: listReadyIntakes,
    verifyToken: fakeVerifyToken
  });

  const sendText = async ({
    body,
    from,
    messageId
  }: {
    body: string;
    from: string;
    messageId: string;
  }): Promise<string> => {
    const response = createResponse();

    await handler(
      createRequest({
        body: buildCloudTextPayload({
          body,
          from,
          messageId
        })
      }),
      response.response
    );

    expect(response.result.statusCode).toBe(200);
    expect(response.result.body).toBe("EVENT_RECEIVED");

    return replies.at(-1) ?? "";
  };

  const serializedLogs = () =>
    JSON.stringify({
      debug: (logger.debug as ReturnType<typeof vi.fn>).mock.calls,
      info: (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      warn: (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      error: (logger.error as ReturnType<typeof vi.fn>).mock.calls
    });

  return {
    consentStore,
    intakeStore,
    replies,
    sendText,
    serializedLogs
  };
};

describe("whatsapp cloud product slice", () => {
  it("routes configured operator help, status, ping, and unknown commands", async () => {
    const harness = createHarness();

    await expect(
      harness.sendText({
        body: "help",
        from: operatorWaId,
        messageId: "wamid.operator-help"
      })
    ).resolves.toContain("Comandi operatore disponibili");
    await expect(
      harness.sendText({
        body: "status",
        from: operatorWaId,
        messageId: "wamid.operator-status"
      })
    ).resolves.toContain("migrations_pending: 0");
    await expect(
      harness.sendText({
        body: "ping",
        from: operatorWaId,
        messageId: "wamid.operator-ping"
      })
    ).resolves.toBe("pong: runtime ready");
    await expect(
      harness.sendText({
        body: "bogus command",
        from: operatorWaId,
        messageId: "wamid.operator-unknown"
      })
    ).resolves.toContain("Comando operatore non riconosciuto");

    const logs = harness.serializedLogs();
    expect(logs).toContain("cloud_operator_command_received");
    expect(logs).toContain("cloud_operator_command_handled");
    expect(logs).toContain("cloud_operator_command_rejected");
    expect(logs).not.toContain(operatorPhoneE164);
    expect(logs).not.toContain(operatorWaId);
    expect(logs).not.toContain(clientWaId);
    expect(logs).not.toContain(fakeVerifyToken);
  });

  it("keeps non-operator command words in the client consent flow", async () => {
    const harness = createHarness();

    const reply = await harness.sendText({
      body: "status",
      from: clientWaId,
      messageId: "wamid.client-status"
    });

    expect(reply).toContain("- Acconsento");
    expect(await harness.consentStore.getConsentState(clientWaId)).toBe("requested");
    expect(harness.serializedLogs()).not.toContain("cloud_operator_command_received");
  });

  it("runs the Cloud client consent and intake flow to completion", async () => {
    const harness = createHarness();

    await expect(
      harness.sendText({
        body: "Buongiorno",
        from: clientWaId,
        messageId: "wamid.client-1"
      })
    ).resolves.toContain("- Acconsento");
    await expect(
      harness.sendText({
        body: "Acconsento",
        from: clientWaId,
        messageId: "wamid.client-2"
      })
    ).resolves.toContain("nome");
    await expect(
      harness.sendText({
        body: "Mario Rossi, 01/01/1980, Roma",
        from: clientWaId,
        messageId: "wamid.client-3"
      })
    ).resolves.toContain("Descriva brevemente il problema");
    await expect(
      harness.sendText({
        body: "Ho bisogno di assistenza per un problema di lavoro.",
        from: clientWaId,
        messageId: "wamid.client-4"
      })
    ).resolves.toContain("Ho registrato solo i campi strutturati minimi");

    await expect(harness.intakeStore.getIntakeSnapshot(clientWaId)).resolves.toMatchObject({
      subjectId: clientWaId,
      state: "intake_complete",
      fields: {
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma",
        problemSummary: "Ho bisogno di assistenza per un problema di lavoro."
      }
    });

    const readyReply = await harness.sendText({
      body: "intake-ready",
      from: operatorWaId,
      messageId: "wamid.operator-ready"
    });

    expect(readyReply).toContain(toOperatorSubjectId(clientWaId));
    expect(readyReply).toContain("intakeState=intake_complete");
    expect(readyReply).toContain("fieldNamesPresent=firstName,lastName,birthDate,city,problemSummary");
    expect(readyReply).not.toContain(clientWaId);
    expect(readyReply).not.toContain("Mario");
    expect(readyReply).not.toContain("Rossi");
    expect(readyReply).not.toContain("problema di lavoro");

    const logs = harness.serializedLogs();
    expect(logs).toContain("cloud_client_turn_received");
    expect(logs).not.toContain(operatorPhoneE164);
    expect(logs).not.toContain(operatorWaId);
    expect(logs).not.toContain(clientWaId);
    expect(logs).not.toContain(fakeVerifyToken);
  });
});

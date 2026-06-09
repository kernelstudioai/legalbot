import { describe, expect, it } from "vitest";
import { runInboundPipeline } from "../../src/app";
import { InMemoryConsentStore, InMemoryIntakeStore } from "../../src/persistence";
import type { OpenWaMessage } from "../../src/transport/openwa/types";

describe("inbound pipeline", () => {
  it("processes a mock inbound message into an output plan", async () => {
    const rawMessage: OpenWaMessage = {
      id: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us",
      body: "Hello, I need a lawyer",
      sender: {
        pushname: "Prospective Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-04T12:00:00.000Z")
    };

    const result = await runInboundPipeline(rawMessage);

    expect(result.envelope.messageId).toBe("wamid.test-1");
    expect(result.routingDecision.targetRuntime).toBe("lawyer");
    expect(result.runtimeDecision.action).toBe("acknowledge");
    expect(result.outputPlan.messages).toHaveLength(1);
    expect(result.outputPlan.messages[0]?.to).toBe("client-123@c.us");
  });

  it("keeps the M13 consent flow for unknown consent before intake starts", async () => {
    const rawMessage: OpenWaMessage = {
      id: "wamid.client-consent-1",
      from: "client-456@c.us",
      chatId: "client-456@c.us",
      body: "Vorrei aiuto",
      sender: {
        pushname: "Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-04T12:10:00.000Z")
    };

    const consentStore = new InMemoryConsentStore();
    const intakeStore = new InMemoryIntakeStore();
    const result = await runInboundPipeline(rawMessage, {
      clientConsentPersistence: consentStore,
      clientIntakePersistence: intakeStore
    });

    expect(result.runtimeDecision.action).toBe("request_consent");
    expect(result.outputPlan.messages[0]?.body).toContain("- Acconsento");
    expect(await consentStore.getConsentState("client-456@c.us")).toBe("requested");
    expect(await intakeStore.getIntakeSnapshot("client-456@c.us")).toBeNull();
  });

  it("keeps consent granted through the full M26 live intake flow", async () => {
    const consentStore = new InMemoryConsentStore();
    const intakeStore = new InMemoryIntakeStore();
    const createMessage = (id: string, body: string): OpenWaMessage => ({
      id,
      from: "client-live-1@c.us",
      chatId: "client-live-1@c.us",
      body,
      sender: {
        pushname: "Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-09T09:00:00.000Z")
    });

    const firstResult = await runInboundPipeline(createMessage("wamid.live-1", "ciao"), {
      clientConsentPersistence: consentStore,
      clientIntakePersistence: intakeStore
    });
    const consentResult = await runInboundPipeline(createMessage("wamid.live-2", "Acconsento"), {
      clientConsentPersistence: consentStore,
      clientIntakePersistence: intakeStore
    });
    const identityResult = await runInboundPipeline(
      createMessage("wamid.live-3", "Mario barone roma 01 01 1976"),
      {
        clientConsentPersistence: consentStore,
        clientIntakePersistence: intakeStore
      }
    );
    const summaryResult = await runInboundPipeline(
      createMessage(
        "wamid.live-4",
        "Ho bisogno di assistenza per un problema di lavoro."
      ),
      {
        clientConsentPersistence: consentStore,
        clientIntakePersistence: intakeStore
      }
    );

    expect(firstResult.runtimeDecision.action).toBe("request_consent");
    expect(consentResult.runtimeDecision.action).toBe("intake_ask_identity");
    expect(identityResult.runtimeDecision.action).toBe("intake_ask_problem_summary");
    expect(identityResult.outputPlan.messages[0]?.body).toBe(
      "La ringrazio. Descriva brevemente il problema per cui desidera assistenza."
    );
    expect(summaryResult.runtimeDecision.action).toBe("intake_complete_ack");
    expect(await consentStore.getConsentState("client-live-1@c.us")).toBe("granted");
    await expect(intakeStore.getIntakeSnapshot("client-live-1@c.us")).resolves.toMatchObject({
      subjectId: "client-live-1@c.us",
      state: "intake_complete",
      fields: {
        firstName: "Mario",
        lastName: "Barone",
        birthDate: "01/01/1976",
        city: "Roma",
        problemSummary: "Ho bisogno di assistenza per un problema di lavoro."
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import { runInboundPipeline } from "../../src/app";
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
});

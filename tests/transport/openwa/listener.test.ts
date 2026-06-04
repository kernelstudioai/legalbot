import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/logging/logger";
import { registerOpenWaListener } from "../../../src/transport/openwa/listener";
import type { OpenWaRawMessage } from "../../../src/transport/openwa/types";

const { runInboundPipeline } = vi.hoisted(() => ({
  runInboundPipeline: vi.fn()
}));

vi.mock("../../../src/app/pipeline", () => ({
  runInboundPipeline
}));

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

describe("openwa listener", () => {
  beforeEach(() => {
    runInboundPipeline.mockReset();
  });

  it("calls the pipeline and dispatches the output plan", async () => {
    const rawMessage: OpenWaRawMessage = {
      id: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us",
      body: "Hello, I need a lawyer",
      notifyName: "Prospective Client",
      fromMe: false,
      timestamp: Date.parse("2026-06-04T12:00:00.000Z")
    };
    const pipelineResult = {
      envelope: {
        messageId: "wamid.test-1"
      },
      routingDecision: {
        targetRuntime: "lawyer"
      },
      runtimeDecision: {
        action: "acknowledge"
      },
      outputPlan: {
        messages: [
          {
            kind: "text",
            to: "client-123@c.us",
            body: "Placeholder response"
          }
        ],
        auditNote: "built"
      }
    };
    const dispatch = vi.fn().mockResolvedValue({
      delivered: true,
      messageCount: 1,
      unsupportedCount: 0
    });
    const onMessage = vi.fn(
      async (listener: (message: OpenWaRawMessage) => Promise<void>) => {
        await listener(rawMessage);
        return true;
      }
    );
    const logger = createLogger();
    runInboundPipeline.mockReturnValue(pipelineResult);

    await registerOpenWaListener(
      {
        onMessage
      },
      {
        dispatcher: {
          dispatch
        },
        logger
      }
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(runInboundPipeline).toHaveBeenCalledWith({
      id: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us",
      body: "Hello, I need a lawyer",
      sender: {
        pushname: "Prospective Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-04T12:00:00.000Z")
    });
    expect(dispatch).toHaveBeenCalledWith(pipelineResult.outputPlan);
  });
});

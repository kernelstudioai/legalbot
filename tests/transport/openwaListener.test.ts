import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger";
import { handleOpenWaMessage } from "../../src/transport/openwa/listener";
import type { OpenWaRawMessage } from "../../src/transport/openwa/types";

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createRawMessage = (
  overrides: Partial<OpenWaRawMessage> = {}
): OpenWaRawMessage => ({
  id: "wamid.test-1",
  from: "client-123@c.us",
  chatId: "client-123@c.us",
  body: "Hello, I need a lawyer",
  fromMe: false,
  timestamp: Date.parse("2026-06-04T12:00:00.000Z"),
  ...overrides
});

describe("openwa listener", () => {
  it("ignores self-authored messages", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn()
    };

    const result = await handleOpenWaMessage(createRawMessage({ fromMe: true }), {
      dispatcher,
      logger,
      processedMessageIds: new Set<string>()
    });

    expect(result).toEqual({
      outcome: "ignored_from_self"
    });
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("openwa_message_ignored_from_self", {
      messageId: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us"
    });
  });

  it("ignores duplicate message ids during one process lifetime", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        delivered: true,
        messageCount: 1,
        unsupportedCount: 0
      })
    };
    const processedMessageIds = new Set<string>();

    await handleOpenWaMessage(createRawMessage(), {
      dispatcher,
      logger,
      processedMessageIds
    });

    const duplicateResult = await handleOpenWaMessage(createRawMessage(), {
      dispatcher,
      logger,
      processedMessageIds
    });

    expect(duplicateResult).toEqual({
      outcome: "ignored_duplicate"
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("openwa_message_ignored_duplicate", {
      messageId: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us"
    });
  });

  it("logs dispatcher failures without throwing out of the listener loop", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockRejectedValue(new Error("send_failed"))
    };

    await expect(
      handleOpenWaMessage(createRawMessage(), {
        dispatcher,
        logger,
        processedMessageIds: new Set<string>()
      })
    ).resolves.toMatchObject({
      outcome: "processed",
      dispatchError: "send_failed"
    });

    expect(logger.error).toHaveBeenCalledWith("openwa_dispatch_failed", {
      messageId: "wamid.test-1",
      error: "send_failed"
    });
  });

  it("accepts an injected pipeline runner so transport stays separate from consent persistence", async () => {
    const logger = createLogger();
    const dispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        delivered: true,
        messageCount: 1,
        unsupportedCount: 0
      })
    };
    const pipelineRunner = vi.fn().mockResolvedValue({
      envelope: {
        messageId: "wamid.test-1"
      },
      routingDecision: {
        targetRuntime: "client"
      },
      runtimeDecision: {
        action: "request_consent"
      },
      outputPlan: {
        messages: [
          {
            kind: "text",
            to: "client-123@c.us",
            body: "request consent"
          }
        ],
        auditNote: "built"
      }
    });

    await handleOpenWaMessage(createRawMessage(), {
      dispatcher,
      logger,
      processedMessageIds: new Set<string>(),
      pipelineRunner
    });

    expect(pipelineRunner).toHaveBeenCalledWith({
      id: "wamid.test-1",
      from: "client-123@c.us",
      chatId: "client-123@c.us",
      body: "Hello, I need a lawyer",
      fromMe: false,
      timestamp: Date.parse("2026-06-04T12:00:00.000Z")
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});

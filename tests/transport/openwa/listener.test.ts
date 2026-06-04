import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/logging/logger";
import {
  handleOpenWaMessage,
  registerOpenWaListener
} from "../../../src/transport/openwa/listener";
import type { OpenWaRawMessage } from "../../../src/transport/openwa/types";
import type { OpenWaTechnicalPersistence } from "../../../src/runtime/openwa/technicalPersistence";

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

const createRawMessage = (): OpenWaRawMessage => ({
  id: "wamid.test-1",
  from: "client-123@c.us",
  chatId: "client-123@c.us",
  body: "Hello, I need a lawyer",
  notifyName: "Prospective Client",
  fromMe: false,
  timestamp: Date.parse("2026-06-04T12:00:00.000Z")
});

const createPipelineResult = () => ({
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
});

const createTechnicalPersistence = (
  overrides: Partial<OpenWaTechnicalPersistence> = {}
): OpenWaTechnicalPersistence => ({
  isMessageProcessed: vi.fn().mockResolvedValue(false),
  markMessageProcessed: vi.fn().mockResolvedValue(undefined),
  recordRuntimeStarted: vi.fn().mockResolvedValue(undefined),
  recordRuntimeStopped: vi.fn().mockResolvedValue(undefined),
  recordMessageReceived: vi.fn().mockResolvedValue(undefined),
  recordMessageIgnoredDuplicate: vi.fn().mockResolvedValue(undefined),
  recordOutputDispatched: vi.fn().mockResolvedValue(undefined),
  recordDispatchFailed: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

describe("openwa listener", () => {
  beforeEach(() => {
    runInboundPipeline.mockReset();
  });

  it("calls the pipeline and dispatches the output plan", async () => {
    const rawMessage = createRawMessage();
    const pipelineResult = createPipelineResult();
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
    runInboundPipeline.mockResolvedValue(pipelineResult);

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

  it("checks persistent dedupe before running the pipeline", async () => {
    const logger = createLogger();
    const technicalPersistence = createTechnicalPersistence();
    const dispatch = vi.fn().mockResolvedValue({
      delivered: true,
      messageCount: 1,
      unsupportedCount: 0
    });
    runInboundPipeline.mockResolvedValue(createPipelineResult());

    await handleOpenWaMessage(createRawMessage(), {
      dispatcher: { dispatch },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence
    });

    expect(technicalPersistence.isMessageProcessed).toHaveBeenCalledWith("wamid.test-1");
    expect(runInboundPipeline).toHaveBeenCalledTimes(1);
  });

  it("skips pipeline and dispatch for persistent duplicates", async () => {
    const logger = createLogger();
    const technicalPersistence = createTechnicalPersistence({
      isMessageProcessed: vi.fn().mockResolvedValue(true)
    });
    const dispatch = vi.fn();

    const result = await handleOpenWaMessage(createRawMessage(), {
      dispatcher: { dispatch },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence
    });

    expect(result).toEqual({
      outcome: "ignored_duplicate"
    });
    expect(runInboundPipeline).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(technicalPersistence.recordMessageIgnoredDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wamid.test-1" }),
      "persistent"
    );
  });

  it("marks messages processed after successful dispatch", async () => {
    const logger = createLogger();
    const technicalPersistence = createTechnicalPersistence();
    const dispatchResult = {
      delivered: true,
      messageCount: 1,
      unsupportedCount: 0
    };
    const dispatch = vi.fn().mockResolvedValue(dispatchResult);
    runInboundPipeline.mockResolvedValue(createPipelineResult());

    await handleOpenWaMessage(createRawMessage(), {
      dispatcher: { dispatch },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence
    });

    expect(technicalPersistence.markMessageProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wamid.test-1" })
    );
    expect(technicalPersistence.recordOutputDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wamid.test-1" }),
      dispatchResult
    );
  });

  it("appends audit events for received, duplicate, dispatched, and failed dispatch flows", async () => {
    const logger = createLogger();
    const pipelineResult = createPipelineResult();
    runInboundPipeline.mockResolvedValue(pipelineResult);

    const successPersistence = createTechnicalPersistence();
    const successDispatch = vi.fn().mockResolvedValue({
      delivered: true,
      messageCount: 1,
      unsupportedCount: 0
    });
    await handleOpenWaMessage(createRawMessage(), {
      dispatcher: { dispatch: successDispatch },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence: successPersistence
    });

    const duplicatePersistence = createTechnicalPersistence({
      isMessageProcessed: vi.fn().mockResolvedValue(true)
    });
    await handleOpenWaMessage(createRawMessage(), {
      dispatcher: { dispatch: vi.fn() },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence: duplicatePersistence
    });

    const failedPersistence = createTechnicalPersistence();
    await handleOpenWaMessage(createRawMessage(), {
      dispatcher: {
        dispatch: vi.fn().mockRejectedValue(new Error("dispatch_failed"))
      },
      logger,
      processedMessageIds: new Set<string>(),
      technicalPersistence: failedPersistence
    });

    expect(successPersistence.recordMessageReceived).toHaveBeenCalledTimes(1);
    expect(successPersistence.recordOutputDispatched).toHaveBeenCalledTimes(1);
    expect(duplicatePersistence.recordMessageReceived).toHaveBeenCalledTimes(1);
    expect(duplicatePersistence.recordMessageIgnoredDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wamid.test-1" }),
      "persistent"
    );
    expect(failedPersistence.recordMessageReceived).toHaveBeenCalledTimes(1);
    expect(failedPersistence.recordDispatchFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wamid.test-1" }),
      expect.any(Error)
    );
  });
});

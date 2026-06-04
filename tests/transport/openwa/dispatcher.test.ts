import { describe, expect, it, vi } from "vitest";
import type { OutputPlanType } from "../../../src/contracts";
import { createOpenWaDispatcher } from "../../../src/transport/openwa/dispatcher";

describe("openwa dispatcher", () => {
  it("sends text actions from the output plan", async () => {
    const sendText = vi.fn().mockResolvedValue("ok");
    const dispatcher = createOpenWaDispatcher({ sendText });
    const plan: OutputPlanType = {
      messages: [
        {
          kind: "text",
          to: "client-123@c.us",
          body: "Placeholder response"
        }
      ],
      auditNote: "built"
    };

    const result = await dispatcher.dispatch(plan);

    expect(sendText).toHaveBeenCalledWith("client-123@c.us", "Placeholder response");
    expect(result).toEqual({
      delivered: true,
      messageCount: 1,
      unsupportedCount: 0
    });
  });

  it("ignores unsupported output actions", async () => {
    const sendText = vi.fn().mockResolvedValue("ok");
    const dispatcher = createOpenWaDispatcher({ sendText });
    const plan = {
      messages: [
        {
          kind: "noop",
          to: "client-123@c.us"
        }
      ],
      auditNote: "unsupported"
    } as unknown as OutputPlanType;

    const result = await dispatcher.dispatch(plan);

    expect(sendText).not.toHaveBeenCalled();
    expect(result).toEqual({
      delivered: false,
      messageCount: 0,
      unsupportedCount: 1
    });
  });
});

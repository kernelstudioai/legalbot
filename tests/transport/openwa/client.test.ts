import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenWaClient, createOpenWaConfig } from "../../../src/transport/openwa/client";

const { create } = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("@open-wa/wa-automate", () => ({
  create
}));

describe("openwa client config", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      onMessage: vi.fn(),
      sendText: vi.fn(),
      kill: vi.fn()
    });
  });

  it("passes through an explicit browser executable path when provided", async () => {
    await createOpenWaClient(
      createOpenWaConfig({
        sessionId: "legalbot-smoke",
        browserExecutablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "legalbot-smoke",
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      })
    );
  });

  it("preserves the default launch config when no browser executable path is set", async () => {
    await createOpenWaClient(
      createOpenWaConfig({
        sessionId: "legalbot-smoke"
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        executablePath: expect.anything()
      })
    );
  });
});

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenWaClient,
  createOpenWaConfig,
  OPENWA_DEFAULT_AUTH_TIMEOUT_SECONDS,
  OPENWA_DEFAULT_QR_TIMEOUT_SECONDS,
  OPENWA_SESSION_PATH
} from "../../../src/transport/openwa/client";

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

  it("passes through an explicit browser executable path and enables system chrome detection when provided", async () => {
    await createOpenWaClient(
      createOpenWaConfig({
        sessionId: "legalbot-smoke",
        headless: false,
        authTimeout: 240,
        qrTimeout: 300,
        browserExecutablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "legalbot-smoke",
        headless: false,
        sessionDataPath: path.join(process.cwd(), OPENWA_SESSION_PATH),
        authTimeout: 240,
        qrTimeout: 300,
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        useChrome: true
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
      expect.objectContaining({
        sessionId: "legalbot-smoke",
        headless: false,
        sessionDataPath: path.join(process.cwd(), OPENWA_SESSION_PATH),
        authTimeout: OPENWA_DEFAULT_AUTH_TIMEOUT_SECONDS,
        qrTimeout: OPENWA_DEFAULT_QR_TIMEOUT_SECONDS
      })
    );
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        executablePath: expect.anything()
      })
    );
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        useChrome: expect.anything()
      })
    );
  });
});

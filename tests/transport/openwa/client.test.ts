import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenWaClient,
  createOpenWaConfig,
  OPENWA_CHROMIUM_PROFILE_PREFIX,
  OPENWA_DEFAULT_AUTH_TIMEOUT_SECONDS,
  OPENWA_DEFAULT_QR_TIMEOUT_SECONDS,
  OPENWA_SESSION_PATH,
  toOpenWaConfigObject,
  wrapOpenWaClient
} from "../../../src/transport/openwa/client";

const { create } = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("@open-wa/wa-automate", () => ({
  STATE: {
    CONNECTED: "CONNECTED"
  },
  create
}));

describe("openwa client config", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      onMessage: vi.fn(),
      sendText: vi.fn(),
      getConnectionState: vi.fn().mockResolvedValue("CONNECTED"),
      isConnected: vi.fn().mockResolvedValue(true),
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

  it("removes stale Chromium singleton locks from the OpenWA browser profile before launch", () => {
    const tempSessionPath = mkdtempSync(path.join(os.tmpdir(), "legalbot-openwa-"));
    const profilePath = path.join(
      tempSessionPath,
      `${OPENWA_CHROMIUM_PROFILE_PREFIX}legalbot-smoke`
    );
    const unrelatedProfileFile = path.join(profilePath, "Preferences");

    try {
      mkdirSync(profilePath, { recursive: true });
      writeFileSync(path.join(profilePath, "SingletonCookie"), "stale");
      writeFileSync(path.join(profilePath, "SingletonLock"), "stale");
      writeFileSync(path.join(profilePath, "SingletonSocket"), "stale");
      writeFileSync(unrelatedProfileFile, "{}");

      toOpenWaConfigObject(
        createOpenWaConfig({
          sessionId: "legalbot-smoke",
          sessionDataPath: tempSessionPath
        })
      );

      expect(existsSync(path.join(profilePath, "SingletonCookie"))).toBe(false);
      expect(existsSync(path.join(profilePath, "SingletonLock"))).toBe(false);
      expect(existsSync(path.join(profilePath, "SingletonSocket"))).toBe(false);
      expect(existsSync(unrelatedProfileFile)).toBe(true);
    } finally {
      rmSync(tempSessionPath, { recursive: true, force: true });
    }
  });

  it("wraps a read-only liveness check without sending transport messages", async () => {
    const sendText = vi.fn();
    const getConnectionState = vi.fn().mockResolvedValue("CONNECTED");
    const isConnected = vi.fn().mockResolvedValue(true);
    const client = wrapOpenWaClient({
      onMessage: vi.fn(),
      sendText,
      getConnectionState,
      isConnected,
      kill: vi.fn()
    });

    await expect(client.checkLiveness?.()).resolves.toEqual({
      mode: "read_only",
      connectionState: "CONNECTED",
      connected: true
    });
    expect(sendText).not.toHaveBeenCalled();
  });
});

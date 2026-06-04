import { describe, expect, it } from "vitest";
import { loadSmokeRuntimeEnv } from "../../src/config/env";

describe("smoke runtime env", () => {
  it("defaults smoke headless mode to false", () => {
    const env = loadSmokeRuntimeEnv({
      BOT_MODE: "smoke",
      OPENWA_SESSION_ID: "legalbot-smoke",
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.OPENWA_HEADLESS).toBe(false);
    expect(env.OPENWA_QR_TIMEOUT_SECONDS).toBeUndefined();
    expect(env.OPENWA_AUTH_TIMEOUT_SECONDS).toBeUndefined();
  });

  it("accepts an optional browser executable path", () => {
    const env = loadSmokeRuntimeEnv({
      BOT_MODE: "smoke",
      OPENWA_SESSION_ID: "legalbot-smoke",
      OPENWA_BROWSER_EXECUTABLE_PATH:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.OPENWA_BROWSER_EXECUTABLE_PATH).toBe(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    );
  });

  it("parses optional timeout overrides", () => {
    const env = loadSmokeRuntimeEnv({
      BOT_MODE: "smoke",
      OPENWA_SESSION_ID: "legalbot-smoke",
      OPENWA_QR_TIMEOUT_SECONDS: "240",
      OPENWA_AUTH_TIMEOUT_SECONDS: "180",
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.OPENWA_QR_TIMEOUT_SECONDS).toBe(240);
    expect(env.OPENWA_AUTH_TIMEOUT_SECONDS).toBe(180);
  });

  it("rejects an empty browser executable path", () => {
    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_BROWSER_EXECUTABLE_PATH: "",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();
  });

  it("rejects negative timeout overrides", () => {
    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_QR_TIMEOUT_SECONDS: "-1",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();
  });
});

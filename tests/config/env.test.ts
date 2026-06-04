import { describe, expect, it } from "vitest";
import { loadSmokeRuntimeEnv } from "../../src/config/env";

describe("smoke runtime env", () => {
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
});

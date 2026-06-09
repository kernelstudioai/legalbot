import { describe, expect, it } from "vitest";
import { loadEnv, loadSmokeRuntimeEnv } from "../../src/config/env";

describe("base app env", () => {
  it("loads persistence defaults without OpenWA-specific env vars", () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OPENWA_HEADLESS).toBe(true);
    expect(env.DATABASE_URL).toBe("file:./data/legalbot.sqlite");
    expect(env.DATABASE_MIGRATIONS_ENABLED).toBe(true);
    expect(env.BUSINESS_PERSISTENCE_ENABLED).toBe(true);
    expect(env.TECHNICAL_PERSISTENCE_ENABLED).toBe(true);
  });
});

describe("smoke runtime env", () => {
  it("uses product-like runtime defaults when optional vars are absent", () => {
    const env = loadSmokeRuntimeEnv({
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.BOT_MODE).toBe("smoke");
    expect(env.OPENWA_SESSION_ID).toBe("legalbot-smoke");
    expect(env.OPENWA_HEADLESS).toBe(false);
    expect(env.OPENWA_QR_TIMEOUT_SECONDS).toBeUndefined();
    expect(env.OPENWA_AUTH_TIMEOUT_SECONDS).toBeUndefined();
    expect(env.OPENWA_STARTUP_MAX_ATTEMPTS).toBe(1);
    expect(env.OPENWA_STARTUP_RETRY_DELAY_SECONDS).toBe(5);
    expect(env.OPENWA_LIVENESS_INTERVAL_SECONDS).toBe(30);
    expect(env.OPENWA_LIVENESS_FAILURE_THRESHOLD).toBe(3);
    expect(env.OPENWA_RECOVERY_MODE).toBe("manual");
    expect(env.OPENWA_RECOVERY_MAX_ATTEMPTS).toBe(0);
    expect(env.OPENWA_RECOVERY_RETRY_DELAY_SECONDS).toBe(10);
    expect(env.OPENWA_STATUS_SERVER_ENABLED).toBe(true);
    expect(env.OPENWA_STATUS_SERVER_HOST).toBe("127.0.0.1");
    expect(env.OPENWA_STATUS_SERVER_PORT).toBe(3001);
    expect(env.DATABASE_URL).toBe("file:./data/legalbot.sqlite");
    expect(env.DATABASE_MIGRATIONS_ENABLED).toBe(true);
    expect(env.BUSINESS_PERSISTENCE_ENABLED).toBe(true);
    expect(env.TECHNICAL_PERSISTENCE_ENABLED).toBe(true);
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
      OPENWA_STARTUP_MAX_ATTEMPTS: "3",
      OPENWA_STARTUP_RETRY_DELAY_SECONDS: "7",
      OPENWA_LIVENESS_INTERVAL_SECONDS: "45",
      OPENWA_LIVENESS_FAILURE_THRESHOLD: "4",
      OPENWA_RECOVERY_MODE: "restart_client",
      OPENWA_RECOVERY_MAX_ATTEMPTS: "2",
      OPENWA_RECOVERY_RETRY_DELAY_SECONDS: "11",
      OPENWA_STATUS_SERVER_ENABLED: "true",
      OPENWA_STATUS_SERVER_HOST: "127.0.0.1",
      OPENWA_STATUS_SERVER_PORT: "3009",
      DATABASE_URL: "file:./data/test.sqlite",
      DATABASE_MIGRATIONS_ENABLED: "false",
      BUSINESS_PERSISTENCE_ENABLED: "false",
      TECHNICAL_PERSISTENCE_ENABLED: "true",
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.OPENWA_QR_TIMEOUT_SECONDS).toBe(240);
    expect(env.OPENWA_AUTH_TIMEOUT_SECONDS).toBe(180);
    expect(env.OPENWA_STARTUP_MAX_ATTEMPTS).toBe(3);
    expect(env.OPENWA_STARTUP_RETRY_DELAY_SECONDS).toBe(7);
    expect(env.OPENWA_LIVENESS_INTERVAL_SECONDS).toBe(45);
    expect(env.OPENWA_LIVENESS_FAILURE_THRESHOLD).toBe(4);
    expect(env.OPENWA_RECOVERY_MODE).toBe("restart_client");
    expect(env.OPENWA_RECOVERY_MAX_ATTEMPTS).toBe(2);
    expect(env.OPENWA_RECOVERY_RETRY_DELAY_SECONDS).toBe(11);
    expect(env.OPENWA_STATUS_SERVER_ENABLED).toBe(true);
    expect(env.OPENWA_STATUS_SERVER_HOST).toBe("127.0.0.1");
    expect(env.OPENWA_STATUS_SERVER_PORT).toBe(3009);
    expect(env.DATABASE_URL).toBe("file:./data/test.sqlite");
    expect(env.DATABASE_MIGRATIONS_ENABLED).toBe(false);
    expect(env.BUSINESS_PERSISTENCE_ENABLED).toBe(false);
    expect(env.TECHNICAL_PERSISTENCE_ENABLED).toBe(true);
  });

  it("defaults restart_client recovery attempts to one when not explicitly set", () => {
    const env = loadSmokeRuntimeEnv({
      BOT_MODE: "smoke",
      OPENWA_SESSION_ID: "legalbot-smoke",
      OPENWA_RECOVERY_MODE: "restart_client",
      LAWYER_PHONE_E164: "+15551234567"
    });

    expect(env.OPENWA_RECOVERY_MODE).toBe("restart_client");
    expect(env.OPENWA_RECOVERY_MAX_ATTEMPTS).toBe(1);
  });

  it("requires LAWYER_PHONE_E164 for the runtime env", () => {
    expect(() => loadSmokeRuntimeEnv({})).toThrow();
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

  it("rejects invalid startup retry settings", () => {
    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_STARTUP_MAX_ATTEMPTS: "0",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();

    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_STARTUP_RETRY_DELAY_SECONDS: "-1",
        OPENWA_LIVENESS_FAILURE_THRESHOLD: "0",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();

    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_RECOVERY_MODE: "restart_client",
        OPENWA_RECOVERY_MAX_ATTEMPTS: "-1",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();

    expect(() =>
      loadSmokeRuntimeEnv({
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_STATUS_SERVER_PORT: "70000",
        LAWYER_PHONE_E164: "+15551234567"
      })
    ).toThrow();
  });
});

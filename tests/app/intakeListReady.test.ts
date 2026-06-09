import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInboundPipeline } from "../../src/app/index.ts";
import type { Logger } from "../../src/logging/logger.ts";
import { createSqlitePersistenceService } from "../../src/persistence/index.ts";
import { startOpenWaSmokeApp } from "../../src/app/openwaSmoke.ts";
import { runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runIntakeListReadyCommand } from "../../src/app/intakeListReady.ts";
import { toOperatorSubjectId } from "../../src/app/operatorSubjectId.ts";
import type { OpenWaMessage } from "../../src/transport/openwa/types.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-intake-list-ready-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

const createLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

const createStdout = () => {
  let output = "";

  return {
    get output() {
      return output;
    },
    write(chunk: string) {
      output += chunk;
    }
  };
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

const setCompleteIdentity = async (
  persistence: ReturnType<typeof createSqlitePersistenceService>,
  subjectId: string,
  values: {
    firstName: string;
    lastName: string;
    birthDate: string;
    city: string;
    problemSummary?: string;
  }
) => {
  await persistence.setIntakeField(subjectId, "firstName", values.firstName);
  await persistence.setIntakeField(subjectId, "lastName", values.lastName);
  await persistence.setIntakeField(subjectId, "birthDate", values.birthDate);
  await persistence.setIntakeField(subjectId, "city", values.city);

  if (values.problemSummary) {
    await persistence.setIntakeField(subjectId, "problemSummary", values.problemSummary);
  }
};

describe("ready-intake listing command", () => {
  it("fails safely when migrations are missing", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();

    const summary = await runIntakeListReadyCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: "file:./data/legalbot.sqlite",
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(1);
    expect(summary.candidates).toBeUndefined();
    expect(stdout.output).toBe("");
    expect(logger.error).toHaveBeenCalledWith("intake_list_ready_failed", {
      error:
        "Ready-intake listing requires an existing migrated SQLite database. Run npm run db:migrate first."
    });
  });

  it("lists only completed consent-granted intakes with sanitized ready output", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const readyPhoneSubjectId = "15551234567@c.us";
    const readyGenericSubjectId = "subject-ready-generic";
    const incompleteSubjectId = "subject-incomplete";
    const missingFieldSubjectId = "subject-missing-field";
    const consentRequestedSubjectId = "subject-consent-requested";

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await persistence.setConsentState(readyPhoneSubjectId, "granted");
      await persistence.setIntakeState(readyPhoneSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T08:00:00.000Z"
      });
      await setCompleteIdentity(persistence, readyPhoneSubjectId, {
        firstName: "Mario",
        lastName: "Rossi",
        birthDate: "01/01/1980",
        city: "Roma",
        problemSummary: "Transcript body secret should never print"
      });

      await persistence.setConsentState(readyGenericSubjectId, "granted");
      await persistence.setIntakeState(readyGenericSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T09:00:00.000Z"
      });
      await setCompleteIdentity(persistence, readyGenericSubjectId, {
        firstName: "Giulia",
        lastName: "Verdi",
        birthDate: "02/02/1985",
        city: "Milano",
        problemSummary: "Token abc1234567890123456789012345 should never print"
      });

      await persistence.setConsentState(incompleteSubjectId, "granted");
      await persistence.setIntakeState(incompleteSubjectId, "asking_problem_summary", {
        updatedAt: "2026-06-06T10:00:00.000Z"
      });
      await setCompleteIdentity(persistence, incompleteSubjectId, {
        firstName: "Incomplete",
        lastName: "Name",
        birthDate: "03/03/1990",
        city: "Napoli"
      });

      await persistence.setConsentState(missingFieldSubjectId, "granted");
      await persistence.setIntakeState(missingFieldSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T11:00:00.000Z"
      });
      await persistence.setIntakeField(missingFieldSubjectId, "firstName", "Missing");
      await persistence.setIntakeField(missingFieldSubjectId, "lastName", "Summary");
      await persistence.setIntakeField(missingFieldSubjectId, "birthDate", "04/04/1991");
      await persistence.setIntakeField(missingFieldSubjectId, "city", "Torino");

      await persistence.setConsentState(consentRequestedSubjectId, "requested");
      await persistence.setIntakeState(consentRequestedSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T12:00:00.000Z"
      });
      await setCompleteIdentity(persistence, consentRequestedSubjectId, {
        firstName: "No",
        lastName: "Consent",
        birthDate: "05/05/1992",
        city: "Genova",
        problemSummary: "Should stay out of ready list"
      });
    } finally {
      persistence.close();
    }

    const summary = await runIntakeListReadyCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.candidates).toEqual([
      {
        subjectId: toOperatorSubjectId(readyPhoneSubjectId),
        intakeState: "intake_complete",
        updatedAt: "2026-06-06T08:00:00.000Z",
        fieldNamesPresent: ["firstName", "lastName", "birthDate", "city", "problemSummary"]
      },
      {
        subjectId: toOperatorSubjectId(readyGenericSubjectId),
        intakeState: "intake_complete",
        updatedAt: "2026-06-06T09:00:00.000Z",
        fieldNamesPresent: ["firstName", "lastName", "birthDate", "city", "problemSummary"]
      }
    ]);
    expect(stdout.output).toBe(`${JSON.stringify(summary.candidates)}\n`);
    expect(stdout.output).not.toContain(readyPhoneSubjectId);
    expect(stdout.output).not.toContain(readyGenericSubjectId);
    expect(stdout.output).not.toContain(incompleteSubjectId);
    expect(stdout.output).not.toContain(missingFieldSubjectId);
    expect(stdout.output).not.toContain(consentRequestedSubjectId);
    expect(stdout.output).not.toContain("Mario Rossi");
    expect(stdout.output).not.toContain("Giulia Verdi");
    expect(stdout.output).not.toContain("Transcript body secret should never print");
    expect(stdout.output).not.toContain("Token abc1234567890123456789012345 should never print");
    expect(stdout.output).not.toContain("15551234567");
    expect(stdout.output).not.toContain("body");
    expect(stdout.output).not.toContain("transcript");
    expect(stdout.output).not.toContain("token");
    expect(JSON.parse(stdout.output)).toEqual(summary.candidates);
    expect(Object.keys(summary.candidates?.[0] ?? {})).toEqual([
      "subjectId",
      "intakeState",
      "updatedAt",
      "fieldNamesPresent"
    ]);
    expect(logger.info).toHaveBeenCalledWith("intake_list_ready_starting", {
      migrations_enabled: true
    });
    expect(logger.info).toHaveBeenCalledWith("intake_list_ready_checked", {
      candidate_count: 2
    });
  });

  it("lists a sanitized ready candidate after the completed live intake flow", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "15551230000@c.us";
    const createMessage = (id: string, body: string): OpenWaMessage => ({
      id,
      from: subjectId,
      chatId: subjectId,
      body,
      sender: {
        pushname: "Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-09T09:00:00.000Z")
    });

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await runInboundPipeline(createMessage("wamid.flow-1", "ciao"), {
        clientConsentPersistence: persistence,
        clientIntakePersistence: persistence
      });
      await runInboundPipeline(createMessage("wamid.flow-2", "Acconsento"), {
        clientConsentPersistence: persistence,
        clientIntakePersistence: persistence
      });
      await runInboundPipeline(
        createMessage("wamid.flow-3", "Mario barone roma 01 01 1976"),
        {
          clientConsentPersistence: persistence,
          clientIntakePersistence: persistence
        }
      );
      await runInboundPipeline(
        createMessage(
          "wamid.flow-4",
          "Ho bisogno di assistenza per un problema di lavoro."
        ),
        {
          clientConsentPersistence: persistence,
          clientIntakePersistence: persistence
        }
      );
    } finally {
      persistence.close();
    }

    const summary = await runIntakeListReadyCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.candidates).toEqual([
      {
        subjectId: toOperatorSubjectId(subjectId),
        intakeState: "intake_complete",
        updatedAt: expect.any(String),
        fieldNamesPresent: ["firstName", "lastName", "birthDate", "city", "problemSummary"]
      }
    ]);
    expect(stdout.output).not.toContain(subjectId);
    expect(stdout.output).not.toContain("15551230000");
    expect(stdout.output).not.toContain("Mario");
    expect(stdout.output).not.toContain("problema di lavoro");
  });

  it("keeps business-state persistence active when technical persistence is disabled", async () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();
    const databaseUrl = "file:./data/legalbot.sqlite";
    const subjectId = "15551230001@c.us";
    let onMessageListener:
      | ((message: OpenWaMessage) => Promise<void> | void)
      | undefined;

    runSqliteMigrations({
      databaseUrl,
      cwd: tempDir,
      enabled: true
    });

    const app = await startOpenWaSmokeApp({
      cwd: tempDir,
      envSource: {
        BOT_MODE: "smoke",
        OPENWA_SESSION_ID: "legalbot-smoke",
        OPENWA_HEADLESS: "false",
        OPENWA_STATUS_SERVER_ENABLED: "false",
        TECHNICAL_PERSISTENCE_ENABLED: "false",
        LAWYER_PHONE_E164: "+15551234567",
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      createClient: async () => ({
        onMessage: vi.fn().mockImplementation(async (listener) => {
          onMessageListener = listener;
        }),
        sendText: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(true)
      })
    });

    const createMessage = (id: string, body: string): OpenWaMessage => ({
      id,
      from: subjectId,
      chatId: subjectId,
      body,
      sender: {
        pushname: "Client"
      },
      fromMe: false,
      timestamp: Date.parse("2026-06-09T09:00:00.000Z")
    });

    await onMessageListener?.(createMessage("wamid.m27-1", "ciao"));
    await onMessageListener?.(createMessage("wamid.m27-2", "Acconsento"));
    await onMessageListener?.(createMessage("wamid.m27-3", "Mario barone roma 01 01 1976"));
    await onMessageListener?.(
      createMessage("wamid.m27-4", "Ho bisogno di assistenza per un problema di lavoro.")
    );
    await app.stop("test_shutdown");

    const persistence = createSqlitePersistenceService({
      databaseUrl,
      cwd: tempDir
    });

    try {
      await expect(persistence.getConsentState(subjectId)).resolves.toBe("granted");
      await expect(persistence.getIntakeSnapshot(subjectId)).resolves.toMatchObject({
        subjectId,
        state: "intake_complete",
        fields: {
          firstName: "Mario",
          lastName: "Barone",
          birthDate: "01/01/1976",
          city: "Roma",
          problemSummary: "Ho bisogno di assistenza per un problema di lavoro."
        }
      });
    } finally {
      persistence.close();
    }

    const summary = await runIntakeListReadyCommand({
      cwd: tempDir,
      envSource: {
        DATABASE_URL: databaseUrl,
        DATABASE_MIGRATIONS_ENABLED: "true"
      },
      logger,
      stdout
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.candidates).toEqual([
      {
        subjectId: toOperatorSubjectId(subjectId),
        intakeState: "intake_complete",
        updatedAt: expect.any(String),
        fieldNamesPresent: ["firstName", "lastName", "birthDate", "city", "problemSummary"]
      }
    ]);
    expect(stdout.output).not.toContain(subjectId);
    expect(stdout.output).not.toContain("15551230001");
    expect(stdout.output).not.toContain("problema di lavoro");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/logging/logger.ts";
import { createSqlitePersistenceService } from "../../src/persistence/index.ts";
import { runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";
import { runIntakeListReadyCommand } from "../../src/app/intakeListReady.ts";
import { toOperatorSubjectId } from "../../src/app/operatorSubjectId.ts";

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

describe("ready-intake listing command", () => {
  it("fails safely when migrations are missing", () => {
    const tempDir = createTempDir();
    const logger = createLogger();
    const stdout = createStdout();

    const summary = runIntakeListReadyCommand({
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
      await persistence.setIntakeField(readyPhoneSubjectId, "name", "Mario Rossi");
      await persistence.setIntakeField(
        readyPhoneSubjectId,
        "problemSummary",
        "Transcript body secret should never print"
      );

      await persistence.setConsentState(readyGenericSubjectId, "granted");
      await persistence.setIntakeState(readyGenericSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T09:00:00.000Z"
      });
      await persistence.setIntakeField(readyGenericSubjectId, "name", "Giulia Verdi");
      await persistence.setIntakeField(
        readyGenericSubjectId,
        "problemSummary",
        "Token abc1234567890123456789012345 should never print"
      );

      await persistence.setConsentState(incompleteSubjectId, "granted");
      await persistence.setIntakeState(incompleteSubjectId, "asking_problem_summary", {
        updatedAt: "2026-06-06T10:00:00.000Z"
      });
      await persistence.setIntakeField(incompleteSubjectId, "name", "Incomplete Name");

      await persistence.setConsentState(missingFieldSubjectId, "granted");
      await persistence.setIntakeState(missingFieldSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T11:00:00.000Z"
      });
      await persistence.setIntakeField(missingFieldSubjectId, "name", "Missing Problem Summary");

      await persistence.setConsentState(consentRequestedSubjectId, "requested");
      await persistence.setIntakeState(consentRequestedSubjectId, "intake_complete", {
        updatedAt: "2026-06-06T12:00:00.000Z"
      });
      await persistence.setIntakeField(consentRequestedSubjectId, "name", "No Consent");
      await persistence.setIntakeField(
        consentRequestedSubjectId,
        "problemSummary",
        "Should stay out of ready list"
      );
    } finally {
      persistence.close();
    }

    const summary = runIntakeListReadyCommand({
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
        fieldNamesPresent: ["name", "problemSummary"]
      },
      {
        subjectId: toOperatorSubjectId(readyGenericSubjectId),
        intakeState: "intake_complete",
        updatedAt: "2026-06-06T09:00:00.000Z",
        fieldNamesPresent: ["name", "problemSummary"]
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
});

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaseDraftUniquenessError,
  createSqlitePersistenceService
} from "../../src/persistence/index.ts";
import { runSqliteMigrations } from "../../src/persistence/sqlite/index.ts";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "legalbot-case-uniqueness-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("sqlite case uniqueness mapping", () => {
  it("maps duplicate draft inserts to a safe domain error", async () => {
    const tempDir = createTempDir();
    const databaseUrl = "file:./data/legalbot.sqlite";

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
      await persistence.createCase({
        caseId: "CASE-PRIMARY-1",
        subjectId: "subject-dup",
        status: "draft",
        name: "Mario Rossi",
        problemSummary: "Primary sanitized summary",
        createdAt: "2026-06-05T10:00:00.000Z",
        updatedAt: "2026-06-05T10:00:00.000Z"
      });

      let thrown: unknown;

      try {
        await persistence.createCase({
          caseId: "CASE-DUPLICATE-1",
          subjectId: "subject-dup",
          status: "draft",
          name: "Mario Rossi",
          problemSummary: "transcript secret body token 12345678901234567890",
          createdAt: "2026-06-05T10:05:00.000Z",
          updatedAt: "2026-06-05T10:05:00.000Z"
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CaseDraftUniquenessError);
      expect(thrown).toMatchObject({
        name: "CaseDraftUniquenessError",
        code: "draft_case_already_exists",
        message: "A draft case already exists for this subject."
      });

      const safeMessage = thrown instanceof Error ? thrown.message : "";
      expect(safeMessage).not.toContain("UNIQUE constraint failed");
      expect(safeMessage).not.toContain(tempDir);
      expect(safeMessage).not.toContain("subject-dup");
      expect(safeMessage).not.toContain("transcript");
      expect(safeMessage).not.toContain("secret");
      expect(safeMessage).not.toContain("body");
      expect(safeMessage).not.toContain("12345678901234567890");
    } finally {
      persistence.close();
    }
  });
});

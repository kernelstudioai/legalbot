import { ZodError } from "zod";
import { loadEnv } from "../config/env.ts";
import {
  createSqliteBusinessPersistenceService,
  type IntakeFieldName,
  type SqliteBusinessPersistenceService
} from "../persistence/index.ts";
import { assertSqliteMigrationsApplied } from "../persistence/sqlite/index.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";
import { toOperatorSubjectId } from "./operatorSubjectId.ts";

export interface IntakeListReadyCommandOptions {
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  logger?: Logger;
  stdout?: {
    write(chunk: string): void;
  };
  createSqliteBusinessPersistenceServiceFactory?: (config: {
    databaseUrl: string;
    cwd: string;
  }) => SqliteBusinessPersistenceService;
}

export interface IntakeListReadyCandidate {
  subjectId: string;
  intakeState: "intake_complete";
  updatedAt: string;
  fieldNamesPresent: IntakeFieldName[];
}

export interface IntakeListReadySummary extends DbCommandSummary {
  candidates?: IntakeListReadyCandidate[];
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

const toReadyIntakeMigrationMessage = (message: string): string =>
  message
    .replace("Technical persistence", "Ready-intake listing")
    .replace(" before enabling TECHNICAL_PERSISTENCE_ENABLED", " first");

export const runIntakeListReadyCommand = async ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout,
  createSqliteBusinessPersistenceServiceFactory = createSqliteBusinessPersistenceService
}: IntakeListReadyCommandOptions = {}): Promise<IntakeListReadySummary> => {
  let businessPersistence: SqliteBusinessPersistenceService | undefined;

  try {
    const env = loadEnv(envSource);

    logger.info("intake_list_ready_starting", {
      migrations_enabled: env.DATABASE_MIGRATIONS_ENABLED
    });

    try {
      assertSqliteMigrationsApplied({
        databaseUrl: env.DATABASE_URL,
        cwd
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(toReadyIntakeMigrationMessage(error.message));
      }

      throw error;
    }
    businessPersistence = createSqliteBusinessPersistenceServiceFactory({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    const candidates = (await businessPersistence.listReadyIntakeCandidates()).map((candidate) => ({
      subjectId: toOperatorSubjectId(candidate.subjectId),
      intakeState: candidate.intakeState,
      updatedAt: candidate.updatedAt,
      fieldNamesPresent: candidate.fieldNamesPresent
    }));

    stdout.write(`${JSON.stringify(candidates)}\n`);
    logger.info("intake_list_ready_checked", {
      candidate_count: candidates.length
    });

    return {
      exitCode: 0,
      candidates
    };
  } catch (error) {
    logger.error("intake_list_ready_failed", {
      error: toErrorMessage(error)
    });

    return {
      exitCode: 1
    };
  } finally {
    businessPersistence?.close?.();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(await runIntakeListReadyCommand());
}

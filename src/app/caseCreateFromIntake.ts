import { ZodError } from "zod";
import {
  CaseCreationPreconditionError,
  createCaseCreationService,
  type CaseCreationService
} from "../domain/cases/caseCreationService.ts";
import { loadEnv } from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import {
  CaseDraftUniquenessError,
  createSqliteBusinessPersistenceService,
  type BusinessPersistenceService,
  type SqliteBusinessPersistenceService
} from "../persistence/index.ts";
import {
  exitWithCode,
  isDirectExecution,
  type DbCommandSummary
} from "./dbCommandCommon.ts";
import { assertSqliteMigrationsApplied } from "../persistence/sqlite/index.ts";
import { isOperatorSubjectId } from "./operatorSubjectId.ts";

export interface CaseCreateFromIntakeCommandOptions {
  argv?: string[];
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
  createCaseCreationServiceFactory?: (options: {
    persistence: BusinessPersistenceService;
  }) => CaseCreationService;
  verifyMigrationsApplied?: (options: { databaseUrl: string; cwd: string }) => void;
}

export interface CaseCreateFromIntakeSummary extends DbCommandSummary {
  result?: {
    caseId: string;
    status: string;
    createdAt: string;
  };
}

const parseSubjectIdArg = (argv: string[]): string => {
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--subject") {
      const value = args[index + 1]?.trim();

      if (!value) {
        throw new Error("Missing required value for --subject");
      }

      return value;
    }

    if (arg.startsWith("--subject=")) {
      const value = arg.slice("--subject=".length).trim();

      if (!value) {
        throw new Error("Missing required value for --subject");
      }

      return value;
    }
  }

  throw new Error("Missing required --subject <subjectId> argument");
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error instanceof Error ? error.message : "unknown_error";
};

const toManualCaseCreationMigrationMessage = (message: string): string =>
  message
    .replace("Technical persistence", "Manual case creation")
    .replace(" before enabling TECHNICAL_PERSISTENCE_ENABLED", " first");

const verifySqliteMigrationsAppliedForCaseCreation = ({
  databaseUrl,
  cwd
}: {
  databaseUrl: string;
  cwd: string;
}): void => {
  try {
    assertSqliteMigrationsApplied({
      databaseUrl,
      cwd
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    throw new Error(toManualCaseCreationMigrationMessage(error.message));
  }
};

const toSanitizedResult = (result: {
  caseRecord: {
    caseId: string;
    status: string;
    createdAt: string;
  };
}): {
  caseId: string;
  status: string;
  createdAt: string;
} => ({
  caseId: result.caseRecord.caseId,
  status: result.caseRecord.status,
  createdAt: result.caseRecord.createdAt
});

export const runCaseCreateFromIntakeCommand = async ({
  argv = process.argv,
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout,
  createSqliteBusinessPersistenceServiceFactory = createSqliteBusinessPersistenceService,
  createCaseCreationServiceFactory = createCaseCreationService,
  verifyMigrationsApplied = verifySqliteMigrationsAppliedForCaseCreation
}: CaseCreateFromIntakeCommandOptions = {}): Promise<CaseCreateFromIntakeSummary> => {
  let businessPersistence: SqliteBusinessPersistenceService | undefined;

  try {
    const requestedSubjectId = parseSubjectIdArg(argv);
    const env = loadEnv(envSource);
    verifyMigrationsApplied({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    logger.info("case_create_from_intake_starting");

    businessPersistence = createSqliteBusinessPersistenceServiceFactory({
      databaseUrl: env.DATABASE_URL,
      cwd
    });
    const subjectId = isOperatorSubjectId(requestedSubjectId)
      ? ((await businessPersistence.resolveReadyIntakeSubjectId(requestedSubjectId)) ??
        (() => {
          throw new Error(
            "Unknown operator subjectId. Run npm run intake:list-ready again before manual case creation."
          );
        })())
      : requestedSubjectId;

    const caseCreationService = createCaseCreationServiceFactory({
      persistence: businessPersistence
    });
    const result = await caseCreationService.createCaseFromCompletedIntake(subjectId);
    const sanitizedResult = toSanitizedResult(result);

    stdout.write(`${JSON.stringify(sanitizedResult)}\n`);
    logger.info("case_create_from_intake_complete", sanitizedResult);

    return {
      exitCode: 0,
      result: sanitizedResult
    };
  } catch (error) {
    logger.error("case_create_from_intake_failed", {
      ...(error instanceof CaseCreationPreconditionError || error instanceof CaseDraftUniquenessError
        ? { code: error.code }
        : {}),
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
  exitWithCode(await runCaseCreateFromIntakeCommand());
}

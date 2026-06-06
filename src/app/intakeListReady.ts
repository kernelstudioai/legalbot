import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import { loadEnv } from "../config/env.ts";
import { intakeFieldNames, type IntakeFieldName } from "../persistence/index.ts";
import { resolveSqliteDatabasePath, sqliteMigrations } from "../persistence/sqlite/index.ts";
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

const openVerifiedDatabase = ({
  databaseUrl,
  cwd
}: {
  databaseUrl: string;
  cwd: string;
}): DatabaseSync => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(
      "Ready-intake listing requires an existing migrated SQLite database. Run npm run db:migrate first."
    );
  }

  const database = new DatabaseSync(databasePath);

  try {
    const migrationTable = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'schema_migrations'
        `
      )
      .get() as { name: string } | undefined;

    if (!migrationTable) {
      throw new Error(
        "Ready-intake listing requires existing migrations. Run npm run db:migrate first."
      );
    }

    const appliedMigrationIds = (
      database
        .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
        .all() as Array<{ migration_id: string }>
    ).map((row) => row.migration_id);
    const pendingMigrationIds = sqliteMigrations
      .map((migration) => migration.id)
      .filter((migrationId) => !appliedMigrationIds.includes(migrationId));

    if (pendingMigrationIds.length > 0) {
      throw new Error(
        `Ready-intake listing requires completed migrations. Pending migrations: ${pendingMigrationIds.join(", ")}. Run npm run db:migrate first.`
      );
    }

    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};

const listReadyCandidates = (database: DatabaseSync): IntakeListReadyCandidate[] => {
  const rows = database.prepare(
    `
      SELECT
        intake_states.subject_id,
        intake_states.updated_at,
        intake_fields.field_name
      FROM intake_states
      INNER JOIN consent_states
        ON consent_states.subject_id = intake_states.subject_id
      INNER JOIN intake_fields
        ON intake_fields.subject_id = intake_states.subject_id
      WHERE intake_states.intake_state = 'intake_complete'
        AND consent_states.consent_state = 'granted'
        AND intake_fields.field_name IN ('name', 'problemSummary')
      ORDER BY intake_states.updated_at ASC, intake_states.subject_id ASC, intake_fields.field_name ASC
    `
  ).all() as Array<{
    subject_id: string;
    updated_at: string;
    field_name: IntakeFieldName;
  }>;

  const grouped = new Map<
    string,
    {
      updatedAt: string;
      fieldNamesPresent: Set<IntakeFieldName>;
    }
  >();

  for (const row of rows) {
    const candidate =
      grouped.get(row.subject_id) ??
      {
        updatedAt: row.updated_at,
        fieldNamesPresent: new Set<IntakeFieldName>()
      };

    candidate.fieldNamesPresent.add(row.field_name);
    grouped.set(row.subject_id, candidate);
  }

  return [...grouped.entries()]
    .filter(([, candidate]) =>
      intakeFieldNames.every((fieldName) => candidate.fieldNamesPresent.has(fieldName))
    )
    .map(([subjectId, candidate]) => ({
      subjectId: toOperatorSubjectId(subjectId),
      intakeState: "intake_complete",
      updatedAt: candidate.updatedAt,
      fieldNamesPresent: intakeFieldNames.filter((fieldName) =>
        candidate.fieldNamesPresent.has(fieldName)
      )
    }));
};

export const runIntakeListReadyCommand = ({
  cwd = process.cwd(),
  envSource = process.env,
  logger = consoleLogger,
  stdout = process.stdout
}: IntakeListReadyCommandOptions = {}): IntakeListReadySummary => {
  let database: DatabaseSync | undefined;

  try {
    const env = loadEnv(envSource);

    logger.info("intake_list_ready_starting", {
      migrations_enabled: env.DATABASE_MIGRATIONS_ENABLED
    });

    database = openVerifiedDatabase({
      databaseUrl: env.DATABASE_URL,
      cwd
    });

    const candidates = listReadyCandidates(database);

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
    database?.close();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runIntakeListReadyCommand());
}

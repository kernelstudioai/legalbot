import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "./database.ts";
import type { SqliteMigration } from "./migrations.ts";
import { sqliteMigrations } from "./migrations.ts";
import { resolveSqliteDatabasePath } from "./database.ts";

export interface SqliteMigrationRunnerOptions {
  enabled?: boolean;
}

export interface SqliteMigrationRunResult {
  appliedMigrationIds: string[];
  pendingMigrationIds: string[];
  skipped: boolean;
}

export interface SqliteMigrationStatusResult {
  appliedMigrationIds: string[];
  pendingMigrationIds: string[];
}

export class SqliteMigrationRunner {
  private readonly database: DatabaseSync;
  private readonly migrations: SqliteMigration[];
  private readonly now: () => string;

  constructor(
    database: DatabaseSync,
    migrations: SqliteMigration[] = sqliteMigrations,
    now: () => string = () => new Date().toISOString()
  ) {
    this.database = database;
    this.migrations = migrations;
    this.now = now;
  }

  run(options: SqliteMigrationRunnerOptions = {}): SqliteMigrationRunResult {
    const enabled = options.enabled ?? true;
    this.ensureMigrationsTable();
    const pendingMigrationIds = this.getPendingMigrationIds();

    if (!enabled) {
      return {
        appliedMigrationIds: [],
        pendingMigrationIds,
        skipped: true
      };
    }

    const appliedMigrationIds: string[] = [];
    const insertMigration = this.database.prepare(
      `
        INSERT INTO schema_migrations (migration_id, applied_at)
        VALUES (?, ?)
      `
    );

    for (const migration of this.migrations) {
      if (!pendingMigrationIds.includes(migration.id)) {
        continue;
      }

      if (migration.run) {
        migration.run(this.database);
      } else if (migration.sql) {
        this.database.exec(migration.sql);
      } else {
        throw new Error(`SQLite migration ${migration.id} is missing an execution body`);
      }

      insertMigration.run(migration.id, this.now());
      appliedMigrationIds.push(migration.id);
    }

    return {
      appliedMigrationIds,
      pendingMigrationIds: this.getPendingMigrationIds(),
      skipped: false
    };
  }

  status(): SqliteMigrationStatusResult {
    this.ensureMigrationsTable();

    return {
      appliedMigrationIds: this.getAppliedMigrationIds(),
      pendingMigrationIds: this.getPendingMigrationIds()
    };
  }

  private ensureMigrationsTable(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private getAppliedMigrationIds(): string[] {
    const rows = this.database
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
      .all() as Array<{ migration_id: string }>;

    return rows.map((row) => row.migration_id);
  }

  private getPendingMigrationIds(): string[] {
    const applied = new Set(this.getAppliedMigrationIds());
    return this.migrations
      .filter((migration) => !applied.has(migration.id))
      .map((migration) => migration.id);
  }
}

export interface RunSqliteMigrationsOptions {
  databaseUrl: string;
  cwd?: string;
  enabled?: boolean;
}

export interface RunSqliteMigrationsResult extends SqliteMigrationRunResult {
  databasePath: string;
}

export interface GetSqliteMigrationStatusOptions {
  databaseUrl: string;
  cwd?: string;
}

export interface GetSqliteMigrationStatusResult extends SqliteMigrationStatusResult {
  databasePath: string;
}

export interface AssertSqliteMigrationsAppliedOptions {
  databaseUrl: string;
  cwd?: string;
}

export interface AssertSqliteMigrationsAppliedResult {
  appliedMigrationIds: string[];
  databasePath: string;
}

export const runSqliteMigrations = ({
  databaseUrl,
  cwd = process.cwd(),
  enabled = true
}: RunSqliteMigrationsOptions): RunSqliteMigrationsResult => {
  const { database, databasePath } = openSqliteDatabase({
    databaseUrl,
    cwd
  });

  try {
    const result = new SqliteMigrationRunner(database).run({ enabled });
    return {
      ...result,
      databasePath
    };
  } finally {
    database.close();
  }
};

export const getSqliteMigrationStatus = ({
  databaseUrl,
  cwd = process.cwd()
}: GetSqliteMigrationStatusOptions): GetSqliteMigrationStatusResult => {
  const { database, databasePath } = openSqliteDatabase({
    databaseUrl,
    cwd
  });

  try {
    const result = new SqliteMigrationRunner(database).status();
    return {
      ...result,
      databasePath
    };
  } finally {
    database.close();
  }
};

export const assertSqliteMigrationsApplied = ({
  databaseUrl,
  cwd = process.cwd()
}: AssertSqliteMigrationsAppliedOptions): AssertSqliteMigrationsAppliedResult => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(
      "Technical persistence requires an existing migrated SQLite database. Run npm run db:migrate before enabling TECHNICAL_PERSISTENCE_ENABLED."
    );
  }

  const { database } = openSqliteDatabase({
    databaseUrl,
    cwd
  });

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
        "Technical persistence requires existing migrations. Run npm run db:migrate before enabling TECHNICAL_PERSISTENCE_ENABLED."
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
        `Technical persistence requires completed migrations before startup. Pending migrations: ${pendingMigrationIds.join(", ")}. Run npm run db:migrate before enabling TECHNICAL_PERSISTENCE_ENABLED.`
      );
    }

    return {
      appliedMigrationIds,
      databasePath
    };
  } finally {
    database.close();
  }
};

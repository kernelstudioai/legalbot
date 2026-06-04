import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "./database.ts";
import type { SqliteMigration } from "./migrations.ts";
import { sqliteMigrations } from "./migrations.ts";

export interface SqliteMigrationRunnerOptions {
  enabled?: boolean;
}

export interface SqliteMigrationRunResult {
  appliedMigrationIds: string[];
  pendingMigrationIds: string[];
  skipped: boolean;
}

export class SqliteMigrationRunner {
  constructor(
    private readonly database: DatabaseSync,
    private readonly migrations: SqliteMigration[] = sqliteMigrations,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

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

      this.database.exec(migration.sql);
      insertMigration.run(migration.id, this.now());
      appliedMigrationIds.push(migration.id);
    }

    return {
      appliedMigrationIds,
      pendingMigrationIds: this.getPendingMigrationIds(),
      skipped: false
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

  private getPendingMigrationIds(): string[] {
    const rows = this.database
      .prepare("SELECT migration_id FROM schema_migrations ORDER BY migration_id ASC")
      .all() as Array<{ migration_id: string }>;
    const applied = new Set(rows.map((row) => row.migration_id));
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

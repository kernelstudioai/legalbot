import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpenSqliteDatabaseOptions {
  databaseUrl: string;
  cwd?: string;
}

export interface OpenSqliteDatabaseResult {
  database: DatabaseSync;
  databasePath: string;
}

const fileProtocolPrefix = "file:";

export const resolveSqliteDatabasePath = (
  databaseUrl: string,
  cwd: string = process.cwd()
): string => {
  if (!databaseUrl.startsWith(fileProtocolPrefix)) {
    throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
  }

  const filePath = databaseUrl.slice(fileProtocolPrefix.length);

  if (!filePath) {
    throw new Error("DATABASE_URL must include a file path");
  }

  if (filePath === ":memory:") {
    return filePath;
  }

  return path.resolve(cwd, filePath);
};

export const openSqliteDatabase = ({
  databaseUrl,
  cwd = process.cwd()
}: OpenSqliteDatabaseOptions): OpenSqliteDatabaseResult => {
  const databasePath = resolveSqliteDatabasePath(databaseUrl, cwd);

  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  return {
    database: new DatabaseSync(databasePath),
    databasePath
  };
};

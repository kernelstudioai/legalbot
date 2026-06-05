import type { DatabaseSync } from "node:sqlite";
import type { PersistenceTransactionRunner } from "../persistenceService.ts";

class SqliteTransactionRunner implements PersistenceTransactionRunner {
  private savepointCounter = 0;
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async runInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const savepointName = `legalbot_tx_${this.savepointCounter++}`;

    this.database.exec(`SAVEPOINT ${savepointName}`);

    try {
      const result = await operation();
      this.database.exec(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      this.database.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      this.database.exec(`RELEASE SAVEPOINT ${savepointName}`);
      throw error;
    }
  }
}

export const createSqliteTransactionRunner = (
  database: DatabaseSync
): PersistenceTransactionRunner => new SqliteTransactionRunner(database);

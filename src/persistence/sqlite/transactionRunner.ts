import type { DatabaseSync } from "node:sqlite";
import type { PersistenceTransactionRunner } from "../persistenceService.ts";

class SqliteTransactionRunner implements PersistenceTransactionRunner {
  private savepointCounter = 0;
  private transactionDepth = 0;
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async runInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const isOuterTransaction = this.transactionDepth === 0;
    const savepointName = isOuterTransaction
      ? null
      : `legalbot_tx_${this.savepointCounter++}`;

    this.transactionDepth += 1;

    if (isOuterTransaction) {
      this.database.exec("BEGIN IMMEDIATE");
    } else {
      this.database.exec(`SAVEPOINT ${savepointName}`);
    }

    try {
      const result = await operation();

      if (isOuterTransaction) {
        this.database.exec("COMMIT");
      } else {
        this.database.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }

      return result;
    } catch (error) {
      if (isOuterTransaction) {
        this.database.exec("ROLLBACK");
      } else {
        this.database.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        this.database.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }

      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }
}

export const createSqliteTransactionRunner = (
  database: DatabaseSync
): PersistenceTransactionRunner => new SqliteTransactionRunner(database);

import type { DatabaseSync } from "node:sqlite";
import type { CaseRecord, CaseStore, CreateCaseInput, UpdateCaseInput } from "../caseStore.ts";

const mapCaseRow = (row: {
  case_id: string;
  channel: "whatsapp";
  client_phone_e164: string;
  status: string;
  created_at: string;
  updated_at: string;
}): CaseRecord => ({
  caseId: row.case_id,
  channel: row.channel,
  clientPhoneE164: row.client_phone_e164,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class SqliteCaseStore implements CaseStore {
  constructor(private readonly database: DatabaseSync) {}

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const record: CaseRecord = {
      caseId: input.caseId,
      channel: input.channel ?? "whatsapp",
      clientPhoneE164: input.clientPhoneE164,
      status: input.status ?? "pending",
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO cases (
            case_id,
            channel,
            client_phone_e164,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.caseId,
        record.channel,
        record.clientPhoneE164,
        record.status,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  async getById(caseId: string): Promise<CaseRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT
            case_id,
            channel,
            client_phone_e164,
            status,
            created_at,
            updated_at
          FROM cases
          WHERE case_id = ?
        `
      )
      .get(caseId) as
      | {
          case_id: string;
          channel: "whatsapp";
          client_phone_e164: string;
          status: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    return row ? mapCaseRow(row) : null;
  }

  async update(input: UpdateCaseInput): Promise<CaseRecord | null> {
    const existing = await this.getById(input.caseId);

    if (!existing) {
      return null;
    }

    const updated: CaseRecord = {
      ...existing,
      status: input.status ?? existing.status,
      updatedAt: input.updatedAt
    };

    this.database
      .prepare(
        `
          UPDATE cases
          SET status = ?, updated_at = ?
          WHERE case_id = ?
        `
      )
      .run(updated.status, updated.updatedAt, updated.caseId);

    return updated;
  }
}

import type { DatabaseSync } from "node:sqlite";
import type { CaseRecord, CaseStore, CreateCaseInput, UpdateCaseInput } from "../caseStore.ts";

const mapCaseRow = (row: {
  case_id: string;
  subject_id: string;
  status: string;
  name: string;
  problem_summary: string;
  created_at: string;
  updated_at: string;
}): CaseRecord => ({
  caseId: row.case_id,
  subjectId: row.subject_id,
  status: row.status,
  name: row.name,
  problemSummary: row.problem_summary,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class SqliteCaseStore implements CaseStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const record: CaseRecord = {
      caseId: input.caseId,
      subjectId: input.subjectId,
      status: input.status ?? "draft",
      name: input.name,
      problemSummary: input.problemSummary,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO cases (
            case_id,
            subject_id,
            status,
            name,
            problem_summary,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.caseId,
        record.subjectId,
        record.status,
        record.name,
        record.problemSummary,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  async findDraftBySubjectId(subjectId: string): Promise<CaseRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT
            case_id,
            subject_id,
            status,
            name,
            problem_summary,
            created_at,
            updated_at
          FROM cases
          WHERE subject_id = ? AND status = 'draft'
          ORDER BY created_at ASC, case_id ASC
          LIMIT 1
        `
      )
      .get(subjectId) as
      | {
          case_id: string;
          subject_id: string;
          status: string;
          name: string;
          problem_summary: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    return row ? mapCaseRow(row) : null;
  }

  async getById(caseId: string): Promise<CaseRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT
            case_id,
            subject_id,
            status,
            name,
            problem_summary,
            created_at,
            updated_at
          FROM cases
          WHERE case_id = ?
        `
      )
      .get(caseId) as
      | {
          case_id: string;
          subject_id: string;
          status: string;
          name: string;
          problem_summary: string;
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

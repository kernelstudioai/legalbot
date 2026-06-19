import type { DatabaseSync } from "node:sqlite";
import { getNextPracticeCode, PracticeCodeOverflowError } from "../../domain/practices/practiceCode.ts";
import type {
  CreatePracticeInput,
  PracticeAttachmentMetadata,
  PracticeListFilter,
  PracticeRecord,
  PracticeStore
} from "../practiceStore.ts";

const mapPracticeRow = (row: {
  practice_code: string;
  subject_id: string;
  status: string;
  client_first_name: string;
  client_last_name: string;
  birth_date: string;
  city: string;
  subject_ref: string;
  legal_issue_text: string;
  cleaned_issue_text: string | null;
  attachment_metadata_json: string;
  source_message_id: string;
  created_at: string;
  updated_at: string;
}): PracticeRecord => ({
  practiceCode: row.practice_code,
  subjectId: row.subject_id,
  status: row.status,
  clientFirstName: row.client_first_name,
  clientLastName: row.client_last_name,
  birthDate: row.birth_date,
  city: row.city,
  subjectRef: row.subject_ref,
  legalIssueText: row.legal_issue_text,
  ...(row.cleaned_issue_text ? { cleanedIssueText: row.cleaned_issue_text } : {}),
  attachmentMetadata: JSON.parse(row.attachment_metadata_json) as PracticeAttachmentMetadata[],
  sourceMessageId: row.source_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class SqlitePracticeStore implements PracticeStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  async allocateNextPracticeCode(): Promise<string> {
    let lastCode = (
      this.database.prepare("SELECT last_code FROM practice_sequence WHERE id = 1").get() as
        | { last_code: string | null }
        | undefined
    )?.last_code;

    for (let attempts = 0; attempts < 26 * 26 * 999; attempts += 1) {
      const nextCode = getNextPracticeCode(lastCode);

      this.database
        .prepare(
          `
            INSERT INTO practice_sequence (id, last_code)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET last_code = excluded.last_code
          `
        )
        .run(nextCode);

      if (!(await this.findByPracticeCode(nextCode))) {
        return nextCode;
      }

      lastCode = nextCode;
    }

    throw new PracticeCodeOverflowError();
  }

  async create(input: CreatePracticeInput): Promise<PracticeRecord> {
    const record: PracticeRecord = {
      practiceCode: input.practiceCode,
      subjectId: input.subjectId,
      status: input.status ?? "draft",
      clientFirstName: input.clientFirstName,
      clientLastName: input.clientLastName,
      birthDate: input.birthDate,
      city: input.city,
      subjectRef: input.subjectRef,
      legalIssueText: input.legalIssueText,
      ...(input.cleanedIssueText ? { cleanedIssueText: input.cleanedIssueText } : {}),
      attachmentMetadata: input.attachmentMetadata ?? [],
      sourceMessageId: input.sourceMessageId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString()
    };

    this.database
      .prepare(
        `
          INSERT INTO practices (
            practice_code,
            subject_id,
            status,
            client_first_name,
            client_last_name,
            birth_date,
            city,
            subject_ref,
            legal_issue_text,
            cleaned_issue_text,
            attachment_metadata_json,
            source_message_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.practiceCode,
        record.subjectId,
        record.status,
        record.clientFirstName,
        record.clientLastName,
        record.birthDate,
        record.city,
        record.subjectRef,
        record.legalIssueText,
        record.cleanedIssueText ?? null,
        JSON.stringify(record.attachmentMetadata),
        record.sourceMessageId,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  async findByPracticeCode(practiceCode: string): Promise<PracticeRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM practices
          WHERE practice_code = ?
        `
      )
      .get(practiceCode) as Parameters<typeof mapPracticeRow>[0] | undefined;

    return row ? mapPracticeRow(row) : null;
  }

  async findBySourceMessageId(sourceMessageId: string): Promise<PracticeRecord | null> {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM practices
          WHERE source_message_id = ?
        `
      )
      .get(sourceMessageId) as Parameters<typeof mapPracticeRow>[0] | undefined;

    return row ? mapPracticeRow(row) : null;
  }

  async list(filter: PracticeListFilter = {}): Promise<PracticeRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM practices
          WHERE (? IS NULL OR created_at >= ?)
            AND (? IS NULL OR created_at < ?)
          ORDER BY created_at DESC, practice_code DESC
        `
      )
      .all(
        filter.createdAtOrAfter ?? null,
        filter.createdAtOrAfter ?? null,
        filter.createdAtBefore ?? null,
        filter.createdAtBefore ?? null
      ) as Parameters<typeof mapPracticeRow>[0][];

    return rows.map(mapPracticeRow);
  }
}

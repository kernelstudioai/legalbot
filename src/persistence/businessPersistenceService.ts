import { DatabaseSync } from "node:sqlite";
import type {
  ClientConsentPersistence,
  ClientIntakePersistence
} from "../runtime/client/clientRuntime.ts";
import type { CaseCreationPersistence } from "../domain/cases/caseCreationService.ts";
import type {
  PersistenceService,
  SqlitePersistenceService
} from "./persistenceService.ts";
import { createSqlitePersistenceService } from "./persistenceService.ts";
import { intakeFieldNames, type IntakeFieldName } from "./intakeStore.ts";
import { toOperatorSubjectId } from "./operatorSubjectId.ts";

export interface BusinessPersistenceService
  extends ClientConsentPersistence,
    ClientIntakePersistence,
    CaseCreationPersistence {
  close?(): void;
}

export interface BusinessReadyIntakeCandidate {
  subjectId: string;
  intakeState: "intake_complete";
  updatedAt: string;
  fieldNamesPresent: IntakeFieldName[];
}

export interface SqliteBusinessPersistenceService extends BusinessPersistenceService {
  readonly databasePath: string;
  listReadyIntakeCandidates(): Promise<BusinessReadyIntakeCandidate[]>;
  resolveReadyIntakeSubjectId(operatorSubjectId: string): Promise<string | null>;
}

const createBusinessBoundary = (
  persistence: PersistenceService
): BusinessPersistenceService => ({
  runInTransaction(operation) {
    return persistence.runInTransaction(operation);
  },
  getConsentState(subjectId) {
    return persistence.getConsentState(subjectId);
  },
  setConsentState(subjectId, state, metadata) {
    return persistence.setConsentState(subjectId, state, metadata);
  },
  appendConsentEvent(event) {
    return persistence.appendConsentEvent(event);
  },
  getIntakeState(subjectId) {
    return persistence.getIntakeState(subjectId);
  },
  getIntakeSnapshot(subjectId) {
    return persistence.getIntakeSnapshot(subjectId);
  },
  setIntakeState(subjectId, state, metadata) {
    return persistence.setIntakeState(subjectId, state, metadata);
  },
  setIntakeField(subjectId, fieldName, value, metadata) {
    return persistence.setIntakeField(subjectId, fieldName, value, metadata);
  },
  appendIntakeEvent(event) {
    return persistence.appendIntakeEvent(event);
  },
  appendAuditEvent(event) {
    return persistence.appendAuditEvent(event);
  },
  createCaseWithAudit(input) {
    return persistence.createCaseWithAudit(input);
  },
  findDraftCaseBySubjectId(subjectId) {
    return persistence.findDraftCaseBySubjectId(subjectId);
  },
  ...(typeof (persistence as { close?: unknown }).close === "function"
    ? {
        close() {
          (persistence as SqlitePersistenceService).close();
        }
      }
    : {})
});

const listReadyIntakeCandidatesFromDatabase = (
  databasePath: string
): BusinessReadyIntakeCandidate[] => {
  const database = new DatabaseSync(databasePath);

  try {
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
          AND intake_fields.field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')
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
        subjectId,
        intakeState: "intake_complete",
        updatedAt: candidate.updatedAt,
        fieldNamesPresent: intakeFieldNames.filter((fieldName) =>
          candidate.fieldNamesPresent.has(fieldName)
        )
      }));
  } finally {
    database.close();
  }
};

const createSqliteBusinessBoundary = (
  persistence: SqlitePersistenceService
): SqliteBusinessPersistenceService => ({
  ...createBusinessBoundary(persistence),
  databasePath: persistence.databasePath,
  async listReadyIntakeCandidates() {
    return listReadyIntakeCandidatesFromDatabase(persistence.databasePath);
  },
  async resolveReadyIntakeSubjectId(operatorSubjectId) {
    const candidates = listReadyIntakeCandidatesFromDatabase(persistence.databasePath);
    const match = candidates.find(
      (candidate) => toOperatorSubjectId(candidate.subjectId) === operatorSubjectId
    );

    return match?.subjectId ?? null;
  }
});

export const createBusinessPersistenceService = (
  persistence: PersistenceService
): BusinessPersistenceService => createBusinessBoundary(persistence);

export const createSqliteBusinessPersistenceService = ({
  databaseUrl,
  cwd
}: {
  databaseUrl: string;
  cwd?: string;
}): SqliteBusinessPersistenceService =>
  createSqliteBusinessBoundary(
    createSqlitePersistenceService({
      databaseUrl,
      ...(cwd ? { cwd } : {})
    })
  );

export const createSqliteBusinessPersistenceServiceFromPersistence = (
  persistence: SqlitePersistenceService
): SqliteBusinessPersistenceService => createSqliteBusinessBoundary(persistence);

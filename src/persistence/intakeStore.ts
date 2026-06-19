export const intakeStates = [
  "not_started",
  "asking_identity",
  "asking_problem_summary",
  "asking_attachments",
  "intake_complete"
] as const;

export type IntakeState = (typeof intakeStates)[number];

export const intakeFieldNames = [
  "firstName",
  "lastName",
  "birthDate",
  "city",
  "problemSummary",
  "attachmentMetadata"
] as const;

export type IntakeFieldName = (typeof intakeFieldNames)[number];

export interface IntakeStateRecord {
  subjectId: string;
  state: IntakeState;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface IntakeFieldRecord {
  subjectId: string;
  fieldName: IntakeFieldName;
  value: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface IntakeSnapshot {
  subjectId: string;
  state: IntakeState;
  updatedAt: string;
  fields: Partial<Record<IntakeFieldName, string>>;
}

export interface SetIntakeStateOptions {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SetIntakeFieldOptions {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IntakeEventRecord {
  eventId: string;
  subjectId: string;
  eventType: string;
  state?: IntakeState;
  fieldName?: IntakeFieldName;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface AppendIntakeEventInput {
  eventId: string;
  subjectId: string;
  eventType: string;
  state?: IntakeState;
  fieldName?: IntakeFieldName;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IntakeStore {
  getIntakeState(subjectId: string): Promise<IntakeState>;
  setIntakeState(
    subjectId: string,
    state: IntakeState,
    options?: SetIntakeStateOptions
  ): Promise<IntakeStateRecord>;
  setIntakeField(
    subjectId: string,
    fieldName: IntakeFieldName,
    value: string,
    options?: SetIntakeFieldOptions
  ): Promise<IntakeFieldRecord>;
  getIntakeSnapshot(subjectId: string): Promise<IntakeSnapshot | null>;
  appendIntakeEvent(event: IntakeEventRecord): Promise<void>;
}

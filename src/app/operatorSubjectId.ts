import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const OPERATOR_SUBJECT_ID_PREFIX = "sid_";
const OPERATOR_SUBJECT_ID_LENGTH = 12;
const OPERATOR_SUBJECT_ID_PATTERN = /^sid_[a-f0-9]{12}$/;

const buildOperatorSubjectId = (subjectId: string): string =>
  `${OPERATOR_SUBJECT_ID_PREFIX}${createHash("sha256").update(subjectId).digest("hex").slice(0, OPERATOR_SUBJECT_ID_LENGTH)}`;

export const toOperatorSubjectId = (subjectId: string): string => buildOperatorSubjectId(subjectId);

export const isOperatorSubjectId = (value: string): boolean =>
  OPERATOR_SUBJECT_ID_PATTERN.test(value.trim());

export const resolveOperatorSubjectId = (
  database: DatabaseSync,
  operatorSubjectId: string
): string | null => {
  const rows = database.prepare(
    `
      SELECT DISTINCT intake_states.subject_id
      FROM intake_states
      INNER JOIN consent_states
        ON consent_states.subject_id = intake_states.subject_id
      INNER JOIN intake_fields AS first_name_field
        ON first_name_field.subject_id = intake_states.subject_id
       AND first_name_field.field_name = 'firstName'
      INNER JOIN intake_fields AS last_name_field
        ON last_name_field.subject_id = intake_states.subject_id
       AND last_name_field.field_name = 'lastName'
      INNER JOIN intake_fields AS birth_date_field
        ON birth_date_field.subject_id = intake_states.subject_id
       AND birth_date_field.field_name = 'birthDate'
      INNER JOIN intake_fields AS city_field
        ON city_field.subject_id = intake_states.subject_id
       AND city_field.field_name = 'city'
      INNER JOIN intake_fields AS problem_summary_field
        ON problem_summary_field.subject_id = intake_states.subject_id
       AND problem_summary_field.field_name = 'problemSummary'
      WHERE intake_states.intake_state = 'intake_complete'
        AND consent_states.consent_state = 'granted'
      ORDER BY intake_states.subject_id ASC
    `
  ).all() as Array<{ subject_id: string }>;

  const match = rows.find(
    (row) => buildOperatorSubjectId(row.subject_id) === operatorSubjectId
  );

  return match?.subject_id ?? null;
};

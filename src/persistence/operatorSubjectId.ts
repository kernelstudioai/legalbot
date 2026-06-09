import { createHash } from "node:crypto";

const OPERATOR_SUBJECT_ID_PREFIX = "sid_";
const OPERATOR_SUBJECT_ID_LENGTH = 12;
const OPERATOR_SUBJECT_ID_PATTERN = /^sid_[a-f0-9]{12}$/;

const buildOperatorSubjectId = (subjectId: string): string =>
  `${OPERATOR_SUBJECT_ID_PREFIX}${createHash("sha256").update(subjectId).digest("hex").slice(0, OPERATOR_SUBJECT_ID_LENGTH)}`;

export const toOperatorSubjectId = (subjectId: string): string => buildOperatorSubjectId(subjectId);

export const isOperatorSubjectId = (value: string): boolean =>
  OPERATOR_SUBJECT_ID_PATTERN.test(value.trim());

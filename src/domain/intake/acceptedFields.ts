export const CLIENT_NAME_MAX_LENGTH = 80;
export const CLIENT_PROBLEM_SUMMARY_MAX_LENGTH = 500;

export interface AcceptedStructuredFieldSuccess {
  valid: true;
  value: string;
}

export interface AcceptedStructuredFieldFailure {
  valid: false;
}

export type AcceptedStructuredFieldResult =
  | AcceptedStructuredFieldSuccess
  | AcceptedStructuredFieldFailure;

export const normalizeAcceptedStructuredValue = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const validateAcceptedStructuredField = (
  value: string | undefined,
  maxLength: number
): AcceptedStructuredFieldResult => {
  const normalizedValue = normalizeAcceptedStructuredValue(value ?? "");

  if (normalizedValue.length === 0 || normalizedValue.length > maxLength) {
    return { valid: false };
  }

  return {
    valid: true,
    value: normalizedValue
  };
};

export const validateAcceptedClientName = (
  value: string | undefined
): AcceptedStructuredFieldResult =>
  validateAcceptedStructuredField(value, CLIENT_NAME_MAX_LENGTH);

export const validateAcceptedProblemSummary = (
  value: string | undefined
): AcceptedStructuredFieldResult =>
  validateAcceptedStructuredField(value, CLIENT_PROBLEM_SUMMARY_MAX_LENGTH);

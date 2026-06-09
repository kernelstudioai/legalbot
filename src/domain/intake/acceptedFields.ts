export const CLIENT_PERSON_FIELD_MAX_LENGTH = 80;
export const CLIENT_CITY_MAX_LENGTH = 120;
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

const PERSON_TEXT_PATTERN = /^[\p{L}' -]+$/u;
const CITY_TEXT_PATTERN = /^[\p{L}' -]+$/u;
const MULTI_SPACE_PATTERN = /\s+/g;
const TITLE_CASE_SPLIT_PATTERN = /([ '-])/;

export const normalizeAcceptedStructuredValue = (value: string): string =>
  value.trim().replace(MULTI_SPACE_PATTERN, " ");

const toTitleCaseToken = (value: string): string => {
  if (value.length === 0) {
    return value;
  }

  return value.charAt(0).toLocaleUpperCase("it-IT") + value.slice(1).toLocaleLowerCase("it-IT");
};

const normalizeSimpleTitleCase = (value: string): string =>
  value
    .split(TITLE_CASE_SPLIT_PATTERN)
    .map((part) =>
      TITLE_CASE_SPLIT_PATTERN.test(part) ? part : toTitleCaseToken(part)
    )
    .join("");

const normalizePersonLikeValue = (value: string): string => {
  const normalized = normalizeAcceptedStructuredValue(value);

  if (!PERSON_TEXT_PATTERN.test(normalized)) {
    return normalized;
  }

  const lettersOnly = normalized.replace(/[' -]/g, "");
  const isSafeToRecase =
    lettersOnly === lettersOnly.toLocaleLowerCase("it-IT") ||
    lettersOnly === lettersOnly.toLocaleUpperCase("it-IT");

  return isSafeToRecase ? normalizeSimpleTitleCase(normalized) : normalized;
};

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

const parseDateParts = (
  value: string
): {
  day: number;
  month: number;
  year: number;
} | null => {
  const normalized = normalizeAcceptedStructuredValue(value);
  const match = normalized.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);

  if (!match) {
    return null;
  }

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }

  if (year < 1900 || year > 2100) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return isValidDate ? { day, month, year } : null;
};

export const normalizeAcceptedBirthDate = (value: string): string | null => {
  const parsed = parseDateParts(value);

  if (!parsed) {
    return null;
  }

  return `${String(parsed.day).padStart(2, "0")}/${String(parsed.month).padStart(2, "0")}/${String(parsed.year).padStart(4, "0")}`;
};

export const validateAcceptedFirstName = (
  value: string | undefined
): AcceptedStructuredFieldResult => {
  const normalized = normalizePersonLikeValue(value ?? "");

  if (
    normalized.length === 0 ||
    normalized.length > CLIENT_PERSON_FIELD_MAX_LENGTH ||
    !PERSON_TEXT_PATTERN.test(normalized)
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    value: normalized
  };
};

export const validateAcceptedLastName = (
  value: string | undefined
): AcceptedStructuredFieldResult => {
  const normalized = normalizePersonLikeValue(value ?? "");

  if (
    normalized.length === 0 ||
    normalized.length > CLIENT_PERSON_FIELD_MAX_LENGTH ||
    !PERSON_TEXT_PATTERN.test(normalized)
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    value: normalized
  };
};

export const validateAcceptedCity = (
  value: string | undefined
): AcceptedStructuredFieldResult => {
  const normalized = normalizePersonLikeValue(value ?? "");

  if (
    normalized.length === 0 ||
    normalized.length > CLIENT_CITY_MAX_LENGTH ||
    !CITY_TEXT_PATTERN.test(normalized)
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    value: normalized
  };
};

export const validateAcceptedBirthDate = (
  value: string | undefined
): AcceptedStructuredFieldResult => {
  if (!value) {
    return { valid: false };
  }

  const normalized = normalizeAcceptedBirthDate(value);

  return normalized
    ? {
        valid: true,
        value: normalized
      }
    : { valid: false };
};

export const validateAcceptedProblemSummary = (
  value: string | undefined
): AcceptedStructuredFieldResult =>
  validateAcceptedStructuredField(value, CLIENT_PROBLEM_SUMMARY_MAX_LENGTH);

export const buildAcceptedDisplayName = (fields: {
  firstName: string;
  lastName: string;
}): string => `${fields.firstName} ${fields.lastName}`.trim();

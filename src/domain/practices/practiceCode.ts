const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODES_PER_PREFIX = 999;
const MAX_PREFIX_INDEX = LETTERS.length * LETTERS.length - 1;

export const FIRST_PRACTICE_CODE = "AA001";
export const LAST_PRACTICE_CODE = "ZZ999";

const practiceCodePattern = /^[A-Z]{2}\d{3}$/;

export class PracticeCodeOverflowError extends Error {
  readonly code = "practice_code_space_exhausted";

  constructor(message: string = "Practice code space exhausted after ZZ999.") {
    super(message);
    this.name = "PracticeCodeOverflowError";
  }
}

export const isPracticeCode = (value: string): boolean => practiceCodePattern.test(value);

const codeToIndex = (code: string): number => {
  if (!isPracticeCode(code)) {
    throw new Error(`Invalid practice code: ${code}`);
  }

  const firstLetterIndex = LETTERS.indexOf(code[0]!);
  const secondLetterIndex = LETTERS.indexOf(code[1]!);
  const numericPart = Number(code.slice(2));

  if (
    firstLetterIndex < 0 ||
    secondLetterIndex < 0 ||
    !Number.isInteger(numericPart) ||
    numericPart < 1 ||
    numericPart > CODES_PER_PREFIX
  ) {
    throw new Error(`Invalid practice code: ${code}`);
  }

  return (firstLetterIndex * LETTERS.length + secondLetterIndex) * CODES_PER_PREFIX + numericPart - 1;
};

const indexToCode = (index: number): string => {
  if (!Number.isInteger(index) || index < 0 || index > MAX_PREFIX_INDEX * CODES_PER_PREFIX + CODES_PER_PREFIX - 1) {
    throw new PracticeCodeOverflowError();
  }

  const prefixIndex = Math.floor(index / CODES_PER_PREFIX);
  const numericPart = (index % CODES_PER_PREFIX) + 1;
  const firstLetter = LETTERS[Math.floor(prefixIndex / LETTERS.length)]!;
  const secondLetter = LETTERS[prefixIndex % LETTERS.length]!;

  return `${firstLetter}${secondLetter}${String(numericPart).padStart(3, "0")}`;
};

export const getNextPracticeCode = (currentCode: string | null | undefined): string => {
  if (!currentCode) {
    return FIRST_PRACTICE_CODE;
  }

  if (currentCode === LAST_PRACTICE_CODE) {
    throw new PracticeCodeOverflowError();
  }

  return indexToCode(codeToIndex(currentCode) + 1);
};

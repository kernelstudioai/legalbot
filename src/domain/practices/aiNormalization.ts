import { z } from "zod";
import {
  validateAcceptedBirthDate,
  validateAcceptedCity,
  validateAcceptedFirstName,
  validateAcceptedLastName,
  validateAcceptedProblemSummary
} from "../intake/acceptedFields.ts";
import type {
  AcceptedIdentityFields,
  IdentityExtractionInput,
  IdentityExtractionResult
} from "../intake/extraction.ts";

export interface AiIdentityNormalizationInput extends IdentityExtractionInput {
  missingFields: readonly (keyof AcceptedIdentityFields)[];
}

export interface AiIssueSummaryInput {
  legalIssueText: string;
}

export interface AiIssueSummaryResult {
  cleanedIssueText?: string;
}

export interface AiNormalizationProvider {
  normalizeIdentity(input: AiIdentityNormalizationInput): IdentityExtractionResult | null;
  summarizeLegalIssue(input: AiIssueSummaryInput): AiIssueSummaryResult | null;
}

const AiIdentityNormalizationSchema = z.object({
  acceptedFields: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      birthDate: z.string().optional(),
      city: z.string().optional()
    })
    .default({}),
  missingFields: z.array(z.enum(["firstName", "lastName", "birthDate", "city"]))
});

const AiIssueSummarySchema = z.object({
  cleanedIssueText: z.string().optional()
});

const validateAiIdentityField = (
  fieldName: keyof AcceptedIdentityFields,
  value: string | undefined
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const result =
    fieldName === "firstName"
      ? validateAcceptedFirstName(value)
      : fieldName === "lastName"
        ? validateAcceptedLastName(value)
        : fieldName === "birthDate"
          ? validateAcceptedBirthDate(value)
          : validateAcceptedCity(value);

  return result.valid ? result.value : undefined;
};

export const validateAiIdentityNormalization = (
  output: unknown
): IdentityExtractionResult | null => {
  const parsed = AiIdentityNormalizationSchema.safeParse(output);

  if (!parsed.success) {
    return null;
  }

  const acceptedFields: Partial<AcceptedIdentityFields> = {};

  for (const fieldName of ["firstName", "lastName", "birthDate", "city"] as const) {
    const value = validateAiIdentityField(fieldName, parsed.data.acceptedFields[fieldName]);

    if (value) {
      acceptedFields[fieldName] = value;
    }
  }

  const missingFields = (["firstName", "lastName", "birthDate", "city"] as const).filter(
    (fieldName) => !acceptedFields[fieldName]
  );

  return {
    acceptedFields,
    missingFields
  };
};

export const validateAiIssueSummary = (output: unknown): AiIssueSummaryResult | null => {
  const parsed = AiIssueSummarySchema.safeParse(output);

  if (!parsed.success) {
    return null;
  }

  if (parsed.data.cleanedIssueText === undefined) {
    return {};
  }

  const summary = validateAcceptedProblemSummary(parsed.data.cleanedIssueText);

  return summary.valid
    ? {
        cleanedIssueText: summary.value
      }
    : null;
};

export const createDisabledAiNormalizationProvider = (): AiNormalizationProvider => ({
  normalizeIdentity() {
    return null;
  },
  summarizeLegalIssue() {
    return null;
  }
});

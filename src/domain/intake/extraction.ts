import {
  normalizeAcceptedBirthDate,
  normalizeAcceptedStructuredValue,
  validateAcceptedBirthDate,
  validateAcceptedCity,
  validateAcceptedFirstName,
  validateAcceptedLastName
} from "./acceptedFields.ts";

export const identityFieldNames = ["firstName", "lastName", "birthDate", "city"] as const;

export type IdentityFieldName = (typeof identityFieldNames)[number];

export interface AcceptedIdentityFields {
  firstName: string;
  lastName: string;
  birthDate: string;
  city: string;
}

export interface IdentityExtractionInput {
  text: string;
  existingFields?: Partial<AcceptedIdentityFields>;
}

export interface IdentityExtractionResult {
  acceptedFields: Partial<AcceptedIdentityFields>;
  missingFields: IdentityFieldName[];
}

export interface IdentityExtractionProvider {
  extractIdentity(input: IdentityExtractionInput): IdentityExtractionResult;
}

const WORD_PATTERN = /\p{L}+(?:['-]\p{L}+)*/gu;
const DATE_PATTERN = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/u;
const LEADING_LABEL_PATTERN =
  /^(?:mi chiamo|sono|io sono|nome|cognome|data di nascita|nato il|nata il|nato a|nata a|vivo a|abito a|residente a|residente in|citta|città)\b[\s,:-]*/iu;

const splitCommaSegments = (text: string): string[] =>
  text
    .split(",")
    .map((segment) => normalizeAcceptedStructuredValue(segment))
    .filter((segment) => segment.length > 0);

const stripLeadingLabels = (value: string): string => {
  let result = normalizeAcceptedStructuredValue(value);

  while (LEADING_LABEL_PATTERN.test(result)) {
    result = normalizeAcceptedStructuredValue(result.replace(LEADING_LABEL_PATTERN, ""));
  }

  return result;
};

const extractBirthDate = (text: string): string | undefined => {
  const match = text.match(DATE_PATTERN);

  if (!match) {
    return undefined;
  }

  return normalizeAcceptedBirthDate(match[0]) ?? undefined;
};

const removeBirthDate = (text: string): string =>
  normalizeAcceptedStructuredValue(text.replace(DATE_PATTERN, " "));

const tryExtractCityFromContext = (text: string): string | undefined => {
  const contextPatterns = [
    /\b(?:vivo|abito|risiedo|resiedo|residente|domiciliato|domiciliata)\s+a\s+([\p{L}' -]+)$/iu,
    /\b(?:nato|nata)\s+il\s+\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\s+a\s+([\p{L}' -]+)$/iu,
    /\ba\s+([\p{L}' -]+)$/iu
  ];

  for (const pattern of contextPatterns) {
    const match = text.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const parsed = validateAcceptedCity(stripLeadingLabels(match[1]));

    if (parsed.valid) {
      return parsed.value;
    }
  }

  return undefined;
};

const parseNameTokens = (
  tokens: string[],
  hints: {
    explicitFirstLastOrder: boolean;
    preferSurnameFirst: boolean;
  }
): Pick<AcceptedIdentityFields, "firstName" | "lastName"> | null => {
  if (tokens.length < 2) {
    return null;
  }

  const [rawFirstToken, rawSecondToken] = tokens;
  const firstToken = validateAcceptedFirstName(rawFirstToken);
  const secondToken = validateAcceptedLastName(tokens.slice(1).join(" "));

  if (hints.explicitFirstLastOrder && firstToken.valid && secondToken.valid) {
    return {
      firstName: firstToken.value,
      lastName: secondToken.value
    };
  }

  if (hints.preferSurnameFirst) {
    const parsedFirstName = validateAcceptedFirstName(tokens[1]);
    const parsedLastName = validateAcceptedLastName(tokens[0]);

    if (parsedFirstName.valid && parsedLastName.valid) {
      return {
        firstName: parsedFirstName.value,
        lastName: parsedLastName.value
      };
    }
  }

  if (firstToken.valid && secondToken.valid) {
    return {
      firstName: firstToken.value,
      lastName: secondToken.value
    };
  }

  return null;
};

const extractIdentityFromCommaSegments = (
  segments: string[],
  birthDate?: string
): Partial<AcceptedIdentityFields> => {
  if (segments.length < 3) {
    return {};
  }

  const result: Partial<AcceptedIdentityFields> = {};
  const nonDateSegments = segments.filter((segment) => normalizeAcceptedBirthDate(segment) === null);
  const cityCandidate = nonDateSegments[nonDateSegments.length - 1];
  const parsedCity = validateAcceptedCity(cityCandidate);

  if (parsedCity.valid) {
    result.city = parsedCity.value;
  }

  const nameSegments = nonDateSegments.slice(0, Math.max(nonDateSegments.length - 1, 0));
  const nameTokens = nameSegments.flatMap((segment) => segment.match(WORD_PATTERN) ?? []);
  const parsedName = parseNameTokens(nameTokens, {
    explicitFirstLastOrder: true,
    preferSurnameFirst: false
  });

  if (parsedName) {
    result.firstName = parsedName.firstName;
    result.lastName = parsedName.lastName;
  }

  if (birthDate) {
    result.birthDate = birthDate;
  }

  return result;
};

const buildTokenRemainder = (text: string, city?: string): string[] => {
  let remainder = text;

  if (city) {
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remainder = remainder.replace(new RegExp(`\\b${escapedCity}\\b`, "iu"), " ");
  }

  remainder = remainder
    .replace(
      /\b(?:mi chiamo|sono|io sono|nato|nata|il|a|vivo|abito|residente|in|citta|città|e)\b/giu,
      " "
    )
    .replace(/[,;:]/g, " ");

  return (remainder.match(WORD_PATTERN) ?? []).map((token) => normalizeAcceptedStructuredValue(token));
};

export class DeterministicIdentityExtractionProvider implements IdentityExtractionProvider {
  extractIdentity({
    text,
    existingFields = {}
  }: IdentityExtractionInput): IdentityExtractionResult {
    const normalizedText = normalizeAcceptedStructuredValue(text);
    const birthDate = extractBirthDate(normalizedText);
    const textWithoutDate = removeBirthDate(normalizedText);
    const commaSegments = splitCommaSegments(textWithoutDate);
    const acceptedFields: Partial<AcceptedIdentityFields> = { ...existingFields };

    const explicitFirstLastOrder = /\bmi chiamo\b/iu.test(normalizedText);
    const preferSurnameFirst =
      !explicitFirstLastOrder &&
      /\b(?:nato|nata)\s+il\b/iu.test(normalizedText) &&
      commaSegments.length === 0;

    Object.assign(acceptedFields, extractIdentityFromCommaSegments(commaSegments, birthDate));

    if (!acceptedFields.city) {
      const cityFromContext = tryExtractCityFromContext(textWithoutDate);

      if (cityFromContext) {
        acceptedFields.city = cityFromContext;
      }
    }

    const tokens = buildTokenRemainder(textWithoutDate, acceptedFields.city);

    if ((!acceptedFields.firstName || !acceptedFields.lastName) && tokens.length >= 2) {
      const parsedName = parseNameTokens(tokens, {
        explicitFirstLastOrder,
        preferSurnameFirst
      });

      if (parsedName) {
        acceptedFields.firstName = acceptedFields.firstName ?? parsedName.firstName;
        acceptedFields.lastName = acceptedFields.lastName ?? parsedName.lastName;
      }
    }

    if (!acceptedFields.city && tokens.length >= 3) {
      const cityCandidate = tokens.slice(2).join(" ");
      const parsedCity = validateAcceptedCity(cityCandidate);

      if (parsedCity.valid) {
        acceptedFields.city = parsedCity.value;
      }
    }

    if (birthDate) {
      acceptedFields.birthDate = birthDate;
    }

    if (acceptedFields.firstName) {
      const parsed = validateAcceptedFirstName(acceptedFields.firstName);
      if (parsed.valid) {
        acceptedFields.firstName = parsed.value;
      } else {
        delete acceptedFields.firstName;
      }
    }

    if (acceptedFields.lastName) {
      const parsed = validateAcceptedLastName(acceptedFields.lastName);
      if (parsed.valid) {
        acceptedFields.lastName = parsed.value;
      } else {
        delete acceptedFields.lastName;
      }
    }

    if (acceptedFields.city) {
      const parsed = validateAcceptedCity(acceptedFields.city);
      if (parsed.valid) {
        acceptedFields.city = parsed.value;
      } else {
        delete acceptedFields.city;
      }
    }

    if (acceptedFields.birthDate) {
      const parsed = validateAcceptedBirthDate(acceptedFields.birthDate);
      if (parsed.valid) {
        acceptedFields.birthDate = parsed.value;
      } else {
        delete acceptedFields.birthDate;
      }
    }

    return {
      acceptedFields,
      missingFields: identityFieldNames.filter((fieldName) => !acceptedFields[fieldName])
    };
  }
}

export const createDeterministicIdentityExtractionProvider = (): IdentityExtractionProvider =>
  new DeterministicIdentityExtractionProvider();

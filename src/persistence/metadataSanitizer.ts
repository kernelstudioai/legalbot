const REDACTED_PHONE = "[redacted-phone]";
const REDACTED_PATH = "[redacted-path]";
const REDACTED_QR = "[redacted-qr]";
const REDACTED_TOKEN = "[redacted-token]";

const forbiddenContentKeys = new Set(["body", "content", "messagebody", "message_body", "text"]);
const forbiddenSecretKeys = [
  /token/i,
  /authorization/i,
  /cookie/i,
  /^qr$/i,
  /qr_?data/i,
  /browser.*path/i,
  /session.*path/i
];
const phoneKeyPattern = /(from|to|phone|chat.?id|sender.?id|recipient)/i;
const windowsPathPattern = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const posixPathPattern = /\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session|sessions)[^\s"]*/gi;
const e164PhonePattern = /\+\d{8,15}/g;
const whatsappJidPattern = /\b\d{8,15}@(c|g)\.us\b/gi;
const tokenValuePattern =
  /\b(?:Bearer\s+)?[A-Za-z0-9._-]{24,}\b|token=[^\s&]+|access[_-]?token=[^\s&]+/gi;
const qrValuePattern =
  /data:image\/[a-z]+;base64,[a-z0-9+/=]+|qr(?:[_\s-]?(?:code|data|marker))?[:=][^\s]+/gi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasForbiddenSecretKey = (key: string): boolean =>
  forbiddenSecretKeys.some((pattern) => pattern.test(key));

const sanitizeString = (value: string, key?: string): string => {
  if (hasForbiddenSecretKey(key ?? "")) {
    if (/qr/i.test(key ?? "")) {
      return REDACTED_QR;
    }

    if (/path/i.test(key ?? "")) {
      return REDACTED_PATH;
    }

    return REDACTED_TOKEN;
  }

  if (windowsPathPattern.test(value) || posixPathPattern.test(value)) {
    windowsPathPattern.lastIndex = 0;
    posixPathPattern.lastIndex = 0;
    return REDACTED_PATH;
  }

  windowsPathPattern.lastIndex = 0;
  posixPathPattern.lastIndex = 0;

  if (qrValuePattern.test(value)) {
    qrValuePattern.lastIndex = 0;
    return REDACTED_QR;
  }

  qrValuePattern.lastIndex = 0;

  if (phoneKeyPattern.test(key ?? "")) {
    return REDACTED_PHONE;
  }

  return value
    .replace(e164PhonePattern, REDACTED_PHONE)
    .replace(whatsappJidPattern, REDACTED_PHONE)
    .replace(tokenValuePattern, REDACTED_TOKEN);
};

const sanitizeValue = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, key));
  }

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitizedEntries = Object.entries(value).flatMap(([entryKey, entryValue]) => {
    if (forbiddenContentKeys.has(entryKey.toLowerCase())) {
      return [];
    }

    return [[entryKey, sanitizeValue(entryValue, entryKey)]];
  });

  return Object.fromEntries(sanitizedEntries);
};

export const sanitizePersistenceMetadata = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }

  const sanitized = sanitizeValue(metadata);

  if (!isRecord(sanitized) || Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return sanitized;
};

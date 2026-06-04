import { randomUUID } from "node:crypto";
import type {
  PersistenceService,
  SqlitePersistenceService
} from "../../persistence/index.ts";
import type { OpenWaDispatchResult, OpenWaRawMessage } from "../../transport/openwa/types.ts";

const AUDIT_ENTITY_TYPE = "openwa_runtime";
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
const phoneKeyPattern = /(?:^|\b)(?:from|to|phone|chatid|chat_id|senderid|sender_id|recipient)(?:\b|$)/i;
const windowsPathPattern = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const posixPathPattern = /\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session|sessions)[^\s"]*/gi;
const e164PhonePattern = /\+\d{8,15}/g;
const whatsappJidPattern = /\b\d{8,15}@(c|g)\.us\b/gi;
const tokenValuePattern =
  /\b(?:Bearer\s+)?[A-Za-z0-9._-]{24,}\b|token=[^\s&]+|access[_-]?token=[^\s&]+/gi;
const qrValuePattern =
  /data:image\/[a-z]+;base64,[a-z0-9+/=]+|qr(?:[_\s-]?(?:code|data|marker))?[:=][^\s]+/gi;

export interface TechnicalPersistenceReadyOptions {
  sessionId: string;
}

export interface OpenWaTechnicalPersistence {
  isMessageProcessed(messageId: string): Promise<boolean>;
  markMessageProcessed(message: OpenWaRawMessage): Promise<void>;
  recordRuntimeStarted(): Promise<void>;
  recordRuntimeStopped(reason: string): Promise<void>;
  recordMessageReceived(message: OpenWaRawMessage): Promise<void>;
  recordMessageIgnoredDuplicate(
    message: OpenWaRawMessage,
    source: "process_local" | "persistent"
  ): Promise<void>;
  recordOutputDispatched(
    message: OpenWaRawMessage,
    dispatchResult: OpenWaDispatchResult
  ): Promise<void>;
  recordDispatchFailed(message: OpenWaRawMessage, error: unknown): Promise<void>;
  close?(): void;
}

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

export const sanitizeTechnicalAuditPayload = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTechnicalAuditPayload(entry, key));
  }

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitizedEntries = Object.entries(value).flatMap(([entryKey, entryValue]) => {
    const normalizedKey = entryKey.toLowerCase();

    if (forbiddenContentKeys.has(normalizedKey)) {
      return [];
    }

    return [[entryKey, sanitizeTechnicalAuditPayload(entryValue, entryKey)]];
  });

  return Object.fromEntries(sanitizedEntries);
};

const sanitizeMetadata = (
  metadata: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const sanitized = sanitizeTechnicalAuditPayload(metadata);

  if (!isRecord(sanitized) || Object.keys(sanitized).length === 0) {
    return undefined;
  }

  return sanitized;
};

const createRuntimeAuditEvent = async (
  persistenceService: PersistenceService,
  runtimeEntityId: string,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> => {
  const sanitizedMetadata = sanitizeMetadata(metadata);

  await persistenceService.appendAuditEvent({
    eventId: randomUUID(),
    eventType,
    entityType: AUDIT_ENTITY_TYPE,
    entityId: runtimeEntityId,
    ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {})
  });
};

export const createOpenWaTechnicalPersistence = (
  persistenceService: PersistenceService,
  options: TechnicalPersistenceReadyOptions
): OpenWaTechnicalPersistence => {
  const runtimeEntityId = options.sessionId;

  return {
    async isMessageProcessed(messageId) {
      return persistenceService.isMessageProcessed(messageId);
    },

    async markMessageProcessed(message) {
      await persistenceService.markMessageProcessed(message.id, {
        senderId: REDACTED_PHONE,
        transportChatId: REDACTED_PHONE
      });
    },

    async recordRuntimeStarted() {
      await createRuntimeAuditEvent(
        persistenceService,
        runtimeEntityId,
        "openwa_runtime_started",
        {
          sessionId: runtimeEntityId
        }
      );
    },

    async recordRuntimeStopped(reason) {
      await createRuntimeAuditEvent(
        persistenceService,
        runtimeEntityId,
        "openwa_runtime_stopped",
        {
          reason,
          sessionId: runtimeEntityId
        }
      );
    },

    async recordMessageReceived(message) {
      await createRuntimeAuditEvent(
        persistenceService,
        message.id,
        "openwa_message_received",
        {
          messageId: message.id,
          fromMe: message.fromMe,
          timestamp: message.timestamp
        }
      );
    },

    async recordMessageIgnoredDuplicate(message, source) {
      await createRuntimeAuditEvent(
        persistenceService,
        message.id,
        "openwa_message_ignored_duplicate",
        {
          duplicateSource: source,
          fromMe: message.fromMe,
          timestamp: message.timestamp
        }
      );
    },

    async recordOutputDispatched(message, dispatchResult) {
      await createRuntimeAuditEvent(
        persistenceService,
        message.id,
        "openwa_output_dispatched",
        {
          messageId: message.id,
          dispatchedCount: dispatchResult.messageCount,
          unsupportedCount: dispatchResult.unsupportedCount
        }
      );
    },

    async recordDispatchFailed(message, error) {
      await createRuntimeAuditEvent(
        persistenceService,
        message.id,
        "openwa_dispatch_failed",
        {
          messageId: message.id,
          error: error instanceof Error ? error.message : "unknown_error"
        }
      );
    },

    close() {
      if ("close" in persistenceService && typeof persistenceService.close === "function") {
        (persistenceService as SqlitePersistenceService).close();
      }
    }
  };
};

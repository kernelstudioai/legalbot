import { z } from "zod";

export const DEFAULT_BOT_MODE = "smoke";
export const DEFAULT_WHATSAPP_TRANSPORT = "openwa";
export const DEFAULT_OPENWA_SESSION_ID = "legalbot-smoke";
export const DEFAULT_NODE_ENV = "development";
export const DEFAULT_LOG_LEVEL = "info";
export const DEFAULT_DATABASE_URL = "file:./data/legalbot.sqlite";
export const DEFAULT_DATABASE_MIGRATIONS_ENABLED = "true";
export const DEFAULT_BUSINESS_PERSISTENCE_ENABLED = "true";
export const DEFAULT_TECHNICAL_PERSISTENCE_ENABLED = "true";
export const DEFAULT_WHATSAPP_CLOUD_WEBHOOK_HOST = "127.0.0.1";
export const DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PORT = "3002";
export const DEFAULT_OPENWA_STARTUP_MAX_ATTEMPTS = "1";
export const DEFAULT_OPENWA_STARTUP_RETRY_DELAY_SECONDS = "5";
export const DEFAULT_OPENWA_LIVENESS_INTERVAL_SECONDS = "30";
export const DEFAULT_OPENWA_LIVENESS_FAILURE_THRESHOLD = "3";
export const DEFAULT_OPENWA_RECOVERY_MODE = "manual";
export const DEFAULT_OPENWA_RECOVERY_RETRY_DELAY_SECONDS = "10";
export const DEFAULT_OPENWA_STATUS_SERVER_ENABLED = "true";
export const DEFAULT_OPENWA_STATUS_SERVER_HOST = "127.0.0.1";
export const DEFAULT_OPENWA_STATUS_SERVER_PORT = "3001";

const createBooleanEnvSchema = (defaultValue: "true" | "false") =>
  z.preprocess(
    (value) => (value === undefined ? defaultValue : value),
    z.enum(["true", "false"]).transform((value) => value === "true")
  );

const OptionalTimeoutSecondsSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }

    return value;
  },
  z.coerce.number().int().min(0).optional()
);

const RetryDelaySecondsSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_STARTUP_RETRY_DELAY_SECONDS : value),
  z.coerce.number().int().min(0)
);

const RecoveryRetryDelaySecondsSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_RECOVERY_RETRY_DELAY_SECONDS : value),
  z.coerce.number().int().min(0)
);

const StatusServerPortSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_STATUS_SERVER_PORT : value),
  z.coerce.number().int().min(0).max(65535)
);

const CloudWebhookPortSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PORT : value),
  z.coerce.number().int().min(0).max(65535)
);

const StartupMaxAttemptsSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_STARTUP_MAX_ATTEMPTS : value),
  z.coerce.number().int().min(1)
);

const LivenessIntervalSecondsSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_LIVENESS_INTERVAL_SECONDS : value),
  z.coerce.number().int().min(1)
);

const LivenessFailureThresholdSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_LIVENESS_FAILURE_THRESHOLD : value),
  z.coerce.number().int().min(1)
);

const RecoveryModeSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_OPENWA_RECOVERY_MODE : value),
  z.enum(["manual", "restart_client"])
);

const DatabaseUrlSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_DATABASE_URL : value),
  z.string().min(1)
);

export const DatabaseMigrationsEnabledSchema =
  createBooleanEnvSchema(DEFAULT_DATABASE_MIGRATIONS_ENABLED);

const OptionalRecoveryMaxAttemptsSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }

    return value;
  },
  z.coerce.number().int().min(0).optional()
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default(DEFAULT_NODE_ENV),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default(DEFAULT_LOG_LEVEL),
  WHATSAPP_TRANSPORT: z
    .enum(["openwa", "cloud"])
    .default(DEFAULT_WHATSAPP_TRANSPORT),
  OPENWA_HEADLESS: createBooleanEnvSchema("true"),
  DATABASE_URL: DatabaseUrlSchema,
  DATABASE_MIGRATIONS_ENABLED: DatabaseMigrationsEnabledSchema,
  BUSINESS_PERSISTENCE_ENABLED: createBooleanEnvSchema(DEFAULT_BUSINESS_PERSISTENCE_ENABLED),
  TECHNICAL_PERSISTENCE_ENABLED: createBooleanEnvSchema(DEFAULT_TECHNICAL_PERSISTENCE_ENABLED)
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const SmokeRuntimeEnvSchema = EnvSchema.omit({
  OPENWA_HEADLESS: true
}).extend({
  WHATSAPP_TRANSPORT: z.preprocess(
    (value) => (value === undefined ? DEFAULT_WHATSAPP_TRANSPORT : value),
    z.literal("openwa")
  ),
  BOT_MODE: z.preprocess(
    (value) => (value === undefined ? DEFAULT_BOT_MODE : value),
    z.literal(DEFAULT_BOT_MODE)
  ),
  OPENWA_SESSION_ID: z.preprocess(
    (value) => (value === undefined ? DEFAULT_OPENWA_SESSION_ID : value),
    z.string().min(1)
  ),
  LAWYER_PHONE_E164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  OPENWA_BROWSER_EXECUTABLE_PATH: z.string().min(1).optional(),
  OPENWA_HEADLESS: createBooleanEnvSchema("false"),
  OPENWA_QR_TIMEOUT_SECONDS: OptionalTimeoutSecondsSchema,
  OPENWA_AUTH_TIMEOUT_SECONDS: OptionalTimeoutSecondsSchema,
  OPENWA_STARTUP_MAX_ATTEMPTS: StartupMaxAttemptsSchema,
  OPENWA_STARTUP_RETRY_DELAY_SECONDS: RetryDelaySecondsSchema,
  OPENWA_LIVENESS_INTERVAL_SECONDS: LivenessIntervalSecondsSchema,
  OPENWA_LIVENESS_FAILURE_THRESHOLD: LivenessFailureThresholdSchema,
  OPENWA_RECOVERY_MODE: RecoveryModeSchema,
  OPENWA_RECOVERY_MAX_ATTEMPTS: OptionalRecoveryMaxAttemptsSchema,
  OPENWA_RECOVERY_RETRY_DELAY_SECONDS: RecoveryRetryDelaySecondsSchema,
  OPENWA_STATUS_SERVER_ENABLED: createBooleanEnvSchema(DEFAULT_OPENWA_STATUS_SERVER_ENABLED),
  OPENWA_STATUS_SERVER_HOST: z
    .string()
    .min(1)
    .default(DEFAULT_OPENWA_STATUS_SERVER_HOST),
  OPENWA_STATUS_SERVER_PORT: StatusServerPortSchema
}).transform((env) => ({
  ...env,
  OPENWA_RECOVERY_MAX_ATTEMPTS:
    env.OPENWA_RECOVERY_MAX_ATTEMPTS ??
    (env.OPENWA_RECOVERY_MODE === "restart_client" ? 1 : 0)
}));

export type SmokeRuntimeEnv = z.infer<typeof SmokeRuntimeEnvSchema>;

export const WhatsAppCloudRuntimeEnvSchema = EnvSchema.extend({
  WHATSAPP_TRANSPORT: z.literal("cloud"),
  WHATSAPP_CLOUD_API_VERSION: z.string().min(1),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_CLOUD_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_CLOUD_WEBHOOK_HOST: z
    .string()
    .min(1)
    .default(DEFAULT_WHATSAPP_CLOUD_WEBHOOK_HOST),
  WHATSAPP_CLOUD_WEBHOOK_PORT: CloudWebhookPortSchema
});

export type WhatsAppCloudRuntimeEnv = z.infer<typeof WhatsAppCloudRuntimeEnvSchema>;

export const isProductionNodeEnv = (
  source: {
    NODE_ENV?: string | undefined;
  } = process.env
): boolean => (source.NODE_ENV ?? DEFAULT_NODE_ENV) === "production";

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): AppEnv =>
  EnvSchema.parse(source);

export const loadSmokeRuntimeEnv = (
  source: NodeJS.ProcessEnv = process.env
): SmokeRuntimeEnv => SmokeRuntimeEnvSchema.parse(source);

export const loadWhatsAppCloudRuntimeEnv = (
  source: NodeJS.ProcessEnv = process.env
): WhatsAppCloudRuntimeEnv => WhatsAppCloudRuntimeEnvSchema.parse(source);

export { EnvSchema };

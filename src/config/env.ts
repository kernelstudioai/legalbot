import { z } from "zod";

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
  (value) => (value === undefined ? "5" : value),
  z.coerce.number().int().min(0)
);

const StartupMaxAttemptsSchema = z.preprocess(
  (value) => (value === undefined ? "1" : value),
  z.coerce.number().int().min(1)
);

const LivenessIntervalSecondsSchema = z.preprocess(
  (value) => (value === undefined ? "30" : value),
  z.coerce.number().int().min(1)
);

const LivenessFailureThresholdSchema = z.preprocess(
  (value) => (value === undefined ? "3" : value),
  z.coerce.number().int().min(1)
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OPENWA_HEADLESS: createBooleanEnvSchema("true")
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const SmokeRuntimeEnvSchema = EnvSchema.omit({
  OPENWA_HEADLESS: true
}).extend({
  BOT_MODE: z.literal("smoke"),
  OPENWA_SESSION_ID: z.string().min(1),
  LAWYER_PHONE_E164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  OPENWA_BROWSER_EXECUTABLE_PATH: z.string().min(1).optional(),
  OPENWA_HEADLESS: createBooleanEnvSchema("false"),
  OPENWA_QR_TIMEOUT_SECONDS: OptionalTimeoutSecondsSchema,
  OPENWA_AUTH_TIMEOUT_SECONDS: OptionalTimeoutSecondsSchema,
  OPENWA_STARTUP_MAX_ATTEMPTS: StartupMaxAttemptsSchema,
  OPENWA_STARTUP_RETRY_DELAY_SECONDS: RetryDelaySecondsSchema,
  OPENWA_LIVENESS_INTERVAL_SECONDS: LivenessIntervalSecondsSchema,
  OPENWA_LIVENESS_FAILURE_THRESHOLD: LivenessFailureThresholdSchema
});

export type SmokeRuntimeEnv = z.infer<typeof SmokeRuntimeEnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): AppEnv =>
  EnvSchema.parse(source);

export const loadSmokeRuntimeEnv = (
  source: NodeJS.ProcessEnv = process.env
): SmokeRuntimeEnv => SmokeRuntimeEnvSchema.parse(source);

export { EnvSchema };

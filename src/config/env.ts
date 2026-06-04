import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OPENWA_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const SmokeRuntimeEnvSchema = EnvSchema.extend({
  BOT_MODE: z.literal("smoke"),
  OPENWA_SESSION_ID: z.string().min(1),
  LAWYER_PHONE_E164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  OPENWA_BROWSER_EXECUTABLE_PATH: z.string().min(1).optional()
});

export type SmokeRuntimeEnv = z.infer<typeof SmokeRuntimeEnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): AppEnv =>
  EnvSchema.parse(source);

export const loadSmokeRuntimeEnv = (
  source: NodeJS.ProcessEnv = process.env
): SmokeRuntimeEnv => SmokeRuntimeEnvSchema.parse(source);

export { EnvSchema };

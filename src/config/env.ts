import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OPENWA_SESSION_NAME: z.string().min(1).default("legalbot-foundation"),
  OPENWA_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): AppEnv =>
  EnvSchema.parse(source);

export { EnvSchema };

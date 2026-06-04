export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const write = (level: string, message: string, meta?: Record<string, unknown>): void => {
  const serializedMeta = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${level}] ${message}${serializedMeta}`);
};

export const consoleLogger: Logger = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta)
};

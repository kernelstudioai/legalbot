export type RuntimeTransport = "openwa" | "cloud";

export const parseTransportOverride = (
  argv: string[] = process.argv
): RuntimeTransport | undefined => {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] !== "--transport") {
      continue;
    }

    const value = argv[index + 1];
    if (value === "openwa" || value === "cloud") {
      return value;
    }
  }

  return undefined;
};

export const applyTransportOverride = (
  envSource: NodeJS.ProcessEnv,
  transportOverride?: RuntimeTransport
): NodeJS.ProcessEnv =>
  transportOverride
    ? {
        ...envSource,
        WHATSAPP_TRANSPORT: transportOverride
      }
    : envSource;

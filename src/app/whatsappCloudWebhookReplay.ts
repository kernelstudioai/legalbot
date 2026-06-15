import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createWhatsAppCloudSignature,
  DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH,
  parseWhatsAppCloudWebhookPayload
} from "../transport/whatsapp-cloud/index.ts";
import { toJsonStdout } from "./opsCommandCommon.ts";

const DEFAULT_FIXTURES_DIRECTORY = "tests/fixtures/whatsapp-cloud";
const DEFAULT_CLOUD_WEBHOOK_PORT = "3002";
const REPLAY_HEADER = "x-legalbot-cloud-replay";
const REPLAY_USAGE = [
  "Usage:",
  "  npm run webhook:replay:cloud -- --fixture <path> --target <loopback-http-url> [--signed]",
  "",
  "Options:",
  "  --fixture <path>  JSON fixture inside tests/fixtures/whatsapp-cloud/",
  "  --target <url>    Loopback HTTP webhook URL (default: http://127.0.0.1:3002/webhooks/whatsapp/cloud)",
  "  --signed          Sign with WHATSAPP_CLOUD_APP_SECRET",
  "  --help            Show this sanitized usage"
].join("\n");

interface ReplayHttpClient {
  post(
    url: string,
    options: {
      body: string;
      headers: Record<string, string>;
      signal: AbortSignal;
    }
  ): Promise<{
    ok: boolean;
    status: number;
  }>;
}

interface ReplayEventSummary {
  malformed: boolean;
  normalizedTextMessageCount: number;
  statusEventCount: number;
  unsupportedMessageCount: number;
}

export interface WhatsAppCloudReplayReport {
  status: "accepted" | "rejected";
  fixture: string;
  signed: boolean;
  target: {
    origin: string;
    path: string;
  };
  eventSummary: ReplayEventSummary;
  response: {
    ok: boolean;
    statusCode: number;
  };
}

export interface WhatsAppCloudReplayOptions {
  args?: string[];
  cwd?: string;
  envSource?: NodeJS.ProcessEnv;
  fixturesDirectory?: string;
  httpClient?: ReplayHttpClient;
  stdout?: {
    write(chunk: string): void;
  };
}

export interface WhatsAppCloudReplaySummary {
  exitCode: number;
  report: WhatsAppCloudReplayReport;
}

interface ParsedReplayArgs {
  fixture: string;
  help: boolean;
  signed: boolean;
  target?: string;
}

const createFetchHttpClient = (): ReplayHttpClient => ({
  async post(url, options) {
    return fetch(url, {
      method: "POST",
      body: options.body,
      headers: options.headers,
      signal: options.signal
    });
  }
});

const parseReplayArgs = (args: string[]): ParsedReplayArgs => {
  let fixture: string | undefined;
  let help = false;
  let signed = false;
  let target: string | undefined;

  const readValue = (index: number, errorCode: string): string => {
    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(errorCode);
    }

    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help") {
      help = true;
      continue;
    }

    if (argument === "--signed") {
      signed = true;
      continue;
    }

    if (argument === "--fixture") {
      fixture = readValue(index, "fixture_required");
      index += 1;
      continue;
    }

    if (argument === "--target" || argument === "--url") {
      target = readValue(index, "local_cloud_webhook_url_required");
      index += 1;
      continue;
    }

    throw new Error("unsupported_replay_argument");
  }

  if (!help && !fixture) {
    throw new Error("fixture_required");
  }

  return {
    fixture: fixture ?? "not_loaded",
    help,
    signed,
    ...(target ? { target } : {})
  };
};

const resolveFixturePath = ({
  cwd,
  fixture,
  fixturesDirectory
}: {
  cwd: string;
  fixture: string;
  fixturesDirectory: string;
}): string => {
  const fixtureRootPath = path.resolve(cwd, fixturesDirectory);
  const candidatePath =
    path.basename(fixture) === fixture
      ? path.join(fixtureRootPath, fixture)
      : path.resolve(cwd, fixture);
  const lexicalRelativePath = path.relative(fixtureRootPath, candidatePath);

  if (
    lexicalRelativePath.startsWith("..") ||
    path.isAbsolute(lexicalRelativePath)
  ) {
    throw new Error("fixture_outside_safe_directory");
  }

  if (!fixture.endsWith(".json")) {
    throw new Error("fixture_name_invalid");
  }

  let fixtureRoot: string;
  let fixturePath: string;

  try {
    fixtureRoot = realpathSync(fixtureRootPath);
    fixturePath = realpathSync(candidatePath);
  } catch {
    throw new Error("fixture_not_found");
  }
  const relativePath = path.relative(fixtureRoot, fixturePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("fixture_outside_safe_directory");
  }

  return fixturePath;
};

const createEventSummary = (rawBody: string): ReplayEventSummary => {
  try {
    const payload = JSON.parse(rawBody) as unknown;
    const parsed = parseWhatsAppCloudWebhookPayload(payload);

    return {
      malformed: false,
      normalizedTextMessageCount: parsed.messages.length,
      statusEventCount: parsed.statusEventCount,
      unsupportedMessageCount: parsed.unsupportedMessageCount
    };
  } catch {
    return {
      malformed: true,
      normalizedTextMessageCount: 0,
      statusEventCount: 0,
      unsupportedMessageCount: 0
    };
  }
};

const createDefaultUrl = (envSource: NodeJS.ProcessEnv): string =>
  `http://127.0.0.1:${
    envSource.WHATSAPP_CLOUD_WEBHOOK_PORT ?? DEFAULT_CLOUD_WEBHOOK_PORT
  }${DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH}`;

const validateLocalTarget = (value: string): URL => {
  let target: URL;

  try {
    target = new URL(value);
  } catch {
    throw new Error("local_cloud_webhook_url_required");
  }

  if (
    target.protocol !== "http:" ||
    (target.hostname !== "127.0.0.1" &&
      target.hostname !== "localhost" &&
      target.hostname !== "::1") ||
    target.pathname !== DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  ) {
    throw new Error("local_cloud_webhook_url_required");
  }

  return target;
};

const createFailureReport = ({
  fixture,
  signed,
  target
}: {
  fixture: string;
  signed: boolean;
  target: URL;
}): WhatsAppCloudReplayReport => ({
  status: "rejected",
  fixture,
  signed,
  target: {
    origin: target.origin,
    path: target.pathname
  },
  eventSummary: {
    malformed: true,
    normalizedTextMessageCount: 0,
    statusEventCount: 0,
    unsupportedMessageCount: 0
  },
  response: {
    ok: false,
    statusCode: 0
  }
});

export const runWhatsAppCloudWebhookReplay = async ({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  envSource = process.env,
  fixturesDirectory = DEFAULT_FIXTURES_DIRECTORY,
  httpClient = createFetchHttpClient(),
  stdout = process.stdout
}: WhatsAppCloudReplayOptions = {}): Promise<WhatsAppCloudReplaySummary> => {
  let parsedArgs: ParsedReplayArgs;

  try {
    parsedArgs = parseReplayArgs(args);
  } catch (error) {
    const target = validateLocalTarget(createDefaultUrl(envSource));
    const report = createFailureReport({
      fixture: "not_loaded",
      signed: false,
      target
    });
    toJsonStdout(
      {
        ...report,
        error: error instanceof Error ? error.message : "replay_configuration_invalid"
      },
      stdout
    );
    return {
      exitCode: 1,
      report
    };
  }

  if (parsedArgs.help) {
    stdout.write(`${REPLAY_USAGE}\n`);
    return {
      exitCode: 0,
      report: createFailureReport({
        fixture: "not_loaded",
        signed: false,
        target: new URL(
          `http://127.0.0.1:${DEFAULT_CLOUD_WEBHOOK_PORT}${DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PATH}`
        )
      })
    };
  }

  const target = validateLocalTarget(
    parsedArgs.target ?? createDefaultUrl(envSource)
  );

  if (!parsedArgs.signed && envSource.NODE_ENV === "production") {
    throw new Error("unsigned_replay_not_allowed_in_production");
  }

  const appSecret = envSource.WHATSAPP_CLOUD_APP_SECRET;

  if (parsedArgs.signed && !appSecret) {
    throw new Error("signed_replay_requires_app_secret");
  }

  const fixturePath = resolveFixturePath({
    cwd,
    fixture: parsedArgs.fixture,
    fixturesDirectory
  });
  let rawBody: string;

  try {
    rawBody = readFileSync(fixturePath, "utf8");
  } catch {
    throw new Error("fixture_unreadable");
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [REPLAY_HEADER]: "1"
  };

  if (parsedArgs.signed && appSecret) {
    headers["x-hub-signature-256"] = createWhatsAppCloudSignature({
      appSecret,
      rawBody
    });
  }

  let response: Awaited<ReturnType<ReplayHttpClient["post"]>>;

  try {
    response = await httpClient.post(target.href, {
      body: rawBody,
      headers,
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new Error("replay_connection_failed");
  }
  const report: WhatsAppCloudReplayReport = {
    status: response.ok ? "accepted" : "rejected",
    fixture: parsedArgs.fixture,
    signed: parsedArgs.signed,
    target: {
      origin: target.origin,
      path: target.pathname
    },
    eventSummary: createEventSummary(rawBody),
    response: {
      ok: response.ok,
      statusCode: response.status
    }
  };

  toJsonStdout(report, stdout);

  return {
    exitCode: response.ok ? 0 : 1,
    report
  };
};

const isDirectExecution = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
};

const SAFE_ERROR_CODES = new Set([
  "fixture_name_invalid",
  "fixture_not_found",
  "fixture_outside_safe_directory",
  "fixture_required",
  "fixture_unreadable",
  "local_cloud_webhook_url_required",
  "replay_connection_failed",
  "signed_replay_requires_app_secret",
  "unsigned_replay_not_allowed_in_production",
  "unsupported_replay_argument"
]);

const toSafeReplayError = (error: unknown): string =>
  error instanceof Error && SAFE_ERROR_CODES.has(error.message)
    ? error.message
    : "replay_failed";

if (isDirectExecution()) {
  void runWhatsAppCloudWebhookReplay()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      toJsonStdout({
        status: "rejected",
        error: toSafeReplayError(error)
      });
      process.exitCode = 1;
    });
}

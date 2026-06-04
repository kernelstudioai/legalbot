import { mkdirSync } from "node:fs";
import path from "node:path";
import { create, type Client, type ConfigObject, type Message } from "@open-wa/wa-automate";
import type { OpenWaRawMessage, OpenWaRuntimeClient } from "./types.ts";

export interface OpenWaConfig {
  sessionId: string;
  headless: boolean;
  sessionDataPath: string;
  authTimeout: number;
  qrTimeout: number;
  browserExecutablePath?: string;
  useChrome?: boolean;
}

export const OPENWA_SESSION_PATH = "openwa-session";
export const OPENWA_DEFAULT_QR_TIMEOUT_SECONDS = 180;
export const OPENWA_DEFAULT_AUTH_TIMEOUT_SECONDS = 180;

const normalizeTimestamp = (
  timestamp: number | undefined,
  fallback: number | undefined
): number => {
  const candidate = timestamp ?? fallback ?? Date.now();
  return candidate > 10_000_000_000 ? candidate : candidate * 1000;
};

export const toOpenWaRawMessage = (
  message: Pick<
    Message,
    "id" | "from" | "chatId" | "body" | "fromMe" | "timestamp" | "t" | "notifyName" | "sender"
  >
): OpenWaRawMessage => {
  const sender = message.sender?.pushname
    ? {
        pushname: message.sender.pushname
      }
    : undefined;

  return {
    id: String(message.id),
    from: String(message.from),
    chatId: String(message.chatId),
    body: message.body,
    fromMe: message.fromMe,
    timestamp: normalizeTimestamp(message.timestamp, message.t),
    ...(message.notifyName ? { notifyName: message.notifyName } : {}),
    ...(sender ? { sender } : {})
  };
};

export interface CreateOpenWaConfigOptions {
  sessionId: string;
  headless?: boolean;
  sessionDataPath?: string;
  authTimeout?: number;
  qrTimeout?: number;
  browserExecutablePath?: string;
}

export const createOpenWaConfig = ({
  sessionId,
  headless = false,
  sessionDataPath = path.join(process.cwd(), OPENWA_SESSION_PATH),
  authTimeout = OPENWA_DEFAULT_AUTH_TIMEOUT_SECONDS,
  qrTimeout = OPENWA_DEFAULT_QR_TIMEOUT_SECONDS,
  browserExecutablePath
}: CreateOpenWaConfigOptions): OpenWaConfig => {
  const config: OpenWaConfig = {
    sessionId,
    headless,
    sessionDataPath,
    authTimeout,
    qrTimeout
  };

  if (browserExecutablePath) {
    config.browserExecutablePath = browserExecutablePath;
    config.useChrome = true;
  }

  return config;
};

export const toOpenWaConfigObject = (config: OpenWaConfig): ConfigObject => {
  mkdirSync(config.sessionDataPath, { recursive: true });

  return {
    sessionId: config.sessionId,
    headless: config.headless,
    sessionDataPath: config.sessionDataPath,
    authTimeout: config.authTimeout,
    qrTimeout: config.qrTimeout,
    ...(config.browserExecutablePath
      ? {
          executablePath: config.browserExecutablePath,
          useChrome: config.useChrome
        }
      : {})
  };
};

export const toOpenWaStartupMeta = (config: OpenWaConfig) => ({
  session_id: config.sessionId,
  session_data_path: path.relative(process.cwd(), config.sessionDataPath) || config.sessionDataPath,
  openwa_browser_executable_path_set: Boolean(config.browserExecutablePath),
  openwa_use_chrome: config.useChrome === true,
  openwa_headless: config.headless,
  openwa_qr_timeout_seconds: config.qrTimeout,
  openwa_auth_timeout_seconds: config.authTimeout
});

export const wrapOpenWaClient = (
  client: Pick<Client, "onMessage" | "sendText" | "kill">
): OpenWaRuntimeClient => ({
  onMessage: (listener) =>
    client.onMessage((message) => listener(toOpenWaRawMessage(message))),
  sendText: (to, body) =>
    client.sendText(to as Parameters<Client["sendText"]>[0], body),
  kill: (reason) => client.kill(reason)
});

export const createOpenWaClient = async (
  config: OpenWaConfig
): Promise<OpenWaRuntimeClient> => {
  const client = await create(toOpenWaConfigObject(config));
  return wrapOpenWaClient(client);
};

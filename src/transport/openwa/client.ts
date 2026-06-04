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
}

export const OPENWA_SESSION_PATH = "openwa-session";

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

export const createOpenWaConfig = (sessionId: string): OpenWaConfig => ({
  sessionId,
  headless: true,
  sessionDataPath: path.join(process.cwd(), OPENWA_SESSION_PATH),
  authTimeout: 0,
  qrTimeout: 0
});

const toOpenWaConfigObject = (config: OpenWaConfig): ConfigObject => {
  mkdirSync(config.sessionDataPath, { recursive: true });

  return {
    sessionId: config.sessionId,
    headless: config.headless,
    sessionDataPath: config.sessionDataPath,
    authTimeout: config.authTimeout,
    qrTimeout: config.qrTimeout
  };
};

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

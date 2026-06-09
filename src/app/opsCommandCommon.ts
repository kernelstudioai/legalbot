import { readFileSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../logging/logger.ts";

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export interface BufferedStdout {
  getOutput(): string;
  stdout: {
    write(chunk: string): void;
  };
}

export const createBufferedStdout = (): BufferedStdout => {
  let output = "";

  return {
    getOutput() {
      return output;
    },
    stdout: {
      write(chunk: string) {
        output += chunk;
      }
    }
  };
};

export const parseNodeMajorVersion = (version: string): number | null => {
  const match = /^v?(\d+)$/.exec(version.split(".")[0] ?? "");
  return match ? Number(match[1]) : null;
};

export const hasGitIgnoreDirectoryEntry = ({
  cwd = process.cwd(),
  directory
}: {
  cwd?: string;
  directory: string;
}): boolean => {
  const gitignorePath = path.join(cwd, ".gitignore");
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  const gitignore = readFileSync(gitignorePath, "utf8");

  return gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => line === normalizedDirectory || line === `${normalizedDirectory}/`);
};

export const toJsonStdout = (
  payload: unknown,
  stdout: {
    write(chunk: string): void;
  } = process.stdout
): void => {
  stdout.write(`${JSON.stringify(payload)}\n`);
};

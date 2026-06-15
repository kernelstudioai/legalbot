import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirectories: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(join(os.tmpdir(), "legalbot-systemd-test-"));
  tempDirectories.push(tempDir);
  return tempDir;
};

const writeExecutable = (directory: string, name: string, body: string): string => {
  const targetPath = join(directory, name);
  writeFileSync(targetPath, body, "utf8");
  chmodSync(targetPath, 0o755);
  return targetPath;
};

const createFakeBin = () => {
  const fakeBin = createTempDir();
  const npmPath = writeExecutable(fakeBin, "npm", "#!/usr/bin/env bash\nexit 0\n");
  const dockerPath = writeExecutable(fakeBin, "docker", "#!/usr/bin/env bash\nexit 0\n");

  writeExecutable(fakeBin, "uname", "#!/usr/bin/env bash\necho Linux\n");
  writeExecutable(fakeBin, "systemctl", "#!/usr/bin/env bash\nexit 0\n");

  return {
    fakeBin,
    dockerPath,
    npmPath
  };
};

const runDryRun = (args: string[], envFileContents?: string) => {
  const projectRoot = createTempDir();
  const envFilePath = join(projectRoot, "legalbot.env");
  const { dockerPath, fakeBin, npmPath } = createFakeBin();
  const scriptPath = resolve(process.cwd(), "scripts/provision-systemd.sh");

  if (envFileContents !== undefined) {
    writeFileSync(envFilePath, envFileContents, "utf8");
  }

  const result = spawnSync(
    "bash",
    [
      scriptPath,
      "--dry-run",
      "--project-root",
      projectRoot,
      "--env-file",
      envFilePath,
      "--npm-path",
      npmPath,
      "--docker-path",
      dockerPath,
      "--user",
      "deploy",
      ...args
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`
      }
    }
  );

  return {
    envFilePath,
    dockerPath,
    npmPath,
    result
  };
};

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("scripts/provision-systemd.sh", () => {
  const script = readFileSync(
    resolve(process.cwd(), "scripts/provision-systemd.sh"),
    "utf8"
  );

  it("uses safe shell defaults and documents both runtime transports", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("--dry-run");
    expect(script).toContain("--install");
    expect(script).toContain("--uninstall");
    expect(script).toContain("--status");
    expect(script).toContain("--transport MODE");
    expect(script).toContain("--deployment MODE");
    expect(script).toContain("--docker-path PATH");
    expect(script).toContain("--service-name NAME");
    expect(script).toContain("--exec-script NAME");
    expect(script).toContain("legalbot-openwa.service");
    expect(script).toContain("legalbot-whatsapp-cloud.service");
  });

  it("keeps provisioning conservative and avoids obvious secret-leaking patterns", () => {
    expect(script).toContain("EnvironmentFile=");
    expect(script).toContain("Requires=docker.service");
    expect(script).toContain("RemainAfterExit=yes");
    expect(script).toContain("WorkingDirectory=");
    expect(script).toContain("ExecStart=");
    expect(script).toContain("LEGALBOT_NPM_PATH");
    expect(script).toContain("command -v npm");
    expect(script).toContain("current_operator_user");
    expect(script).toContain("su - \"$SUDO_USER\" -c 'command -v npm'");
    expect(script).toContain("PROJECT_ROOT/.env");
    expect(script).toContain("Service was not enabled automatically.");
    expect(script).toContain("Service was not started automatically.");
    expect(script).not.toContain("rm -rf");
    expect(script).not.toContain("cat \"$ENV_FILE_PATH\"");
    expect(script).not.toContain("source \"$ENV_FILE_PATH\"");
    expect(script).not.toContain("/usr/bin/npm run smoke:openwa");
    expect(script).not.toContain("/usr/bin/npm run start:whatsapp-cloud");
    expect(script).not.toMatch(/\+[1-9]\d{7,14}/);
  });

  it("generates an OpenWA legacy unit without auto-start defaults", () => {
    const { result, npmPath } = runDryRun([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Transport: openwa");
    expect(result.stdout).toContain("Service name: legalbot-openwa.service");
    expect(result.stdout).toContain("Description=LegalBot OpenWA Smoke Runtime (legacy/dev-only)");
    expect(result.stdout).toContain(`ExecStart=${npmPath} run smoke:openwa`);
    expect(result.stdout).toContain("Recommended before service start: npm run ops:preflight");
    expect(result.stdout).toContain("service would remain disabled by default");
    expect(result.stdout).toContain("service would remain stopped by default");
  });

  it("generates a Cloud Compose unit and never prints env contents", () => {
    const { dockerPath, result } = runDryRun(
      [
        "--transport",
        "cloud",
        "--service-name",
        "legalbot-whatsapp-cloud.service"
      ],
      "WHATSAPP_CLOUD_ACCESS_TOKEN=super-secret-token\n"
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Transport: cloud");
    expect(result.stdout).toContain("Deployment: compose");
    expect(result.stdout).toContain("Service name: legalbot-whatsapp-cloud.service");
    expect(result.stdout).toContain(
      "Description=LegalBot WhatsApp Cloud Docker Compose Runtime"
    );
    expect(result.stdout).not.toContain("EnvironmentFile=");
    expect(result.stdout).toContain(
      `ExecStart=${dockerPath} compose --profile cloud up -d legalbot-whatsapp-cloud`
    );
    expect(result.stdout).toContain(
      `ExecStop=${dockerPath} compose --profile cloud stop legalbot-whatsapp-cloud`
    );
    expect(result.stdout).not.toContain("npm run start:whatsapp-cloud");
    expect(result.stdout).toContain("Recommended before service start: npm run ops:preflight:cloud");
    expect(result.stdout).not.toContain("super-secret-token");
    expect(result.stdout).not.toContain("WHATSAPP_CLOUD_ACCESS_TOKEN=");
  });

  it("rejects direct Node systemd for Cloud", () => {
    const { result } = runDryRun([
      "--transport",
      "cloud",
      "--deployment",
      "direct"
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Direct Node systemd is not supported for Cloud production."
    );
  });
});

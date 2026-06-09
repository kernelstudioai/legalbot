import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("scripts/provision-systemd.sh", () => {
  const script = readFileSync(
    resolve(process.cwd(), "scripts/provision-systemd.sh"),
    "utf8"
  );

  it("uses safe shell defaults and required modes", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("--dry-run");
    expect(script).toContain("--install");
    expect(script).toContain("--uninstall");
    expect(script).toContain("--status");
  });

  it("keeps systemd provisioning conservative by default", () => {
    expect(script).toContain("legalbot-openwa.service");
    expect(script).toContain("EnvironmentFile=");
    expect(script).toContain("WorkingDirectory=");
    expect(script).toContain("ExecStart=");
    expect(script).toContain("LEGALBOT_NPM_PATH");
    expect(script).toContain("command -v npm");
    expect(script).toContain("current_operator_user");
    expect(script).toContain("PROJECT_ROOT/.env");
    expect(script).toContain("npm run ops:preflight");
    expect(script).toContain("npm run ops:post-start");
    expect(script).toContain("Service was not enabled automatically.");
    expect(script).toContain("Service was not started automatically.");
  });

  it("avoids obvious unsafe or secret-leaking patterns", () => {
    expect(script).not.toContain("rm -rf");
    expect(script).not.toContain("cat \"$ENV_FILE_PATH\"");
    expect(script).not.toContain("source \"$ENV_FILE_PATH\"");
    expect(script).not.toContain("/usr/bin/npm run smoke:openwa");
    expect(script).not.toMatch(/\+[1-9]\d{7,14}/);
  });

  it("supports explicit npm path and user selection without auto-start defaults", () => {
    expect(script).toContain("--npm-path PATH");
    expect(script).toContain("--user USER");
    expect(script).toContain("Selected npm path does not exist");
    expect(script).toContain("Selected npm path is not executable");
    expect(script).toContain("Install will still write the unit, but manual start will fail until the env file exists.");
    expect(script).toContain("--start and --enable are supported only with --install.");
  });
});

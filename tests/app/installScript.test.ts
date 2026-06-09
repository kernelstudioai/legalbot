import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("install.sh", () => {
  const script = readFileSync(resolve(process.cwd(), "install.sh"), "utf8");

  it("uses conservative shell safety defaults", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).not.toContain("rm -rf");
  });

  it("supports dry-run mode and guided env handling", () => {
    expect(script).toContain("./install.sh --dry-run");
    expect(script).toContain("LAWYER_PHONE_E164");
    expect(script).toContain("The installer will not display its contents.");
  });

  it("reuses the existing operator checks without starting automatically", () => {
    expect(script).toContain("npm ci");
    expect(script).toContain("npm run db:migrate");
    expect(script).toContain("npm run ops:preflight");
    expect(script).toContain("Start the bot now with 'npm run smoke:openwa'?");
    expect(script).toContain("Systemd service installation is intentionally not included");
  });
});

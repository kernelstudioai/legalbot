import { describe, expect, it } from "vitest";
import { runCloudOpsEvidencePackCommand } from "../../src/app/cloudOpsEvidencePack.ts";

const createStdout = () => {
  let output = "";

  return {
    get output() {
      return output;
    },
    write(chunk: string) {
      output += chunk;
    }
  };
};

const createCommandRunner = (
  responses: Record<string, { exitCode: number; stdout: string; stderr: string }>
) => ({
  run(command: string, args: string[]) {
    const key = `${command} ${args.join(" ")}`.trim();
    return (
      responses[key] ?? {
        exitCode: 1,
        stdout: "",
        stderr: `missing mock for ${key}`
      }
    );
  }
});

describe("cloud ops evidence pack command", () => {
  it("prints sanitized JSON without secrets, raw bodies, or full phone numbers", () => {
    const stdout = createStdout();
    const summary = runCloudOpsEvidencePackCommand({
      args: ["--format", "json", "--host-id", "vps-prod-01"],
      stdout,
      commandRunner: createCommandRunner({
        "git branch --show-current": {
          exitCode: 0,
          stdout: "main\n",
          stderr: ""
        },
        "git rev-parse --short HEAD": {
          exitCode: 0,
          stdout: "815288e\n",
          stderr: ""
        },
        "git status --short": {
          exitCode: 0,
          stdout: " M docs/CLOUD_OPS_EVIDENCE_PACK.md\n?? logs/private.log\n",
          stderr: ""
        },
        "node --version": {
          exitCode: 0,
          stdout: "v22.3.0\n",
          stderr: ""
        },
        "npm --version": {
          exitCode: 0,
          stdout: "10.9.0\n",
          stderr: ""
        },
        "docker --version": {
          exitCode: 0,
          stdout: "Docker version 27.0.0, build deadbeef\n",
          stderr: ""
        },
        "docker compose version": {
          exitCode: 0,
          stdout: "Docker Compose version v2.29.0\n",
          stderr: ""
        },
        "systemctl show legalbot-whatsapp-cloud.service --property=ActiveState --property=SubState --property=UnitFileState": {
          exitCode: 0,
          stdout: "ActiveState=active\nSubState=exited\nUnitFileState=enabled\n",
          stderr: ""
        },
        "docker compose --profile cloud ps legalbot-whatsapp-cloud --format json": {
          exitCode: 0,
          stdout: "{\"Service\":\"legalbot-whatsapp-cloud\",\"State\":\"running\",\"Health\":\"healthy\"}\n",
          stderr: ""
        }
      })
    });

    expect(summary.exitCode).toBe(0);
    expect(summary.report).toMatchObject({
      hostIdentifier: "vps-prod-01",
      branch: "main",
      commit: "815288e",
      systemd: {
        enabled: "enabled",
        activeState: "active",
        subState: "exited",
        interpretation: "expected_for_compose_oneshot_with_remain_after_exit"
      },
      composeService: {
        running: true,
        health: "healthy",
        state: "running"
      },
      finalDecision: {
        decision: "pending"
      }
    });
    expect(stdout.output).not.toContain("private.log");
    expect(stdout.output).not.toContain("app-secret-123");
    expect(stdout.output).not.toContain("+15551234567");
    expect(stdout.output).toContain("\"schemaVersion\":\"m40-cloud-ops-evidence-v1\"");
  });

  it("prints markdown with the command template and no leaked secrets", () => {
    const stdout = createStdout();

    runCloudOpsEvidencePackCommand({
      args: ["--format", "markdown", "--host-id", "prod-ops-01"],
      stdout,
      commandRunner: createCommandRunner({
        "git branch --show-current": {
          exitCode: 0,
          stdout: "main\n",
          stderr: ""
        },
        "git rev-parse --short HEAD": {
          exitCode: 0,
          stdout: "815288e\n",
          stderr: ""
        },
        "git status --short": {
          exitCode: 0,
          stdout: "",
          stderr: ""
        },
        "node --version": {
          exitCode: 0,
          stdout: "v22.3.0\n",
          stderr: ""
        },
        "npm --version": {
          exitCode: 0,
          stdout: "10.9.0\n",
          stderr: ""
        },
        "docker --version": {
          exitCode: 0,
          stdout: "Docker version 27.0.0\n",
          stderr: ""
        },
        "docker compose version": {
          exitCode: 0,
          stdout: "Docker Compose version v2.29.0\n",
          stderr: ""
        },
        "systemctl show legalbot-whatsapp-cloud.service --property=ActiveState --property=SubState --property=UnitFileState": {
          exitCode: 0,
          stdout: "ActiveState=failed\nSubState=dead\nUnitFileState=disabled\n",
          stderr: ""
        },
        "docker compose --profile cloud ps legalbot-whatsapp-cloud --format json": {
          exitCode: 0,
          stdout: "{\"Service\":\"legalbot-whatsapp-cloud\",\"State\":\"exited\",\"Health\":\"unhealthy\"}\n",
          stderr: ""
        }
      })
    });

    expect(stdout.output).toContain("# M40 Cloud Ops Evidence Pack");
    expect(stdout.output).toContain("### preflight");
    expect(stdout.output).toContain("record sanitized output here");
    expect(stdout.output).toContain("prod-ops-01");
    expect(stdout.output).not.toContain("app-secret-123");
    expect(stdout.output).not.toContain("+15551234567");
  });

  it("rejects unsupported arguments with a safe error", () => {
    expect(() =>
      runCloudOpsEvidencePackCommand({
        args: ["--bogus"],
        stdout: createStdout(),
        commandRunner: createCommandRunner({})
      })
    ).toThrow("unsupported_argument");
  });
});

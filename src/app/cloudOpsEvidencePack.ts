import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";

type EvidenceFormat = "json" | "markdown";
type EvidenceStatus = "pass" | "fail" | "not_collected";

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface CommandRunner {
  run(command: string, args: string[]): CommandResult;
}

interface EvidenceCommandTemplate {
  acceptance: string;
  command: string;
  observed: string | null;
  status: EvidenceStatus;
}

interface CloudOpsEvidencePack {
  schemaVersion: "m40-cloud-ops-evidence-v1";
  generatedAt: string;
  hostIdentifier: string | null;
  branch: string | null;
  commit: string | null;
  gitStatus: {
    clean: boolean | null;
    entries: string[];
  };
  versions: {
    node: string | null;
    npm: string | null;
  };
  docker: {
    dockerVersion: string | null;
    composeVersion: string | null;
    available: boolean;
    composeAvailable: boolean;
  };
  systemd: {
    unit: string;
    enabled: string | null;
    activeState: string | null;
    subState: string | null;
    interpretation: string;
  };
  composeService: {
    service: string;
    running: boolean | null;
    health: string | null;
    state: string | null;
  };
  evidence: {
    preflight: EvidenceCommandTemplate;
    postStart: EvidenceCommandTemplate;
    dockerDiagnose: EvidenceCommandTemplate;
    signedReplay: EvidenceCommandTemplate;
    unsignedReplay: EvidenceCommandTemplate;
    directMissingSignature: EvidenceCommandTemplate;
    directInvalidSignature: EvidenceCommandTemplate;
    directValidSignature: EvidenceCommandTemplate;
    mountOwnership: EvidenceCommandTemplate;
    rollbackDrill: EvidenceCommandTemplate;
    restoreDrill: EvidenceCommandTemplate;
  };
  residualRisks: string[];
  finalDecision: {
    decision: "go" | "no_go" | "pending";
    rationale: string | null;
  };
}

export interface CloudOpsEvidencePackCommandOptions {
  args?: string[];
  commandRunner?: CommandRunner;
  cwd?: string;
  stdout?: {
    write(chunk: string): void;
  };
}

export interface CloudOpsEvidencePackSummary extends DbCommandSummary {
  report: CloudOpsEvidencePack;
}

const DEFAULT_UNIT = "legalbot-whatsapp-cloud.service";
const DEFAULT_SERVICE = "legalbot-whatsapp-cloud";
const DEFAULT_HOST_PLACEHOLDER = "SET_ME_TO_A_NON_SENSITIVE_HOST_ALIAS";
const PHONE_PATTERN = /\+?[1-9]\d{7,14}/g;
const TOKEN_PATTERN =
  /\b(?:app[_-]?secret|access[_-]?token|verify[_-]?token|secret|token)\b[=: ]*[^\s,;]+/gi;
const LONG_DIGIT_PATTERN = /\b\d{9,}\b/g;
const PATH_PATTERN = /(?:[A-Za-z]:\\|\/)(?:[^:\r\n\t ]+[\\/])*[^:\r\n\t ]*/g;
const RAW_BODY_PATTERN = /\{.*"entry".*"changes".*\}/i;

const createProcessRunner = (cwd: string): CommandRunner => ({
  run(command, args) {
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8"
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
});

const sanitizeText = (value: string): string =>
  value
    .replace(TOKEN_PATTERN, "redacted_secret")
    .replace(PHONE_PATTERN, "redacted_phone")
    .replace(LONG_DIGIT_PATTERN, "redacted_numeric_id")
    .replace(PATH_PATTERN, "redacted_path")
    .replace(RAW_BODY_PATTERN, "redacted_raw_body");

const sanitizeLine = (value: string): string => sanitizeText(value.trim());

const sanitizeHostIdentifier = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed === DEFAULT_HOST_PLACEHOLDER) {
    return null;
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(trimmed)) {
    return null;
  }

  return sanitizeLine(trimmed);
};

const parseArgs = (args: string[]): {
  format: EvidenceFormat;
  hostIdentifier: string | null;
} => {
  let format: EvidenceFormat = "json";
  let hostIdentifier: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--format") {
      const value = args[index + 1];

      if (value !== "json" && value !== "markdown") {
        throw new Error("invalid_format");
      }

      format = value;
      index += 1;
      continue;
    }

    if (argument === "--host-id") {
      hostIdentifier = sanitizeHostIdentifier(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--use-hostname") {
      hostIdentifier = sanitizeHostIdentifier(hostname());
      continue;
    }

    throw new Error("unsupported_argument");
  }

  return {
    format,
    hostIdentifier
  };
};

const readCommand = (
  runner: CommandRunner,
  command: string,
  args: string[]
): CommandResult => runner.run(command, args);

const getTrimmedStdout = (result: CommandResult): string | null => {
  if (result.exitCode !== 0) {
    return null;
  }

  const trimmed = result.stdout.trim();
  return trimmed.length > 0 ? sanitizeText(trimmed) : null;
};

const getGitStatusEntries = (
  runner: CommandRunner
): {
  available: boolean;
  entries: string[];
} => {
  const result = readCommand(runner, "git", ["status", "--short"]);

  if (result.exitCode !== 0) {
    return {
      available: false,
      entries: []
    };
  }

  return {
    available: true,
    entries: result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => sanitizeLine(line))
  };
};

const parseSystemdShow = (stdout: string): {
  activeState: string | null;
  enabled: string | null;
  subState: string | null;
} => {
  const lines = stdout.split(/\r?\n/);
  const readValue = (prefix: string): string | null => {
    const line = lines.find((entry) => entry.startsWith(prefix));
    return line ? sanitizeLine(line.slice(prefix.length)) : null;
  };

  return {
    activeState: readValue("ActiveState="),
    subState: readValue("SubState="),
    enabled: readValue("UnitFileState=")
  };
};

const parseComposePs = (stdout: string): {
  health: string | null;
  running: boolean | null;
  state: string | null;
} => {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return {
      running: null,
      health: null,
      state: null
    };
  }

  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";

  try {
    const parsed = JSON.parse(firstLine) as {
      Health?: string;
      State?: string;
      Status?: string;
    };
    const rawState = typeof parsed.State === "string" ? parsed.State : parsed.Status;
    const state = rawState ? sanitizeLine(rawState).toLowerCase() : null;
    const health =
      typeof parsed.Health === "string" && parsed.Health.trim()
        ? sanitizeLine(parsed.Health).toLowerCase()
        : null;

    return {
      running: state === "running" || state?.startsWith("up") === true,
      health,
      state
    };
  } catch {
    const sanitized = sanitizeLine(firstLine).toLowerCase();
    return {
      running: sanitized.includes("running") || sanitized.startsWith("up"),
      health: sanitized.includes("healthy")
        ? "healthy"
        : sanitized.includes("unhealthy")
          ? "unhealthy"
          : null,
      state: sanitized || null
    };
  }
};

const createEvidenceCommand = (
  command: string,
  acceptance: string
): EvidenceCommandTemplate => ({
  command,
  acceptance,
  status: "not_collected",
  observed: null
});

const toMarkdown = (report: CloudOpsEvidencePack): string => {
  const lines = [
    "# M40 Cloud Ops Evidence Pack",
    "",
    `- Schema version: ${report.schemaVersion}`,
    `- Generated at: ${report.generatedAt}`,
    `- Host identifier: ${report.hostIdentifier ?? "not_recorded"}`,
    `- Branch: ${report.branch ?? "unavailable"}`,
    `- Commit: ${report.commit ?? "unavailable"}`,
    `- Git status: ${
      report.gitStatus.clean === null ? "unavailable" : report.gitStatus.clean ? "clean" : "dirty"
    }`,
    `- Node version: ${report.versions.node ?? "unavailable"}`,
    `- npm version: ${report.versions.npm ?? "unavailable"}`,
    `- Docker available: ${report.docker.available}`,
    `- Docker Compose available: ${report.docker.composeAvailable}`,
    `- Docker version: ${report.docker.dockerVersion ?? "unavailable"}`,
    `- Compose version: ${report.docker.composeVersion ?? "unavailable"}`,
    `- systemd unit: ${report.systemd.unit}`,
    `- systemd enabled: ${report.systemd.enabled ?? "unavailable"}`,
    `- systemd state: ${report.systemd.activeState ?? "unavailable"} (${report.systemd.subState ?? "unavailable"})`,
    `- systemd interpretation: ${report.systemd.interpretation}`,
    `- Compose service: ${report.composeService.service}`,
    `- Compose running: ${report.composeService.running ?? "unavailable"}`,
    `- Compose health: ${report.composeService.health ?? "unavailable"}`,
    `- Compose state: ${report.composeService.state ?? "unavailable"}`,
    "",
    "## Manual Evidence Checks",
    ""
  ];

  for (const [label, section] of Object.entries(report.evidence)) {
    lines.push(`### ${label}`);
    lines.push(`- Command: \`${section.command}\``);
    lines.push(`- Acceptance: ${section.acceptance}`);
    lines.push(`- Status: ${section.status}`);
    lines.push(`- Observed: ${section.observed ?? "record sanitized output here"}`);
    lines.push("");
  }

  lines.push("## Residual Risks");
  if (report.residualRisks.length === 0) {
    lines.push("- Record residual risks before final decision.");
  } else {
    for (const risk of report.residualRisks) {
      lines.push(`- ${risk}`);
    }
  }
  lines.push("");
  lines.push("## Final Decision");
  lines.push(`- Decision: ${report.finalDecision.decision}`);
  lines.push(`- Rationale: ${report.finalDecision.rationale ?? "record evidence-backed go/no-go rationale here"}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
};

export const runCloudOpsEvidencePackCommand = ({
  args = process.argv.slice(2),
  commandRunner,
  cwd = process.cwd(),
  stdout = process.stdout
}: CloudOpsEvidencePackCommandOptions = {}): CloudOpsEvidencePackSummary => {
  const runner = commandRunner ?? createProcessRunner(cwd);
  const { format, hostIdentifier } = parseArgs(args);
  const branch = getTrimmedStdout(readCommand(runner, "git", ["branch", "--show-current"]));
  const commit = getTrimmedStdout(readCommand(runner, "git", ["rev-parse", "--short", "HEAD"]));
  const gitStatus = getGitStatusEntries(runner);
  const nodeVersion = getTrimmedStdout(readCommand(runner, "node", ["--version"]));
  const npmVersion = getTrimmedStdout(readCommand(runner, "npm", ["--version"]));
  const dockerVersion = readCommand(runner, "docker", ["--version"]);
  const composeVersion = readCommand(runner, "docker", ["compose", "version"]);
  const systemdShow = readCommand(runner, "systemctl", [
    "show",
    DEFAULT_UNIT,
    "--property=ActiveState",
    "--property=SubState",
    "--property=UnitFileState"
  ]);
  const composePs = readCommand(runner, "docker", [
    "compose",
    "--profile",
    "cloud",
    "ps",
    DEFAULT_SERVICE,
    "--format",
    "json"
  ]);
  const systemdStatus = parseSystemdShow(systemdShow.stdout);
  const composeSummary = parseComposePs(composePs.stdout);

  const report: CloudOpsEvidencePack = {
    schemaVersion: "m40-cloud-ops-evidence-v1",
    generatedAt: new Date().toISOString(),
    hostIdentifier,
    branch,
    commit,
    gitStatus: {
      clean: gitStatus.available ? gitStatus.entries.length === 0 : null,
      entries: gitStatus.entries
    },
    versions: {
      node: nodeVersion,
      npm: npmVersion
    },
    docker: {
      dockerVersion: getTrimmedStdout(dockerVersion),
      composeVersion: getTrimmedStdout(composeVersion),
      available: dockerVersion.exitCode === 0,
      composeAvailable: composeVersion.exitCode === 0
    },
    systemd: {
      unit: DEFAULT_UNIT,
      enabled: systemdStatus.enabled,
      activeState: systemdStatus.activeState,
      subState: systemdStatus.subState,
      interpretation:
        systemdStatus.activeState === "active" && systemdStatus.subState === "exited"
          ? "expected_for_compose_oneshot_with_remain_after_exit"
          : "verify_against_container_health_and_post_start_checks"
    },
    composeService: {
      service: DEFAULT_SERVICE,
      running: composeSummary.running,
      health: composeSummary.health,
      state: composeSummary.state
    },
    evidence: {
      preflight: createEvidenceCommand(
        "npm run ops:preflight:cloud",
        'Record sanitized JSON. Accept only `status=\"ready\"` and `blockers=[]`.'
      ),
      postStart: createEvidenceCommand(
        "OPS_POST_START_MODE=docker npm run ops:post-start:cloud",
        'Record sanitized JSON. Accept only `status=\"healthy\"`, `diagnosis.code=\"app_ready\"`, signed replay `200`, and unsigned replay `401`.'
      ),
      dockerDiagnose: createEvidenceCommand(
        "npm run docker:cloud:diagnose",
        'Record sanitized JSON. Accept only `status=\"healthy\"` and a running healthy Compose service.'
      ),
      signedReplay: createEvidenceCommand(
        "npm run webhook:replay:cloud -- --signed --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud",
        "Accept only HTTP 200 with sanitized summary output."
      ),
      unsignedReplay: createEvidenceCommand(
        "npm run webhook:replay:cloud -- --fixture tests/fixtures/whatsapp-cloud/valid-text.json --target http://127.0.0.1:3002/webhooks/whatsapp/cloud",
        "Accept only HTTP 401 in production validation."
      ),
      directMissingSignature: createEvidenceCommand(
        "curl -s -o /dev/null -w \"%{http_code}\" -X POST http://127.0.0.1:3002/webhooks/whatsapp/cloud -H \"Content-Type: application/json\" -H \"X-Legalbot-Cloud-Replay: 1\" --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json",
        "Accept only HTTP 401 for missing signature."
      ),
      directInvalidSignature: createEvidenceCommand(
        "curl -s -o /dev/null -w \"%{http_code}\" -X POST http://127.0.0.1:3002/webhooks/whatsapp/cloud -H \"Content-Type: application/json\" -H \"X-Legalbot-Cloud-Replay: 1\" -H \"X-Hub-Signature-256: sha256=invalid\" --data-binary @tests/fixtures/whatsapp-cloud/valid-text.json",
        "Accept only HTTP 401 for invalid signature."
      ),
      directValidSignature: createEvidenceCommand(
        "node --experimental-strip-types -e \"import { createHmac } from 'node:crypto'; import { readFileSync } from 'node:fs'; const rawBody = readFileSync('tests/fixtures/whatsapp-cloud/valid-text.json', 'utf8'); const signature = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_CLOUD_APP_SECRET ?? '').update(rawBody).digest('hex'); fetch('http://127.0.0.1:3002/webhooks/whatsapp/cloud', { method: 'POST', headers: { 'content-type': 'application/json', 'x-legalbot-cloud-replay': '1', 'x-hub-signature-256': signature }, body: rawBody }).then(async (response) => { process.stdout.write(JSON.stringify({ statusCode: response.status, body: await response.text() })); });\"",
        "Accept only HTTP 200 with body `EVENT_REPLAYED`. Do not print the secret value."
      ),
      mountOwnership: createEvidenceCommand(
        "find data backups logs -maxdepth 0 -type d -exec stat -c '%n owner=%U:%G mode=%a' {} \\; -exec test -w {} \\; -print",
        "Accept only when `data/`, `backups/`, and `logs/` exist or are creatable and are writable by the runtime user."
      ),
      rollbackDrill: createEvidenceCommand(
        "git checkout de9d20a && npm run docker:cloud:build && docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud && OPS_POST_START_MODE=docker npm run ops:post-start:cloud && npm run docker:cloud:diagnose",
        "Accept only when rollback evidence matches the healthy criteria and signed replay is 200 while unsigned replay is 401."
      ),
      restoreDrill: createEvidenceCommand(
        "git checkout 815288e && npm run docker:cloud:build && docker compose --profile cloud up -d --force-recreate legalbot-whatsapp-cloud && OPS_POST_START_MODE=docker npm run ops:post-start:cloud && npm run docker:cloud:diagnose",
        "Accept only when restore evidence matches the healthy criteria and git status remains clean."
      )
    },
    residualRisks: [],
    finalDecision: {
      decision: "pending",
      rationale: null
    }
  };

  stdout.write(format === "markdown" ? toMarkdown(report) : `${JSON.stringify(report)}\n`);

  return {
    exitCode: 0,
    report
  };
};

if (isDirectExecution(import.meta.url)) {
  try {
    exitWithCode(runCloudOpsEvidencePackCommand());
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: "rejected", error: "cloud_ops_evidence_pack_invalid_arguments" })}\n`
    );
    process.exitCode = 1;
  }
}

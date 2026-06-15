import { spawnSync } from "node:child_process";
import {
  DEFAULT_OPENWA_STATUS_SERVER_PORT,
  DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PORT,
  loadEnv,
  type AppEnv
} from "../config/env.ts";
import { consoleLogger, type Logger } from "../logging/logger.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";
import {
  applyTransportOverride,
  parseTransportOverride,
  type RuntimeTransport
} from "./runtimeCommandCommon.ts";

type DockerDiagnoseCode =
  | "app_not_ready_auth_missing"
  | "app_ready"
  | "compose_service_missing"
  | "container_not_running"
  | "container_unhealthy"
  | "docker_compose_unavailable"
  | "docker_network_issue"
  | "host_port_mapping_issue";

type DockerDiagnoseStatus = "healthy" | "warning" | "error";

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface HttpProbeResult {
  body?: Record<string, unknown>;
  error?: string;
  ok: boolean;
  statusCode: number | null;
}

interface DockerPsEntry {
  Health?: string;
  Name?: string;
  Publishers?: Array<{
    PublishedPort?: number;
    TargetPort?: number;
    URL?: string;
  }>;
  Service?: string;
  State?: string;
  Status?: string;
}

interface DockerComposeRunner {
  run(args: string[]): CommandResult;
}

interface HttpProbeRunner {
  probe(url: string): Promise<HttpProbeResult>;
}

export interface DockerDiagnoseOptions {
  composeRunner?: DockerComposeRunner;
  envSource?: NodeJS.ProcessEnv;
  httpProbeRunner?: HttpProbeRunner;
  logger?: Logger;
  stdout?: {
    write(chunk: string): void;
  };
  transportOverride?: RuntimeTransport;
}

interface EndpointSummary {
  body?: Record<string, unknown>;
  error?: string;
  reachable: boolean;
  statusCode: number | null;
}

interface DockerComposeSummary {
  health: string | null;
  hostPortBinding: string | null;
  running: boolean;
  servicePresent: boolean;
  state: string | null;
}

export interface DockerDiagnoseReport {
  status: DockerDiagnoseStatus;
  diagnosis: {
    code: DockerDiagnoseCode;
    summary: string;
  };
  checkedAt: string;
  hostPort: string;
  compose: DockerComposeSummary;
  host: {
    health: EndpointSummary;
    ready: EndpointSummary;
    status: EndpointSummary;
  };
  inContainer: {
    health: EndpointSummary;
    ready: EndpointSummary;
    status: EndpointSummary;
  };
}

export interface DockerDiagnoseSummary extends DbCommandSummary {
  report?: DockerDiagnoseReport;
}

const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s"]+/;
const POSIX_PATH_PATTERN = /\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session)[^\s"]*/i;
const PHONE_PATTERN = /\+[1-9]\d{7,14}/;
const SENSITIVE_ERROR_PATTERN =
  /(session|qr|token|secret|browser|body|message|profile|cookie|auth)/i;

const createProcessDockerComposeRunner = (): DockerComposeRunner => ({
  run(args) {
    const result = spawnSync("docker", ["compose", ...args], {
      encoding: "utf8"
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
});

const sanitizeUnknownString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  if (
    PHONE_PATTERN.test(value) ||
    WINDOWS_PATH_PATTERN.test(value) ||
    POSIX_PATH_PATTERN.test(value) ||
    SENSITIVE_ERROR_PATTERN.test(value)
  ) {
    return "redacted_sensitive_value";
  }

  return value;
};

const sanitizeBody = (url: string, value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const body = value as Record<string, unknown>;

  if (url.endsWith("/health")) {
    const transport = body.transport;
    return {
      alive: body.alive === true,
      ...(transport && typeof transport === "object"
        ? {
            transport: {
              state:
                typeof (transport as Record<string, unknown>).state === "string"
                  ? (transport as Record<string, unknown>).state
                  : "unknown",
              ready: (transport as Record<string, unknown>).ready === true,
              clientActive: (transport as Record<string, unknown>).clientActive === true,
              listenerRegistered:
                (transport as Record<string, unknown>).listenerRegistered === true,
              livenessEnabled:
                (transport as Record<string, unknown>).livenessEnabled === true,
              livenessFailureCount:
                Number((transport as Record<string, unknown>).livenessFailureCount ?? 0),
              recoveryMode: sanitizeUnknownString(
                (transport as Record<string, unknown>).recoveryMode
              ),
              recoveryInProgress:
                (transport as Record<string, unknown>).recoveryInProgress === true
            }
          }
        : {})
    };
  }

  if (url.endsWith("/ready")) {
    return {
      ready: body.ready === true,
      state: sanitizeUnknownString(body.state) ?? "unknown"
    };
  }

  return {
    state: sanitizeUnknownString(body.state) ?? "unknown",
    ready: body.ready === true,
    clientActive: body.clientActive === true,
    listenerRegistered: body.listenerRegistered === true,
    livenessEnabled: body.livenessEnabled === true,
    livenessFailureCount: Number(body.livenessFailureCount ?? 0),
    recoveryMode: sanitizeUnknownString(body.recoveryMode),
    recoveryInProgress: body.recoveryInProgress === true,
    ...(typeof body.lastError === "string"
      ? { lastError: sanitizeUnknownString(body.lastError) ?? "redacted_sensitive_value" }
      : {})
  };
};

const createFetchHttpProbeRunner = (): HttpProbeRunner => ({
  async probe(url) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000)
      });
      let parsedBody: unknown;

      try {
        parsedBody = (await response.json()) as unknown;
      } catch {
        parsedBody = undefined;
      }

      const body = sanitizeBody(url, parsedBody);

      return {
        ok: response.ok,
        statusCode: response.status,
        ...(body ? { body } : {})
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        error: error instanceof Error ? error.message : "request_failed"
      };
    }
  }
});

const toEndpointSummary = (probe: HttpProbeResult): EndpointSummary => ({
  reachable: probe.statusCode !== null,
  statusCode: probe.statusCode,
  ...(probe.body ? { body: probe.body } : {}),
  ...(probe.error
    ? { error: sanitizeUnknownString(probe.error) ?? "redacted_sensitive_value" }
    : {})
});

const parseJsonOutput = <T>(stdout: string): T | null => {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    try {
      return JSON.parse(`[${trimmed.split(/\r?\n/).join(",")}]`) as T;
    } catch {
      return null;
    }
  }
};

const getComposePsEntry = (
  composeRunner: DockerComposeRunner,
  serviceName: string
): DockerPsEntry | null => {
  const result = composeRunner.run(["ps", "--all", "--format", "json"]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "docker_compose_ps_failed");
  }

  const parsed = parseJsonOutput<DockerPsEntry[] | DockerPsEntry>(result.stdout);

  if (!parsed) {
    return null;
  }

  if (Array.isArray(parsed)) {
    return parsed.find((entry) => entry.Service === serviceName) ?? null;
  }

  return parsed.Service === serviceName ? parsed : null;
};

const getComposeHostPortBinding = (
  composeRunner: DockerComposeRunner,
  psEntry: DockerPsEntry | null,
  serviceName: string,
  port: string
): string | null => {
  const portResult = composeRunner.run(["port", serviceName, port]);

  if (portResult.exitCode === 0) {
    return portResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null;
  }

  const publishers = Array.isArray(psEntry?.Publishers) ? psEntry.Publishers : [];
  const publisher = publishers.find(
    (candidate) => Number(candidate.TargetPort) === Number(port)
  );

  if (!publisher) {
    return null;
  }

  return `${publisher.URL ?? "127.0.0.1"}:${publisher.PublishedPort ?? port}`;
};

const getComposeState = (entry: DockerPsEntry | null): string | null => {
  if (typeof entry?.State === "string" && entry.State.trim()) {
    return entry.State.trim().toLowerCase();
  }

  if (typeof entry?.Status !== "string" || !entry.Status.trim()) {
    return null;
  }

  const status = entry.Status.trim().toLowerCase();

  if (status.startsWith("up ") || status === "up" || status.startsWith("running")) {
    return "running";
  }

  if (status.startsWith("exited") || status.startsWith("exit ")) {
    return "exited";
  }

  return status.split(/\s+/)[0] ?? null;
};

const probeEndpoints = async (
  runner: HttpProbeRunner,
  baseUrl: string
): Promise<{
  health: EndpointSummary;
  ready: EndpointSummary;
  status: EndpointSummary;
}> => {
  const [health, ready, status] = await Promise.all([
    runner.probe(`${baseUrl}/health`),
    runner.probe(`${baseUrl}/ready`),
    runner.probe(`${baseUrl}/status`)
  ]);

  const sanitizeProbe = (url: string, probe: HttpProbeResult): HttpProbeResult => ({
    ok: probe.ok,
    statusCode: probe.statusCode,
    ...(probe.error ? { error: probe.error } : {}),
    ...(probe.body ? { body: sanitizeBody(url, probe.body) ?? probe.body } : {})
  });

  return {
    health: toEndpointSummary(sanitizeProbe(`${baseUrl}/health`, health)),
    ready: toEndpointSummary(sanitizeProbe(`${baseUrl}/ready`, ready)),
    status: toEndpointSummary(sanitizeProbe(`${baseUrl}/status`, status))
  };
};

const probeContainerEndpoints = async (
  composeRunner: DockerComposeRunner,
  serviceName: string,
  port: string
): Promise<{
  health: EndpointSummary;
  ready: EndpointSummary;
  status: EndpointSummary;
}> => {
  const runProbe = (path: "/health" | "/ready" | "/status"): EndpointSummary => {
    const script = [
      "const path = process.argv[1];",
      `fetch(\`http://127.0.0.1:${port}\${path}\`)`,
      "  .then(async (response) => {",
      "    let body;",
      "    try { body = await response.json(); } catch { body = undefined; }",
      "    process.stdout.write(JSON.stringify({ statusCode: response.status, ok: response.ok, body }));",
      "  })",
      "  .catch((error) => {",
      "    process.stdout.write(JSON.stringify({ statusCode: null, ok: false, error: error.message }));",
      "  });"
    ].join("");
    const result = composeRunner.run([
      "exec",
      "-T",
      serviceName,
      "node",
      "-e",
      script,
      path
    ]);

    if (result.exitCode !== 0) {
      return {
        reachable: false,
        statusCode: null,
        error:
          sanitizeUnknownString(result.stderr.trim() || result.stdout.trim()) ??
          "container_probe_failed"
      };
    }

    const parsed = parseJsonOutput<HttpProbeResult>(result.stdout);

    if (!parsed) {
      return {
        reachable: false,
        statusCode: null,
        error: "container_probe_parse_failed"
      };
    }

    return toEndpointSummary({
      ok: parsed.ok,
      statusCode: parsed.statusCode,
      ...(parsed.error ? { error: parsed.error } : {}),
      ...(parsed.body
        ? { body: sanitizeBody(`http://127.0.0.1:${port}${path}`, parsed.body) ?? parsed.body }
        : {})
    });
  };

  return {
    health: runProbe("/health"),
    ready: runProbe("/ready"),
    status: runProbe("/status")
  };
};

const isReadyEndpointTrue = (endpoint: EndpointSummary): boolean =>
  endpoint.statusCode === 200 && endpoint.body?.ready === true;

const inferDiagnosis = ({
  expectedHostPort,
  compose,
  host,
  inContainer
}: {
  expectedHostPort: string;
  compose: DockerComposeSummary;
  host: {
    health: EndpointSummary;
    ready: EndpointSummary;
    status: EndpointSummary;
  };
  inContainer: {
    health: EndpointSummary;
    ready: EndpointSummary;
    status: EndpointSummary;
  };
}): {
  code: DockerDiagnoseCode;
  status: DockerDiagnoseStatus;
  summary: string;
} => {
  if (!compose.servicePresent) {
    return {
      code: "compose_service_missing",
      status: "error",
      summary: "The selected LegalBot Compose service is missing from the project state."
    };
  }

  if (!compose.running) {
    return {
      code: "container_not_running",
      status: "error",
      summary: "The selected LegalBot Compose service is not running."
    };
  }

  if (compose.health === "unhealthy") {
    return {
      code: "container_unhealthy",
      status: "error",
      summary: "The legalbot container is running but Docker reports it as unhealthy."
    };
  }

  if (inContainer.health.statusCode === 200 && host.health.statusCode === null) {
    if (compose.hostPortBinding !== expectedHostPort) {
      return {
        code: "host_port_mapping_issue",
        status: "error",
        summary:
          `The app is healthy inside the container, but the expected host binding for ${expectedHostPort} is missing or different.`
      };
    }

    return {
      code: "docker_network_issue",
      status: "error",
      summary:
        `The app is healthy inside the container, but host access to ${expectedHostPort} failed despite a matching published port.`
    };
  }

  if (isReadyEndpointTrue(host.ready) || isReadyEndpointTrue(inContainer.ready)) {
    return {
      code: "app_ready",
      status: "healthy",
      summary: "The selected WhatsApp runtime is ready."
    };
  }

  const inContainerHealthOk = inContainer.health.statusCode === 200;
  const inContainerReadyPending = inContainer.ready.statusCode === 503;
  const inContainerState =
    typeof inContainer.status.body?.state === "string"
      ? inContainer.status.body.state
      : typeof inContainer.ready.body?.state === "string"
        ? inContainer.ready.body.state
        : undefined;

  if (inContainerHealthOk && inContainerReadyPending && inContainerState === "starting") {
    return {
      code: "app_not_ready_auth_missing",
      status: "warning",
      summary:
        "The app is alive inside the container, but the selected transport is not ready yet."
    };
  }

  return {
    code: "container_unhealthy",
    status: "error",
    summary:
      "The container is running, but the in-container status probes did not reach a healthy ready surface."
  };
};

const getDockerRuntimeConfig = (
  env: AppEnv
): {
  port: string;
  serviceName: string;
} =>
  env.WHATSAPP_TRANSPORT === "cloud"
    ? {
        port: DEFAULT_WHATSAPP_CLOUD_WEBHOOK_PORT,
        serviceName: "legalbot-whatsapp-cloud"
      }
    : {
        port: DEFAULT_OPENWA_STATUS_SERVER_PORT,
        serviceName: "legalbot"
      };

export const runDockerDiagnoseCommand = async (
  options: DockerDiagnoseOptions = {}
): Promise<DockerDiagnoseSummary> => {
  const logger = options.logger ?? consoleLogger;
  const stdout = options.stdout ?? process.stdout;
  const effectiveEnvSource = applyTransportOverride(
    options.envSource ?? process.env,
    options.transportOverride
  );
  const env = loadEnv(effectiveEnvSource);
  const runtime = getDockerRuntimeConfig(env);
  const composeRunner = options.composeRunner ?? createProcessDockerComposeRunner();
  const httpProbeRunner = options.httpProbeRunner ?? createFetchHttpProbeRunner();

  try {
    logger.info("docker_diagnose_starting", {});

    const psEntry = getComposePsEntry(composeRunner, runtime.serviceName);
    const hostPortBinding = getComposeHostPortBinding(
      composeRunner,
      psEntry,
      runtime.serviceName,
      runtime.port
    );
    const hostPort = `127.0.0.1:${runtime.port}`;
    const host = await probeEndpoints(httpProbeRunner, `http://${hostPort}`);
    const composeState = getComposeState(psEntry);
    const composeSummary: DockerComposeSummary = {
      servicePresent: psEntry !== null,
      running: composeState === "running",
      state: composeState,
      health:
        typeof psEntry?.Health === "string" ? psEntry.Health.trim().toLowerCase() : null,
      hostPortBinding
    };
    const inContainer =
      composeSummary.servicePresent && composeSummary.running
        ? await probeContainerEndpoints(composeRunner, runtime.serviceName, runtime.port)
        : {
            health: {
              reachable: false,
              statusCode: null,
              error: "container_not_running"
            },
            ready: {
              reachable: false,
              statusCode: null,
              error: "container_not_running"
            },
            status: {
              reachable: false,
              statusCode: null,
              error: "container_not_running"
            }
          };

    const diagnosis = inferDiagnosis({
      expectedHostPort: hostPort,
      compose: composeSummary,
      host,
      inContainer
    });
    const report: DockerDiagnoseReport = {
      status: diagnosis.status,
      diagnosis: {
        code: diagnosis.code,
        summary: diagnosis.summary
      },
      checkedAt: new Date().toISOString(),
      hostPort,
      compose: composeSummary,
      host,
      inContainer
    };

    stdout.write(`${JSON.stringify(report)}\n`);
    logger.info("docker_diagnose_complete", {
      status: report.status,
      diagnosis: report.diagnosis,
      compose: report.compose
    });

    return {
      exitCode: report.status === "healthy" ? 0 : 1,
      report
    };
  } catch (error) {
    const report: DockerDiagnoseReport = {
      status: "error",
      diagnosis: {
        code: "docker_compose_unavailable",
        summary:
          error instanceof Error
            ? sanitizeUnknownString(error.message) ?? "Docker Compose diagnostics could not run."
            : "Docker Compose diagnostics could not run."
      },
      checkedAt: new Date().toISOString(),
      hostPort: `127.0.0.1:${runtime.port}`,
      compose: {
        servicePresent: false,
        running: false,
        state: null,
        health: null,
        hostPortBinding: null
      },
      host: {
        health: {
          reachable: false,
          statusCode: null
        },
        ready: {
          reachable: false,
          statusCode: null
        },
        status: {
          reachable: false,
          statusCode: null
        }
      },
      inContainer: {
        health: {
          reachable: false,
          statusCode: null
        },
        ready: {
          reachable: false,
          statusCode: null
        },
        status: {
          reachable: false,
          statusCode: null
        }
      }
    };

    stdout.write(`${JSON.stringify(report)}\n`);
    logger.error("docker_diagnose_failed", {
      error: report.diagnosis.summary
    });

    return {
      exitCode: 1,
      report
    };
  }
};

if (isDirectExecution(import.meta.url)) {
  const transportOverride = parseTransportOverride();

  exitWithCode(
    await runDockerDiagnoseCommand(
      transportOverride
        ? {
            transportOverride
          }
        : {}
    )
  );
}

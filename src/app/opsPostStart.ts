import {
  DEFAULT_OPENWA_STATUS_SERVER_PORT,
  loadSmokeRuntimeEnv,
  type SmokeRuntimeEnv
} from "../config/env.ts";
import {
  runDockerDiagnoseCommand,
  type DockerDiagnoseReport,
  type DockerDiagnoseSummary
} from "./dockerDiagnose.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";
import { silentLogger, toJsonStdout } from "./opsCommandCommon.ts";

type OpsPostStartCode =
  | "app_not_ready_auth_missing"
  | "app_ready"
  | "container_not_running"
  | "container_unhealthy"
  | "host_port_mapping_issue";

type OpsPostStartStatus = "healthy" | "warning" | "error";
type OpsPostStartMode = "direct" | "docker";

interface HttpProbeResult {
  body?: Record<string, unknown>;
  error?: string;
  ok: boolean;
  statusCode: number | null;
}

interface EndpointSummary {
  body?: Record<string, unknown>;
  error?: string;
  reachable: boolean;
  statusCode: number | null;
}

interface HttpProbeRunner {
  probe(url: string): Promise<HttpProbeResult>;
}

export interface OpsPostStartReport {
  status: OpsPostStartStatus;
  mode: OpsPostStartMode;
  checkedAt: string;
  diagnosis: {
    code: OpsPostStartCode;
    summary: string;
  };
  statusServerEnabled: boolean;
  hostBaseUrl: string;
  host: {
    health: EndpointSummary;
    ready: EndpointSummary;
    status: EndpointSummary;
  };
  docker: {
    reusedDockerDiagnose: boolean;
    compose:
      | Pick<DockerDiagnoseReport["compose"], "servicePresent" | "running" | "state" | "health">
      | null;
  };
}

export interface OpsPostStartCommandOptions {
  dockerDiagnoseRunner?: (options?: {
    envSource?: NodeJS.ProcessEnv;
    logger?: typeof silentLogger;
    stdout?: {
      write(chunk: string): void;
    };
  }) => Promise<DockerDiagnoseSummary>;
  envSource?: NodeJS.ProcessEnv;
  httpProbeRunner?: HttpProbeRunner;
  stdout?: {
    write(chunk: string): void;
  };
}

export interface OpsPostStartSummary extends DbCommandSummary {
  report: OpsPostStartReport;
}

const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s"]+/;
const POSIX_PATH_PATTERN = /\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session)[^\s"]*/i;
const PHONE_PATTERN = /\+[1-9]\d{7,14}/;
const SENSITIVE_ERROR_PATTERN =
  /(session|qr|token|secret|browser|body|message|profile|cookie|auth)/i;

const sanitizeUnknownString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  if (
    WINDOWS_PATH_PATTERN.test(value) ||
    POSIX_PATH_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
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
              livenessFailureCount: Number(
                (transport as Record<string, unknown>).livenessFailureCount ?? 0
              ),
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
      const sanitizedError = sanitizeUnknownString(
        error instanceof Error ? error.message : "request_failed"
      );

      return {
        ok: false,
        statusCode: null,
        ...(sanitizedError ? { error: sanitizedError } : {})
      };
    }
  }
});

const toEndpointSummary = (probe: HttpProbeResult, url: string): EndpointSummary => ({
  reachable: probe.statusCode !== null,
  statusCode: probe.statusCode,
  ...(probe.body ? { body: sanitizeBody(url, probe.body) ?? probe.body } : {}),
  ...(probe.error
    ? {
        error: sanitizeUnknownString(probe.error) ?? "redacted_sensitive_value"
      }
    : {})
});

const getLoopbackBaseUrl = (env: SmokeRuntimeEnv): string =>
  `http://127.0.0.1:${env.OPENWA_STATUS_SERVER_PORT ?? Number(DEFAULT_OPENWA_STATUS_SERVER_PORT)}`;

const isReady = (endpoint: EndpointSummary): boolean =>
  endpoint.statusCode === 200 && endpoint.body?.ready === true;

const detectDirectDiagnosis = ({
  health,
  ready,
  status
}: {
  health: EndpointSummary;
  ready: EndpointSummary;
  status: EndpointSummary;
}): {
  code: OpsPostStartCode;
  status: OpsPostStartStatus;
  summary: string;
} => {
  if (isReady(ready)) {
    return {
      code: "app_ready",
      status: "healthy",
      summary: "The app is ready and the WhatsApp runtime is authenticated."
    };
  }

  const state =
    typeof status.body?.state === "string"
      ? status.body.state
      : typeof ready.body?.state === "string"
        ? ready.body.state
        : typeof health.body?.transport === "object" &&
            typeof (health.body.transport as Record<string, unknown>).state === "string"
          ? ((health.body.transport as Record<string, unknown>).state as string)
          : "unknown";

  if (health.statusCode === 200 && ready.statusCode === 503 && state === "starting") {
    return {
      code: "app_not_ready_auth_missing",
      status: "warning",
      summary:
        "The app is alive, but WhatsApp authentication or QR pairing is still pending."
    };
  }

  return {
    code: "host_port_mapping_issue",
    status: "error",
    summary:
      "The local status surface is not reachable or did not expose the expected ready state."
  };
};

const mapDockerDiagnoseReport = (report: DockerDiagnoseReport): OpsPostStartReport => ({
  status: report.status === "healthy" ? "healthy" : report.status === "warning" ? "warning" : "error",
  mode: "docker",
  checkedAt: report.checkedAt,
  diagnosis: {
    code:
      report.diagnosis.code === "docker_network_issue"
        ? "host_port_mapping_issue"
        : report.diagnosis.code === "docker_compose_unavailable"
          ? "container_not_running"
          : report.diagnosis.code,
    summary: report.diagnosis.summary
  },
  statusServerEnabled: true,
  hostBaseUrl: `http://${report.hostPort}`,
  host: report.host,
  docker: {
    reusedDockerDiagnose: true,
    compose: {
      servicePresent: report.compose.servicePresent,
      running: report.compose.running,
      state: report.compose.state,
      health: report.compose.health
    }
  }
});

export const runOpsPostStartCommand = async ({
  dockerDiagnoseRunner = runDockerDiagnoseCommand,
  envSource = process.env,
  httpProbeRunner = createFetchHttpProbeRunner(),
  stdout = process.stdout
}: OpsPostStartCommandOptions = {}): Promise<OpsPostStartSummary> => {
  const env = loadSmokeRuntimeEnv(envSource);
  const requestedMode =
    envSource.OPS_POST_START_MODE === "docker" || envSource.OPS_POST_START_MODE === "direct"
      ? envSource.OPS_POST_START_MODE
      : env.OPENWA_STATUS_SERVER_HOST === "0.0.0.0"
        ? "docker"
        : "direct";

  if (requestedMode === "docker") {
    const dockerSummary = await dockerDiagnoseRunner({
      envSource,
      logger: silentLogger,
      stdout: {
        write() {}
      }
    });
  const report = mapDockerDiagnoseReport(dockerSummary.report as DockerDiagnoseReport);
    toJsonStdout(report, stdout);

    return {
      exitCode: report.diagnosis.code === "app_ready" ? 0 : 1,
      report
    };
  }

  const hostBaseUrl = getLoopbackBaseUrl(env);
  const [healthProbe, readyProbe, statusProbe] = await Promise.all([
    httpProbeRunner.probe(`${hostBaseUrl}/health`),
    httpProbeRunner.probe(`${hostBaseUrl}/ready`),
    httpProbeRunner.probe(`${hostBaseUrl}/status`)
  ]);
  const host = {
    health: toEndpointSummary(healthProbe, `${hostBaseUrl}/health`),
    ready: toEndpointSummary(readyProbe, `${hostBaseUrl}/ready`),
    status: toEndpointSummary(statusProbe, `${hostBaseUrl}/status`)
  };
  const diagnosis = detectDirectDiagnosis(host);
  const report: OpsPostStartReport = {
    status: diagnosis.status,
    mode: "direct",
    checkedAt: new Date().toISOString(),
    diagnosis: {
      code: diagnosis.code,
      summary: diagnosis.summary
    },
    statusServerEnabled: env.OPENWA_STATUS_SERVER_ENABLED,
    hostBaseUrl,
    host,
    docker: {
      reusedDockerDiagnose: false,
      compose: null
    }
  };

  toJsonStdout(report, stdout);

  return {
    exitCode: report.diagnosis.code === "app_ready" ? 0 : 1,
    report
  };
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(await runOpsPostStartCommand());
}

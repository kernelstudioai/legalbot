import { ZodError } from "zod";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  isProductionNodeEnv,
  loadEnv,
  loadSmokeRuntimeEnv,
  loadWhatsAppCloudRuntimeEnv,
  type AppEnv
} from "../config/env.ts";
import { getSqliteMigrationStatus } from "../persistence/sqlite/index.ts";
import { runBusinessCheckCommand, type BusinessCheckReport } from "./businessCheck.ts";
import { runCaseDoctorCommand, type CaseDoctorReport } from "./caseDoctor.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";
import {
  createBufferedStdout,
  hasGitIgnoreDirectoryEntry,
  parseNodeMajorVersion,
  silentLogger,
  toJsonStdout
} from "./opsCommandCommon.ts";
import {
  applyTransportOverride,
  parseTransportOverride,
  type RuntimeTransport
} from "./runtimeCommandCommon.ts";

type PreflightStatus = "ready" | "blocking_failure";

interface OpsPreflightDirectoryCheck {
  ignored: boolean;
  path: string;
  exists: boolean;
  creatable: boolean;
  writable: boolean;
}

interface OpsPreflightReport {
  status: PreflightStatus;
  checkedAt: string;
  node: {
    currentVersion: string;
    majorVersion: number | null;
    requiredMajorVersion: 22;
    ok: boolean;
  };
  runtimeEnv: {
    transport: RuntimeTransport;
    minimalRequiredEnv: string[];
    lawyerPhoneConfigured: boolean;
    databaseUrlConfigured: boolean;
    databaseMigrationsExplicit: boolean;
    databaseMigrationsEnabled: boolean;
    businessPersistenceEnabled: boolean;
    statusServerEnabled: boolean;
    cloudApiVersionConfigured: boolean;
    cloudPhoneNumberIdConfigured: boolean;
    cloudVerifyTokenConfigured: boolean;
    cloudAccessTokenConfigured: boolean;
    cloudAppSecretConfigured: boolean;
    cloudSignatureVerificationEnforced: boolean;
    webhookHostConfigured: boolean;
    webhookPort: number | null;
  };
  migrations: {
    appliedMigrationCount: number;
    pendingMigrationCount: number;
  };
  businessCheck: {
    healthy: boolean;
    report: Pick<
      BusinessCheckReport,
      | "status"
      | "migrationCount"
      | "pendingMigrationCount"
      | "completedIntakeCount"
      | "draftCaseCount"
      | "duplicateDraftSubjectCount"
      | "consistencyErrors"
    > | null;
  };
  caseDoctor: {
    healthy: boolean;
    report: Pick<
      CaseDoctorReport,
      "status" | "migration_status" | "case_consistency" | "remediation"
    > | null;
  };
  docker: {
    required: boolean;
    dockerAvailable: boolean;
    composeAvailable: boolean;
    cloudServiceConfigured: boolean;
  };
  runtimeDirectories: {
    runtimeUid: number | null;
    runtimeGid: number | null;
    requiredDirectories: OpsPreflightDirectoryCheck[];
    ok: boolean;
  };
  repoHygiene: {
    requiredIgnoredDirectories: OpsPreflightDirectoryCheck[];
    ok: boolean;
  };
  blockers: string[];
}

export interface OpsPreflightCommandOptions {
  cwd?: string;
  dockerRunner?: {
    run(args: string[]): {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  };
  envSource?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  repoRoot?: string;
  stdout?: {
    write(chunk: string): void;
  };
  transportOverride?: RuntimeTransport;
}

export interface OpsPreflightSummary extends DbCommandSummary {
  report: OpsPreflightReport;
}

const REQUIRED_IGNORED_DIRECTORIES = [
  "data",
  "backups",
  "openwa-session",
  "tmp",
  "logs"
] as const;

const OPENWA_REQUIRED_ENV = ["LAWYER_PHONE_E164"];
const CLOUD_REQUIRED_ENV = [
  "WHATSAPP_TRANSPORT",
  "WHATSAPP_CLOUD_API_VERSION",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "WHATSAPP_CLOUD_ACCESS_TOKEN"
];

const WRITABLE_RUNTIME_DIRECTORIES = ["data", "backups", "logs"] as const;

const createProcessDockerRunner = () => ({
  run(args: string[]) {
    const result = spawnSync("docker", args, {
      encoding: "utf8"
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
});

const toZodMessage = (error: ZodError): string =>
  error.issues.map((issue) => issue.message).join("; ");

const toBusinessCheckReport = (
  report: BusinessCheckReport | undefined
): OpsPreflightReport["businessCheck"]["report"] =>
  report
    ? {
        status: report.status,
        migrationCount: report.migrationCount,
        pendingMigrationCount: report.pendingMigrationCount,
        completedIntakeCount: report.completedIntakeCount,
        draftCaseCount: report.draftCaseCount,
        duplicateDraftSubjectCount: report.duplicateDraftSubjectCount,
        consistencyErrors: report.consistencyErrors
      }
    : null;

const toCaseDoctorReport = (
  report: CaseDoctorReport | undefined
): OpsPreflightReport["caseDoctor"]["report"] =>
  report
    ? {
        status: report.status,
        migration_status: report.migration_status,
        case_consistency: report.case_consistency,
        remediation: report.remediation
      }
    : null;

const hasConfiguredValue = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const sanitizeProcessError = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "command_unavailable";
  }

  return trimmed
    .replace(/[A-Za-z]:\\[^\s"]+/g, "redacted_path")
    .replace(/\/(?:Users|home|tmp|var|opt|etc|appdata|openwa-session)[^\s"]*/gi, "redacted_path")
    .replace(/\+[1-9]\d{7,14}/g, "redacted_phone")
    .replace(/(token|secret|body|session|cookie|browser|profile|auth)/gi, "redacted_sensitive");
};

const isWritablePath = (targetPath: string): boolean => {
  try {
    accessSync(targetPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const getDirectoryCheck = ({
  repoRoot,
  directory
}: {
  repoRoot: string;
  directory: string;
}): OpsPreflightDirectoryCheck => {
  const absolutePath = path.join(repoRoot, directory);
  const exists = existsSync(absolutePath);
  const creatable = exists
    ? true
    : isWritablePath(path.dirname(absolutePath));
  const writable = exists ? isWritablePath(absolutePath) : creatable;

  return {
    path: `${directory}/`,
    ignored: hasGitIgnoreDirectoryEntry({
      cwd: repoRoot,
      directory
    }),
    exists,
    creatable,
    writable
  };
};

const getRuntimeIdentity = (): {
  runtimeUid: number | null;
  runtimeGid: number | null;
} => ({
  runtimeUid: typeof process.getuid === "function" ? process.getuid() : null,
  runtimeGid: typeof process.getgid === "function" ? process.getgid() : null
});

const hasCloudComposeService = (repoRoot: string): boolean => {
  const composePath = path.join(repoRoot, "compose.yaml");

  try {
    const compose = readFileSync(composePath, "utf8");
    return compose.includes("  legalbot-whatsapp-cloud:");
  } catch {
    return false;
  }
};

const inferTransport = (
  envSource: NodeJS.ProcessEnv,
  transportOverride?: RuntimeTransport
): RuntimeTransport => {
  if (transportOverride) {
    return transportOverride;
  }

  return envSource.WHATSAPP_TRANSPORT === "cloud" ? "cloud" : "openwa";
};

const loadBaseEnv = (
  envSource: NodeJS.ProcessEnv,
  blockers: string[]
): AppEnv | undefined => {
  try {
    return loadEnv(envSource);
  } catch (error) {
    if (error instanceof ZodError) {
      blockers.push(`runtime_env_invalid:${toZodMessage(error)}`);
    } else {
      blockers.push("runtime_env_invalid");
    }

    return undefined;
  }
};

export const runOpsPreflightCommand = ({
  cwd = process.cwd(),
  dockerRunner = createProcessDockerRunner(),
  envSource = process.env,
  nodeVersion = process.version,
  repoRoot = cwd,
  stdout = process.stdout,
  transportOverride
}: OpsPreflightCommandOptions = {}): OpsPreflightSummary => {
  const blockers: string[] = [];
  const nodeMajorVersion = parseNodeMajorVersion(nodeVersion);
  const nodeOk = nodeMajorVersion === 22;
  const effectiveEnvSource = applyTransportOverride(envSource, transportOverride);
  const transport = inferTransport(effectiveEnvSource, transportOverride);

  if (!nodeOk) {
    blockers.push("node_22_required");
  }

  const baseEnv = loadBaseEnv(effectiveEnvSource, blockers);
  const databaseUrlConfigured = typeof baseEnv?.DATABASE_URL === "string";
  const databaseMigrationsExplicit =
    effectiveEnvSource.DATABASE_MIGRATIONS_ENABLED !== undefined;
  const databaseMigrationsEnabled = baseEnv?.DATABASE_MIGRATIONS_ENABLED ?? false;
  const businessPersistenceEnabled = baseEnv?.BUSINESS_PERSISTENCE_ENABLED === true;

  if (!databaseUrlConfigured) {
    blockers.push("database_url_missing");
  }

  if (!databaseMigrationsExplicit) {
    blockers.push("database_migrations_policy_not_explicit");
  }

  if (!businessPersistenceEnabled) {
    blockers.push("business_persistence_disabled");
  }

  let lawyerPhoneConfigured = false;
  let statusServerEnabled = false;
  let cloudApiVersionConfigured = false;
  let cloudPhoneNumberIdConfigured = false;
  let cloudVerifyTokenConfigured = false;
  let cloudAccessTokenConfigured = false;
  let cloudAppSecretConfigured = false;
  let cloudSignatureVerificationEnforced = false;
  let webhookHostConfigured = false;
  let webhookPort: number | null = null;
  let dockerAvailable = false;
  let composeAvailable = false;
  let cloudServiceConfigured = false;

  if (transport === "openwa") {
    try {
      const runtimeEnv = loadSmokeRuntimeEnv(effectiveEnvSource);
      lawyerPhoneConfigured = runtimeEnv.LAWYER_PHONE_E164.length > 0;
      statusServerEnabled = runtimeEnv.OPENWA_STATUS_SERVER_ENABLED;
    } catch (error) {
      if (error instanceof ZodError) {
        blockers.push(`runtime_env_invalid:${toZodMessage(error)}`);
      } else {
        blockers.push("runtime_env_invalid");
      }
    }

    if (!lawyerPhoneConfigured) {
      blockers.push("lawyer_phone_missing");
    }
  } else {
    cloudApiVersionConfigured = hasConfiguredValue(
      effectiveEnvSource.WHATSAPP_CLOUD_API_VERSION
    );
    cloudPhoneNumberIdConfigured = hasConfiguredValue(
      effectiveEnvSource.WHATSAPP_CLOUD_PHONE_NUMBER_ID
    );
    cloudVerifyTokenConfigured = hasConfiguredValue(
      effectiveEnvSource.WHATSAPP_CLOUD_VERIFY_TOKEN
    );
    cloudAccessTokenConfigured = hasConfiguredValue(
      effectiveEnvSource.WHATSAPP_CLOUD_ACCESS_TOKEN
    );
    cloudAppSecretConfigured = hasConfiguredValue(
      effectiveEnvSource.WHATSAPP_CLOUD_APP_SECRET
    );
    cloudSignatureVerificationEnforced = isProductionNodeEnv(effectiveEnvSource);

    if (effectiveEnvSource.WHATSAPP_TRANSPORT !== "cloud") {
      blockers.push("cloud_transport_not_selected");
    }
    if (!cloudApiVersionConfigured) {
      blockers.push("cloud_api_version_missing");
    }
    if (!cloudPhoneNumberIdConfigured) {
      blockers.push("cloud_phone_number_id_missing");
    }
    if (!cloudVerifyTokenConfigured) {
      blockers.push("cloud_verify_token_missing");
    }
    if (!cloudAccessTokenConfigured) {
      blockers.push("cloud_access_token_missing");
    }
    if (cloudSignatureVerificationEnforced && !cloudAppSecretConfigured) {
      blockers.push("cloud_app_secret_required_in_production");
    }

    try {
      const runtimeEnv = loadWhatsAppCloudRuntimeEnv(effectiveEnvSource);
      webhookHostConfigured = runtimeEnv.WHATSAPP_CLOUD_WEBHOOK_HOST.trim().length > 0;
      webhookPort = runtimeEnv.WHATSAPP_CLOUD_WEBHOOK_PORT;
    } catch (error) {
      if (error instanceof ZodError) {
        blockers.push(`runtime_env_invalid:${toZodMessage(error)}`);
      } else {
        blockers.push("runtime_env_invalid");
      }
    }

    const dockerVersion = dockerRunner.run(["--version"]);
    dockerAvailable = dockerVersion.exitCode === 0;
    if (!dockerAvailable) {
      blockers.push(
        `docker_unavailable:${sanitizeProcessError(dockerVersion.stderr || dockerVersion.stdout)}`
      );
    }

    if (dockerAvailable) {
      const composeVersion = dockerRunner.run(["compose", "version"]);
      composeAvailable = composeVersion.exitCode === 0;
      if (!composeAvailable) {
        blockers.push(
          `docker_compose_unavailable:${sanitizeProcessError(
            composeVersion.stderr || composeVersion.stdout
          )}`
        );
      }
    }

    cloudServiceConfigured = hasCloudComposeService(repoRoot);
    if (!cloudServiceConfigured) {
      blockers.push("compose_service_missing");
    }
  }

  const migrationStatus =
    baseEnv && databaseUrlConfigured
      ? getSqliteMigrationStatus({
          cwd,
          databaseUrl: baseEnv.DATABASE_URL
        })
      : {
          appliedMigrationIds: [],
          pendingMigrationIds: []
        };

  if (migrationStatus.pendingMigrationIds.length > 0) {
    blockers.push("pending_migrations");
  }

  const businessStdout = createBufferedStdout();
  const businessSummary =
    baseEnv && businessPersistenceEnabled
      ? runBusinessCheckCommand({
          cwd,
          envSource: effectiveEnvSource,
          logger: silentLogger,
          stdout: businessStdout.stdout
        })
      : {
          exitCode: 1,
          report: undefined
        };

  if (businessSummary.exitCode !== 0) {
    blockers.push("business_check_failed");
  }

  const caseDoctorStdout = createBufferedStdout();
  const caseDoctorSummary =
    baseEnv && businessPersistenceEnabled
      ? runCaseDoctorCommand({
          cwd,
          envSource: effectiveEnvSource,
          logger: silentLogger,
          stdout: caseDoctorStdout.stdout
        })
      : {
          exitCode: 1,
          report: undefined
        };

  if (caseDoctorSummary.exitCode !== 0) {
    blockers.push("case_doctor_failed");
  }

  const requiredIgnoredDirectories = REQUIRED_IGNORED_DIRECTORIES.map((directory) =>
    getDirectoryCheck({
      repoRoot,
      directory
    })
  );
  const writableRuntimeDirectories = WRITABLE_RUNTIME_DIRECTORIES.map((directory) =>
    getDirectoryCheck({
      repoRoot,
      directory
    })
  );
  const runtimeIdentity = getRuntimeIdentity();

  if (requiredIgnoredDirectories.some((entry) => !entry.ignored)) {
    blockers.push("required_runtime_directories_not_gitignored");
  }
  if (writableRuntimeDirectories.some((entry) => !entry.creatable)) {
    blockers.push("required_runtime_directories_not_creatable");
  }
  if (writableRuntimeDirectories.some((entry) => !entry.writable)) {
    blockers.push("required_runtime_directories_not_writable");
  }

  const report: OpsPreflightReport = {
    status: blockers.length === 0 ? "ready" : "blocking_failure",
    checkedAt: new Date().toISOString(),
    node: {
      currentVersion: nodeVersion,
      majorVersion: nodeMajorVersion,
      requiredMajorVersion: 22,
      ok: nodeOk
    },
    runtimeEnv: {
      transport,
      minimalRequiredEnv: transport === "cloud" ? [...CLOUD_REQUIRED_ENV] : [...OPENWA_REQUIRED_ENV],
      lawyerPhoneConfigured,
      databaseUrlConfigured,
      databaseMigrationsExplicit,
      databaseMigrationsEnabled,
      businessPersistenceEnabled,
      statusServerEnabled,
      cloudApiVersionConfigured,
      cloudPhoneNumberIdConfigured,
      cloudVerifyTokenConfigured,
      cloudAccessTokenConfigured,
      cloudAppSecretConfigured,
      cloudSignatureVerificationEnforced,
      webhookHostConfigured,
      webhookPort
    },
    migrations: {
      appliedMigrationCount: migrationStatus.appliedMigrationIds.length,
      pendingMigrationCount: migrationStatus.pendingMigrationIds.length
    },
    businessCheck: {
      healthy: businessSummary.exitCode === 0,
      report: toBusinessCheckReport(businessSummary.report)
    },
    caseDoctor: {
      healthy: caseDoctorSummary.exitCode === 0,
      report: toCaseDoctorReport(caseDoctorSummary.report)
    },
    docker: {
      required: transport === "cloud",
      dockerAvailable,
      composeAvailable,
      cloudServiceConfigured
    },
    runtimeDirectories: {
      ...runtimeIdentity,
      requiredDirectories: writableRuntimeDirectories,
      ok: writableRuntimeDirectories.every((entry) => entry.creatable && entry.writable)
    },
    repoHygiene: {
      requiredIgnoredDirectories,
      ok: requiredIgnoredDirectories.every((entry) => entry.ignored)
    },
    blockers
  };

  toJsonStdout(report, stdout);

  return {
    exitCode: report.status === "ready" ? 0 : 1,
    report
  };
};

if (isDirectExecution(import.meta.url)) {
  const transportOverride = parseTransportOverride();

  exitWithCode(
    runOpsPreflightCommand(
      transportOverride
        ? {
            transportOverride
          }
        : {}
    )
  );
}

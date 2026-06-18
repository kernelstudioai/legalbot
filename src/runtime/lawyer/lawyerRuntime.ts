import { RuntimeDecision } from "../../contracts/index.ts";
import type { CanonicalEnvelopeType, RuntimeDecisionType } from "../../contracts/index.ts";
import {
  isOperatorSubjectId,
  toOperatorSubjectId,
  type BusinessReadyIntakeCandidate,
  type IntakeFieldName
} from "../../persistence/index.ts";
import type { RuntimeContext } from "../shared/runtimeContext.ts";

export const lawyerRuntimeContext: RuntimeContext = {
  runtime: "lawyer"
};

export type LawyerCommandKind =
  | "help"
  | "status"
  | "ping"
  | "intake-ready"
  | "unknown";

export interface LawyerRuntimeStatus {
  runtime: {
    ready: boolean;
    state: string;
  };
  migrations?: {
    appliedMigrationCount: number;
    pendingMigrationCount: number;
  };
  persistence: {
    enabled: boolean;
  };
}

export interface LawyerReadyIntakeSummary {
  subjectId: string;
  intakeState: "intake_complete";
  updatedAt: string;
  fieldNamesPresent: IntakeFieldName[];
}

export interface LawyerRuntimeOptions {
  getStatus?: () => LawyerRuntimeStatus | Promise<LawyerRuntimeStatus>;
  listReadyIntakes?: () =>
    | BusinessReadyIntakeCandidate[]
    | LawyerReadyIntakeSummary[]
    | Promise<BusinessReadyIntakeCandidate[] | LawyerReadyIntakeSummary[]>;
}

export interface RunLawyerRuntimeInput extends LawyerRuntimeOptions {
  envelope: CanonicalEnvelopeType;
}

const implementedCommands = [
  "help / aiuto",
  "status / stato",
  "ping",
  "intake-ready / intake pronti / intake completati"
] as const;

const normalizeCommandText = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const classifyLawyerCommand = (value: string): LawyerCommandKind => {
  const normalized = normalizeCommandText(value);

  if (normalized === "help" || normalized === "aiuto") {
    return "help";
  }

  if (normalized === "status" || normalized === "stato") {
    return "status";
  }

  if (normalized === "ping") {
    return "ping";
  }

  if (
    normalized === "intake-ready" ||
    normalized === "intake ready" ||
    normalized === "intake pronti" ||
    normalized === "intake completati"
  ) {
    return "intake-ready";
  }

  return "unknown";
};

const buildHelpMessage = (): string =>
  `Comandi operatore disponibili:\n${implementedCommands
    .map((command) => `- ${command}`)
    .join("\n")}`;

const defaultStatus = (): LawyerRuntimeStatus => ({
  runtime: {
    ready: true,
    state: "ready"
  },
  persistence: {
    enabled: false
  }
});

const formatStatusMessage = (status: LawyerRuntimeStatus): string => {
  const lines = [
    "Stato operativo:",
    `- runtime_state: ${status.runtime.state}`,
    `- runtime_ready: ${status.runtime.ready}`,
    `- persistence_enabled: ${status.persistence.enabled}`
  ];

  if (status.migrations) {
    lines.push(
      `- migrations_applied: ${status.migrations.appliedMigrationCount}`,
      `- migrations_pending: ${status.migrations.pendingMigrationCount}`
    );
  } else {
    lines.push("- migrations: unavailable");
  }

  return lines.join("\n");
};

const toSafeReadyIntakeSummary = (
  candidate: BusinessReadyIntakeCandidate | LawyerReadyIntakeSummary
): LawyerReadyIntakeSummary => ({
  subjectId: isOperatorSubjectId(candidate.subjectId)
    ? candidate.subjectId
    : toOperatorSubjectId(candidate.subjectId),
  intakeState: candidate.intakeState,
  updatedAt: candidate.updatedAt,
  fieldNamesPresent: candidate.fieldNamesPresent
});

const formatReadyIntakesMessage = (candidates: LawyerReadyIntakeSummary[]): string => {
  if (candidates.length === 0) {
    return "Nessun intake completato pronto.";
  }

  return [
    "Intake completati pronti:",
    ...candidates.map(
      (candidate) =>
        `- subjectId=${candidate.subjectId} intakeState=${candidate.intakeState} updatedAt=${candidate.updatedAt} fieldNamesPresent=${candidate.fieldNamesPresent.join(",")}`
    )
  ].join("\n");
};

const toRuntimeDecision = (
  action: RuntimeDecisionType["action"],
  rationale: string,
  messageOverride: string
): RuntimeDecisionType =>
  RuntimeDecision.parse({
    actor: "lawyer",
    action,
    rationale,
    messageOverride
  });

export const runLawyerRuntime = async ({
  envelope,
  getStatus,
  listReadyIntakes
}: RunLawyerRuntimeInput): Promise<RuntimeDecisionType> => {
  const command = classifyLawyerCommand(envelope.body);

  if (command === "help") {
    return toRuntimeDecision(
      "lawyer_help",
      "Operator requested implemented command help",
      buildHelpMessage()
    );
  }

  if (command === "status") {
    const status = getStatus ? await getStatus() : defaultStatus();

    return toRuntimeDecision(
      "lawyer_status",
      "Operator requested sanitized runtime status",
      formatStatusMessage(status)
    );
  }

  if (command === "ping") {
    return toRuntimeDecision(
      "lawyer_ping",
      "Operator requested a Cloud runtime liveness ping",
      "pong: runtime ready"
    );
  }

  if (command === "intake-ready") {
    if (!listReadyIntakes) {
      return toRuntimeDecision(
        "lawyer_intake_ready",
        "Operator requested ready intake list but no safe listing boundary is available",
        "Elenco intake completati non disponibile in questa runtime."
      );
    }

    const candidates = (await listReadyIntakes()).map(toSafeReadyIntakeSummary);

    return toRuntimeDecision(
      "lawyer_intake_ready",
      "Operator requested safe completed intake summaries",
      formatReadyIntakesMessage(candidates)
    );
  }

  return toRuntimeDecision(
    "lawyer_unknown_command",
    "Operator sent an unsupported command",
    `Comando operatore non riconosciuto.\n\n${buildHelpMessage()}`
  );
};

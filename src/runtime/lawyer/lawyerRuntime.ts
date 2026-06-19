import { RuntimeDecision } from "../../contracts/index.ts";
import type { CanonicalEnvelopeType, RuntimeDecisionType } from "../../contracts/index.ts";
import {
  isOperatorSubjectId,
  toOperatorSubjectId,
  type BusinessReadyIntakeCandidate,
  type IntakeFieldName,
  type PracticeListFilter,
  type PracticeRecord
} from "../../persistence/index.ts";
import type { RuntimeContext } from "../shared/runtimeContext.ts";

export const lawyerRuntimeContext: RuntimeContext = {
  runtime: "lawyer"
};

export type LawyerCommandKind =
  | "help"
  | "status"
  | "practice-list"
  | "practice-list-today"
  | "practice-list-last-7-days"
  | "practice-detail"
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
  listPractices?: (filter?: PracticeListFilter) => PracticeRecord[] | Promise<PracticeRecord[]>;
  getPracticeByCode?: (practiceCode: string) => PracticeRecord | null | Promise<PracticeRecord | null>;
  now?: () => Date;
}

export interface RunLawyerRuntimeInput extends LawyerRuntimeOptions {
  envelope: CanonicalEnvelopeType;
}

const implementedCommands = [
  "help / aiuto",
  "status / stato",
  "pratiche",
  "pratiche oggi",
  "pratiche ultimi 7 giorni",
  "pratica AA001"
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

  if (normalized === "pratiche") {
    return "practice-list";
  }

  if (normalized === "pratiche oggi") {
    return "practice-list-today";
  }

  if (normalized === "pratiche ultimi 7 giorni" || normalized === "pratiche ultimi 7 giorni") {
    return "practice-list-last-7-days";
  }

  if (/^pratica [a-z]{2}\d{3}$/iu.test(normalized)) {
    return "practice-detail";
  }

  return "unknown";
};

const buildHelpMessage = (): string =>
  `Comandi studio disponibili:\n${implementedCommands
    .map((command) => `- ${command}`)
    .join("\n")}\n\nLe pratiche vengono create automaticamente dopo il completamento dell'intake cliente. PDF e reinvio allegati non sono implementati.`;

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

const extractPracticeCode = (value: string): string | null => {
  const match = normalizeCommandText(value).match(/\b([a-z]{2}\d{3})\b/iu);

  return match?.[1]?.toUpperCase() ?? null;
};

const maskNameForList = (practice: PracticeRecord): string =>
  `${practice.clientFirstName} ${practice.clientLastName.charAt(0).toLocaleUpperCase("it-IT")}.`;

const formatPracticeListMessage = (practices: PracticeRecord[]): string => {
  if (practices.length === 0) {
    return "Nessuna pratica trovata.";
  }

  return [
    "Pratiche:",
    ...practices.map(
      (practice) =>
        `- ${practice.practiceCode} | ${maskNameForList(practice)} | ${practice.city} | ${practice.createdAt} | ${practice.status}`
    )
  ].join("\n");
};

const formatAttachmentBlock = (practice: PracticeRecord): string => {
  if (practice.attachmentMetadata.length === 0) {
    return "Allegati:\n- nessun allegato registrato";
  }

  return [
    "Allegati:",
    ...practice.attachmentMetadata.map((attachment, index) => {
      const parts = [
        `#${index + 1}`,
        attachment.kind,
        attachment.fileName ? `file=${attachment.fileName}` : null,
        attachment.mimeType ? `mime=${attachment.mimeType}` : null,
        attachment.sha256 ? "sha256=presente" : null
      ].filter(Boolean);

      return `- ${parts.join(" ")}`;
    })
  ].join("\n");
};

const formatPracticeDetailMessage = (practice: PracticeRecord): string =>
  [
    `Pratica ${practice.practiceCode} | stato: ${practice.status}`,
    "",
    "Cliente:",
    `- nome: ${practice.clientFirstName} ${practice.clientLastName}`,
    `- città: ${practice.city}`,
    `- data di nascita: ${practice.birthDate}`,
    `- riferimento: ${practice.subjectRef}`,
    "",
    "Questione legale:",
    practice.legalIssueText,
    ...(practice.cleanedIssueText
      ? ["", "Sintesi normalizzata:", practice.cleanedIssueText]
      : []),
    "",
    formatAttachmentBlock(practice),
    "",
    "Date:",
    `- creata: ${practice.createdAt}`,
    `- aggiornata: ${practice.updatedAt}`
  ].join("\n");

const startOfUtcDay = (date: Date): string =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();

const addUtcDays = (date: Date, days: number): string =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

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
  listReadyIntakes,
  listPractices,
  getPracticeByCode,
  now = () => new Date()
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

  if (
    command === "practice-list" ||
    command === "practice-list-today" ||
    command === "practice-list-last-7-days"
  ) {
    if (!listPractices) {
      return toRuntimeDecision(
        "lawyer_practice_list",
        "Operator requested practice list but no safe listing boundary is available",
        "Elenco pratiche non disponibile in questa runtime."
      );
    }

    const currentDate = now();
    const filter =
      command === "practice-list-today"
        ? {
            createdAtOrAfter: startOfUtcDay(currentDate),
            createdAtBefore: addUtcDays(new Date(startOfUtcDay(currentDate)), 1)
          }
        : command === "practice-list-last-7-days"
          ? {
              createdAtOrAfter: addUtcDays(currentDate, -7)
            }
          : undefined;
    const practices = await listPractices(filter);

    return toRuntimeDecision(
      "lawyer_practice_list",
      "Operator requested safe practice summaries",
      formatPracticeListMessage(practices)
    );
  }

  if (command === "practice-detail") {
    const practiceCode = extractPracticeCode(envelope.body);

    if (!practiceCode || !getPracticeByCode) {
      return toRuntimeDecision(
        "lawyer_practice_detail",
        "Operator requested practice detail but no safe detail boundary is available",
        "Dettaglio pratica non disponibile in questa runtime."
      );
    }

    const practice = await getPracticeByCode(practiceCode);

    return toRuntimeDecision(
      "lawyer_practice_detail",
      "Operator requested safe practice detail",
      practice
        ? formatPracticeDetailMessage(practice)
        : `Pratica ${practiceCode} non trovata.`
    );
  }

  return toRuntimeDecision(
    "lawyer_unknown_command",
    "Operator sent an unsupported command",
    `Comando operatore non riconosciuto.\n\n${buildHelpMessage()}`
  );
};

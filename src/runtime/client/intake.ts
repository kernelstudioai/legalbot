import { z } from "zod";
import { RuntimeDecision } from "../../contracts/index.ts";
import type { RuntimeDecisionType } from "../../contracts/index.ts";
import {
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_PROBLEM_SUMMARY_MAX_LENGTH,
  validateAcceptedClientName,
  validateAcceptedProblemSummary
} from "../../domain/intake/acceptedFields.ts";
import { InMemoryIntakeStore, type IntakeFieldName } from "../../persistence/index.ts";

export { CLIENT_NAME_MAX_LENGTH, CLIENT_PROBLEM_SUMMARY_MAX_LENGTH };

export const intakeStates = [
  "not_started",
  "asking_name",
  "asking_problem_summary",
  "intake_complete"
] as const;

export type IntakeState = (typeof intakeStates)[number];

export interface ClientIntakeRecord {
  subjectId: string;
  state: IntakeState;
  updatedAt: string;
  name?: string;
  problemSummary?: string;
}

export interface SetClientIntakeRecordInput {
  subjectId: string;
  state: IntakeState;
  updatedAt?: string;
  name?: string;
  problemSummary?: string;
}

export interface ClientIntakeStore {
  getIntakeRecord(subjectId: string): Promise<ClientIntakeRecord | null>;
  setIntakeRecord(input: SetClientIntakeRecordInput): Promise<ClientIntakeRecord>;
}

export class InMemoryClientIntakeStore implements ClientIntakeStore {
  private readonly store = new InMemoryIntakeStore();

  async getIntakeRecord(subjectId: string): Promise<ClientIntakeRecord | null> {
    const snapshot = await this.store.getIntakeSnapshot(subjectId);

    if (!snapshot) {
      return null;
    }

    return {
      subjectId: snapshot.subjectId,
      state: snapshot.state,
      updatedAt: snapshot.updatedAt,
      ...(snapshot.fields.name ? { name: snapshot.fields.name } : {}),
      ...(snapshot.fields.problemSummary
        ? {
            problemSummary: snapshot.fields.problemSummary
          }
        : {})
    };
  }

  async setIntakeRecord(input: SetClientIntakeRecordInput): Promise<ClientIntakeRecord> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    await this.store.setIntakeState(input.subjectId, input.state, {
      updatedAt
    });

    for (const fieldName of ["name", "problemSummary"] as const satisfies IntakeFieldName[]) {
      const value = input[fieldName];

      if (!value) {
        continue;
      }

      await this.store.setIntakeField(input.subjectId, fieldName, value, {
        updatedAt
      });
    }

    return {
      subjectId: input.subjectId,
      state: input.state,
      updatedAt,
      ...(input.name ? { name: input.name } : {}),
      ...(input.problemSummary ? { problemSummary: input.problemSummary } : {})
    };
  }

  snapshot(): ClientIntakeRecord[] {
    const states = this.store.snapshotStates();
    const fields = this.store.snapshotFields();

    return states.map((stateRecord) => {
      const subjectFields = fields.filter((field) => field.subjectId === stateRecord.subjectId);
      const name = subjectFields.find((field) => field.fieldName === "name")?.value;
      const problemSummary = subjectFields.find(
        (field) => field.fieldName === "problemSummary"
      )?.value;

      return {
        subjectId: stateRecord.subjectId,
        state: stateRecord.state,
        updatedAt: stateRecord.updatedAt,
        ...(name ? { name } : {}),
        ...(problemSummary ? { problemSummary } : {})
      };
    });
  }
}

export const intakeMessageTemplates = {
  intake_ask_name:
    "Consenso registrato. Per iniziare l'intake, rispondi solo con il tuo nome e cognome, senza altri dettagli.",
  intake_ask_problem_summary:
    "Grazie. Ora invia solo una breve sintesi del problema in un unico messaggio, senza allegati e senza chiedere consulenza legale.",
  intake_complete_ack:
    "Grazie. Ho registrato solo i campi strutturati minimi per l'intake iniziale. Non e stata aperta alcuna pratica e non sto fornendo consulenza legale.",
  intake_invalid_response:
    "Risposta non valida. Invia solo il dato richiesto, non vuoto e in forma breve, senza allegati o dettagli aggiuntivi."
} as const;

export type IntakeRuntimeAction = keyof typeof intakeMessageTemplates;

export interface ResolveClientIntakeRuntimeDecisionInput {
  subjectId: string;
  intakeRecord?: ClientIntakeRecord | null;
  inboundText?: string;
  consentJustGranted?: boolean;
  now?: () => string;
}

export interface ClientIntakeRuntimeDecisionResult {
  intakeState: IntakeState;
  runtimeDecision: RuntimeDecisionType;
  messageTemplate: string;
  nextRecord?: SetClientIntakeRecordInput;
}

const createIntakeRuntimeDecision = (
  action: IntakeRuntimeAction,
  rationale: string
): RuntimeDecisionType =>
  RuntimeDecision.parse({
    actor: "client",
    action,
    rationale
  });

export const isIntakeRuntimeAction = (
  action: RuntimeDecisionType["action"]
): action is IntakeRuntimeAction => action in intakeMessageTemplates;

const buildNextRecord = (
  subjectId: string,
  state: IntakeState,
  existingRecord: ClientIntakeRecord | null,
  now: () => string,
  fields: {
    name?: string;
    problemSummary?: string;
  } = {}
): SetClientIntakeRecordInput => {
  const nextRecord: SetClientIntakeRecordInput = {
    subjectId,
    state,
    updatedAt: now()
  };
  const nextName = fields.name ?? existingRecord?.name;
  const nextProblemSummary = fields.problemSummary ?? existingRecord?.problemSummary;

  if (nextName) {
    nextRecord.name = nextName;
  }

  if (nextProblemSummary) {
    nextRecord.problemSummary = nextProblemSummary;
  }

  return nextRecord;
};

export const resolveClientIntakeRuntimeDecision = ({
  subjectId,
  intakeRecord,
  inboundText,
  consentJustGranted = false,
  now = () => new Date().toISOString()
}: ResolveClientIntakeRuntimeDecisionInput): ClientIntakeRuntimeDecisionResult => {
  const currentRecord = intakeRecord ?? null;
  const currentState = currentRecord?.state ?? "not_started";

  if (currentState === "intake_complete") {
    return {
      intakeState: "intake_complete",
      runtimeDecision: createIntakeRuntimeDecision(
        "intake_complete_ack",
        "Client intake is already complete"
      ),
      messageTemplate: intakeMessageTemplates.intake_complete_ack
    };
  }

  if (consentJustGranted || currentState === "not_started") {
    return {
      intakeState: "asking_name",
      runtimeDecision: createIntakeRuntimeDecision(
        "intake_ask_name",
        "Consent is granted and intake starts by collecting the client name"
      ),
      messageTemplate: intakeMessageTemplates.intake_ask_name,
      nextRecord: buildNextRecord(subjectId, "asking_name", currentRecord, now)
    };
  }

  if (currentState === "asking_name") {
    const parsedName = validateAcceptedClientName(inboundText);

    if (!parsedName.valid) {
      return {
        intakeState: "asking_name",
        runtimeDecision: createIntakeRuntimeDecision(
          "intake_invalid_response",
          "Rejected empty or overly long intake name"
        ),
        messageTemplate: intakeMessageTemplates.intake_invalid_response
      };
    }

    return {
      intakeState: "asking_problem_summary",
      runtimeDecision: createIntakeRuntimeDecision(
        "intake_ask_problem_summary",
        "Accepted structured client name and advanced intake to problem summary"
      ),
      messageTemplate: intakeMessageTemplates.intake_ask_problem_summary,
      nextRecord: buildNextRecord(subjectId, "asking_problem_summary", currentRecord, now, {
        name: parsedName.value
      })
    };
  }

  const parsedSummary = validateAcceptedProblemSummary(inboundText);

  if (!parsedSummary.valid) {
    return {
      intakeState: "asking_problem_summary",
      runtimeDecision: createIntakeRuntimeDecision(
        "intake_invalid_response",
        "Rejected empty or overly long intake problem summary"
      ),
      messageTemplate: intakeMessageTemplates.intake_invalid_response
    };
  }

  return {
    intakeState: "intake_complete",
    runtimeDecision: createIntakeRuntimeDecision(
      "intake_complete_ack",
      "Accepted structured problem summary and completed the intake skeleton"
    ),
    messageTemplate: intakeMessageTemplates.intake_complete_ack,
    nextRecord: buildNextRecord(subjectId, "intake_complete", currentRecord, now, {
      problemSummary: parsedSummary.value
    })
  };
};

export const intakeStateSchema = z.enum(intakeStates);

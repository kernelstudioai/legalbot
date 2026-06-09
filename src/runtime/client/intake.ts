import { RuntimeDecision } from "../../contracts/index.ts";
import type { RuntimeDecisionType } from "../../contracts/index.ts";
import {
  buildAcceptedDisplayName,
  CLIENT_PROBLEM_SUMMARY_MAX_LENGTH,
  validateAcceptedProblemSummary
} from "../../domain/intake/acceptedFields.ts";
import {
  createDeterministicIdentityExtractionProvider,
  identityFieldNames,
  type AcceptedIdentityFields,
  type IdentityExtractionProvider,
  type IdentityFieldName
} from "../../domain/intake/extraction.ts";
import { InMemoryIntakeStore, type IntakeFieldName } from "../../persistence/index.ts";

export { CLIENT_PROBLEM_SUMMARY_MAX_LENGTH, identityFieldNames };

export const intakeStates = [
  "not_started",
  "asking_identity",
  "asking_problem_summary",
  "intake_complete"
] as const;

export type IntakeState = (typeof intakeStates)[number];

export interface ClientIntakeRecord extends Partial<AcceptedIdentityFields> {
  subjectId: string;
  state: IntakeState;
  updatedAt: string;
  problemSummary?: string;
}

export interface SetClientIntakeRecordInput extends Partial<AcceptedIdentityFields> {
  subjectId: string;
  state: IntakeState;
  updatedAt?: string;
  problemSummary?: string;
}

export interface ClientIntakeStore {
  getIntakeRecord(subjectId: string): Promise<ClientIntakeRecord | null>;
  setIntakeRecord(input: SetClientIntakeRecordInput): Promise<ClientIntakeRecord>;
}

const persistedIntakeFields = [...identityFieldNames, "problemSummary"] as const satisfies IntakeFieldName[];
const identityFieldLabels: Record<IdentityFieldName, string> = {
  firstName: "nome",
  lastName: "cognome",
  birthDate: "data di nascita",
  city: "città"
};

const buildIdentityClarificationMessage = (missingFields: IdentityFieldName[]): string =>
  `Per proseguire mi servono ancora, in un unico messaggio:\n${missingFields
    .map((fieldName) => `- ${identityFieldLabels[fieldName]}`)
    .join("\n")}`;

const buildIdentityQuestionMessage = (): string =>
  "Grazie. Per iniziare, mi scriva in un unico messaggio:\n- nome\n- cognome\n- data di nascita\n- città\n\nEsempio: Mario Rossi, 01/01/1980, Roma";

const hasCompleteIdentity = (
  record: Partial<AcceptedIdentityFields> | null | undefined
): record is AcceptedIdentityFields =>
  identityFieldNames.every((fieldName) => Boolean(record?.[fieldName]));

const getIdentityFields = (
  record: Partial<AcceptedIdentityFields> | null | undefined
): Partial<AcceptedIdentityFields> => ({
  ...(record?.firstName ? { firstName: record.firstName } : {}),
  ...(record?.lastName ? { lastName: record.lastName } : {}),
  ...(record?.birthDate ? { birthDate: record.birthDate } : {}),
  ...(record?.city ? { city: record.city } : {})
});

const toDynamicRuntimeDecision = (
  action: IntakeRuntimeAction,
  rationale: string,
  messageOverride?: string
): RuntimeDecisionType =>
  RuntimeDecision.parse({
    actor: "client",
    action,
    rationale,
    ...(messageOverride ? { messageOverride } : {})
  });

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
      ...(snapshot.fields.firstName ? { firstName: snapshot.fields.firstName } : {}),
      ...(snapshot.fields.lastName ? { lastName: snapshot.fields.lastName } : {}),
      ...(snapshot.fields.birthDate ? { birthDate: snapshot.fields.birthDate } : {}),
      ...(snapshot.fields.city ? { city: snapshot.fields.city } : {}),
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

    for (const fieldName of persistedIntakeFields) {
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
      ...getIdentityFields(input),
      ...(input.problemSummary ? { problemSummary: input.problemSummary } : {})
    };
  }

  snapshot(): ClientIntakeRecord[] {
    const states = this.store.snapshotStates();
    const fields = this.store.snapshotFields();

    return states.map((stateRecord) => {
      const subjectFields = fields.filter((field) => field.subjectId === stateRecord.subjectId);
      const findField = (fieldName: IntakeFieldName): string | undefined =>
        subjectFields.find((field) => field.fieldName === fieldName)?.value;
      const firstName = findField("firstName");
      const lastName = findField("lastName");
      const birthDate = findField("birthDate");
      const city = findField("city");
      const problemSummary = findField("problemSummary");

      return {
        subjectId: stateRecord.subjectId,
        state: stateRecord.state,
        updatedAt: stateRecord.updatedAt,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(birthDate ? { birthDate } : {}),
        ...(city ? { city } : {}),
        ...(problemSummary ? { problemSummary } : {})
      };
    });
  }
}

export const intakeMessageTemplates = {
  intake_ask_identity: buildIdentityQuestionMessage(),
  intake_ask_problem_summary:
    "La ringrazio. Descriva brevemente il problema per cui desidera assistenza.",
  intake_complete_ack:
    "La ringrazio. Ho registrato solo i campi strutturati minimi per la revisione dell'operatore. Non e stata aperta alcuna pratica e non Le sto fornendo consulenza legale.",
  intake_invalid_response:
    "La risposta non e valida. Mi invii solo una breve descrizione del problema, senza allegati."
} as const;

export type IntakeRuntimeAction = keyof typeof intakeMessageTemplates | "intake_clarify_identity";

export interface ResolveClientIntakeRuntimeDecisionInput {
  subjectId: string;
  intakeRecord?: ClientIntakeRecord | null;
  inboundText?: string;
  consentJustGranted?: boolean;
  now?: () => string;
  extractionProvider?: IdentityExtractionProvider;
}

export interface ClientIntakeRuntimeDecisionResult {
  intakeState: IntakeState;
  runtimeDecision: RuntimeDecisionType;
  messageTemplate: string;
  nextRecord?: SetClientIntakeRecordInput;
}

const buildNextRecord = (
  subjectId: string,
  state: IntakeState,
  existingRecord: ClientIntakeRecord | null,
  now: () => string,
  fields: Partial<AcceptedIdentityFields> & {
    problemSummary?: string;
  } = {}
): SetClientIntakeRecordInput => {
  const nextRecord: SetClientIntakeRecordInput = {
    subjectId,
    state,
    updatedAt: now()
  };
  const nextIdentityFields = {
    ...getIdentityFields(existingRecord),
    ...getIdentityFields(fields)
  };

  for (const fieldName of identityFieldNames) {
    const value = nextIdentityFields[fieldName];

    if (value) {
      nextRecord[fieldName] = value;
    }
  }

  const nextProblemSummary = fields.problemSummary ?? existingRecord?.problemSummary;

  if (nextProblemSummary) {
    nextRecord.problemSummary = nextProblemSummary;
  }

  return nextRecord;
};

export const isIntakeRuntimeAction = (
  action: RuntimeDecisionType["action"]
): action is IntakeRuntimeAction =>
  action === "intake_clarify_identity" || action in intakeMessageTemplates;

export const resolveClientIntakeRuntimeDecision = ({
  subjectId,
  intakeRecord,
  inboundText,
  consentJustGranted = false,
  now = () => new Date().toISOString(),
  extractionProvider = createDeterministicIdentityExtractionProvider()
}: ResolveClientIntakeRuntimeDecisionInput): ClientIntakeRuntimeDecisionResult => {
  const currentRecord = intakeRecord ?? null;
  const currentState = currentRecord?.state ?? "not_started";

  if (currentState === "intake_complete" && hasCompleteIdentity(currentRecord) && currentRecord.problemSummary) {
    return {
      intakeState: "intake_complete",
      runtimeDecision: toDynamicRuntimeDecision(
        "intake_complete_ack",
        "Client intake is already complete"
      ),
      messageTemplate: intakeMessageTemplates.intake_complete_ack
    };
  }

  if (consentJustGranted || currentState === "not_started") {
    return {
      intakeState: "asking_identity",
      runtimeDecision: toDynamicRuntimeDecision(
        "intake_ask_identity",
        "Consent is granted and intake starts by collecting structured identity data"
      ),
      messageTemplate: intakeMessageTemplates.intake_ask_identity,
      nextRecord: buildNextRecord(subjectId, "asking_identity", currentRecord, now)
    };
  }

  if (currentState === "asking_identity") {
    const extraction = extractionProvider.extractIdentity({
      text: inboundText ?? "",
      existingFields: getIdentityFields(currentRecord)
    });
    const nextIdentityFields = extraction.acceptedFields;

    if (extraction.missingFields.length > 0) {
      const messageTemplate = buildIdentityClarificationMessage(extraction.missingFields);

      return {
        intakeState: "asking_identity",
        runtimeDecision: toDynamicRuntimeDecision(
          "intake_clarify_identity",
          "Identity extraction is incomplete or ambiguous and requires clarification",
          messageTemplate
        ),
        messageTemplate,
        ...(Object.keys(nextIdentityFields).length > 0
          ? {
              nextRecord: buildNextRecord(
                subjectId,
                "asking_identity",
                currentRecord,
                now,
                nextIdentityFields
              )
            }
          : {})
      };
    }

    const nextRecord = buildNextRecord(subjectId, "asking_problem_summary", currentRecord, now, nextIdentityFields);

    if (nextRecord.problemSummary) {
      nextRecord.state = "intake_complete";

      return {
        intakeState: "intake_complete",
        runtimeDecision: toDynamicRuntimeDecision(
          "intake_complete_ack",
          "Completed missing identity fields for a previously summarized intake"
        ),
        messageTemplate: intakeMessageTemplates.intake_complete_ack,
        nextRecord
      };
    }

    return {
      intakeState: "asking_problem_summary",
      runtimeDecision: toDynamicRuntimeDecision(
        "intake_ask_problem_summary",
        "Accepted structured identity fields and advanced intake to problem summary"
      ),
      messageTemplate: intakeMessageTemplates.intake_ask_problem_summary,
      nextRecord
    };
  }

  const parsedSummary = validateAcceptedProblemSummary(inboundText);

  if (!parsedSummary.valid) {
    return {
      intakeState: "asking_problem_summary",
      runtimeDecision: toDynamicRuntimeDecision(
        "intake_invalid_response",
        "Rejected empty or overly long intake problem summary"
      ),
      messageTemplate: intakeMessageTemplates.intake_invalid_response
    };
  }

  const identityFields = getIdentityFields(currentRecord);

  if (!hasCompleteIdentity(identityFields)) {
    const missingFields = identityFieldNames.filter((fieldName) => !identityFields[fieldName]);
    const messageTemplate = buildIdentityClarificationMessage(missingFields);

    return {
      intakeState: "asking_identity",
      runtimeDecision: toDynamicRuntimeDecision(
        "intake_clarify_identity",
        "Problem summary was received before structured identity fields were complete",
        messageTemplate
      ),
      messageTemplate,
      nextRecord: buildNextRecord(subjectId, "asking_identity", currentRecord, now)
    };
  }

  return {
    intakeState: "intake_complete",
    runtimeDecision: toDynamicRuntimeDecision(
      "intake_complete_ack",
      `Accepted structured intake for ${buildAcceptedDisplayName(identityFields)}`
    ),
    messageTemplate: intakeMessageTemplates.intake_complete_ack,
    nextRecord: buildNextRecord(subjectId, "intake_complete", currentRecord, now, {
      problemSummary: parsedSummary.value
    })
  };
};

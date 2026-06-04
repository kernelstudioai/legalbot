import { z } from "zod";
import { RuntimeDecision } from "../../contracts/index.ts";
import type { RuntimeDecisionType } from "../../contracts/index.ts";

export const ConsentState = z.enum(["unknown", "requested", "granted", "denied"]);

export type ConsentState = z.infer<typeof ConsentState>;

export const consentMessageTemplates = {
  request_consent:
    'Per continuare, posso trattare e conservare i messaggi che mi invii per gestire la tua richiesta? Rispondi solo con "Acconsento al trattamento dei miei dati personali" oppure "Non acconsento al trattamento dei miei dati personali".',
  consent_granted_ack:
    "Grazie. Hai autorizzato il trattamento dei tuoi dati personali per i prossimi passaggi operativi.",
  consent_denied_close:
    "Ricevuto. Senza consenso non conservero contenuti dei messaggi. La conversazione si chiude qui.",
  consent_clarification:
    'Non posso interpretare la tua risposta come consenso esplicito. Rispondi solo con "Acconsento al trattamento dei miei dati personali" oppure "Non acconsento al trattamento dei miei dati personali".',
  intake_not_implemented:
    "Il consenso risulta registrato, ma il flusso di intake non e ancora attivo su WhatsApp in questa fase."
} as const;

export type ConsentRuntimeAction = keyof typeof consentMessageTemplates;

const strictPositiveConsentForms = new Set<string>([
  "acconsento al trattamento dei miei dati personali",
  "acconsento al trattamento dei miei dati",
  "autorizzo il trattamento dei miei dati personali",
  "autorizzo il trattamento dei miei dati",
  "i consent to the processing of my personal data",
  "i consent to personal data processing",
  "i agree to the processing of my personal data",
  "i agree to personal data processing",
  "i authorize the processing of my personal data",
  "i authorize personal data processing"
]);

const strictNegativeConsentForms = new Set<string>([
  "non acconsento al trattamento dei miei dati personali",
  "non acconsento al trattamento dei miei dati",
  "non autorizzo il trattamento dei miei dati personali",
  "non autorizzo il trattamento dei miei dati",
  "nego il consenso al trattamento dei miei dati personali",
  "i do not consent to the processing of my personal data",
  "i do not consent to personal data processing",
  "i do not agree to the processing of my personal data",
  "i do not authorize the processing of my personal data",
  "i deny consent to personal data processing"
]);

const normalizeConsentText = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const parseConsentDecision = (text: string): ConsentState => {
  const normalizedText = normalizeConsentText(text);

  if (strictPositiveConsentForms.has(normalizedText)) {
    return "granted";
  }

  if (strictNegativeConsentForms.has(normalizedText)) {
    return "denied";
  }

  return "unknown";
};

export const canPersistClientContent = (consentState: ConsentState): boolean =>
  consentState === "granted";

export interface ResolveConsentRuntimeDecisionInput {
  consentState: ConsentState;
  inboundText?: string;
}

export interface ConsentRuntimeDecisionResult {
  consentState: ConsentState;
  runtimeDecision: RuntimeDecisionType;
  messageTemplate: string;
}

const createConsentRuntimeDecision = (
  action: ConsentRuntimeAction,
  rationale: string
): RuntimeDecisionType =>
  RuntimeDecision.parse({
    actor: "client",
    action,
    rationale
  });

export const isConsentRuntimeAction = (
  action: RuntimeDecisionType["action"]
): action is ConsentRuntimeAction => action in consentMessageTemplates;

export const resolveConsentRuntimeDecision = ({
  consentState,
  inboundText
}: ResolveConsentRuntimeDecisionInput): ConsentRuntimeDecisionResult => {
  if (consentState === "granted") {
    return {
      consentState,
      runtimeDecision: createConsentRuntimeDecision(
        "intake_not_implemented",
        "Consent already granted, but client intake runtime is not implemented yet"
      ),
      messageTemplate: consentMessageTemplates.intake_not_implemented
    };
  }

  if (consentState === "denied") {
    return {
      consentState,
      runtimeDecision: createConsentRuntimeDecision(
        "consent_denied_close",
        "Consent already denied, so client content persistence remains closed"
      ),
      messageTemplate: consentMessageTemplates.consent_denied_close
    };
  }

  const parsedDecision =
    typeof inboundText === "string" ? parseConsentDecision(inboundText) : "unknown";

  if (parsedDecision === "granted") {
    return {
      consentState: "granted",
      runtimeDecision: createConsentRuntimeDecision(
        "consent_granted_ack",
        "Received explicit consent for client content persistence"
      ),
      messageTemplate: consentMessageTemplates.consent_granted_ack
    };
  }

  if (parsedDecision === "denied") {
    return {
      consentState: "denied",
      runtimeDecision: createConsentRuntimeDecision(
        "consent_denied_close",
        "Received explicit denial for client content persistence"
      ),
      messageTemplate: consentMessageTemplates.consent_denied_close
    };
  }

  if (consentState === "requested") {
    return {
      consentState: "requested",
      runtimeDecision: createConsentRuntimeDecision(
        "consent_clarification",
        "Received ambiguous consent response and need explicit clarification"
      ),
      messageTemplate: consentMessageTemplates.consent_clarification
    };
  }

  return {
    consentState: "requested",
    runtimeDecision: createConsentRuntimeDecision(
      "request_consent",
      "Client content persistence is blocked until explicit consent is requested"
    ),
    messageTemplate: consentMessageTemplates.request_consent
  };
};

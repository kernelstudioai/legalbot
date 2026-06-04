export const consentStates = ["unknown", "requested", "granted", "denied"] as const;

export type ConsentState = (typeof consentStates)[number];

export interface ConsentStateRecord {
  subjectId: string;
  state: ConsentState;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SetConsentStateOptions {
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsentEventRecord {
  eventId: string;
  subjectId: string;
  state: ConsentState;
  eventType: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface AppendConsentEventInput {
  eventId: string;
  subjectId: string;
  state: ConsentState;
  eventType: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsentStore {
  getConsentState(subjectId: string): Promise<ConsentState>;
  setConsentState(
    subjectId: string,
    state: ConsentState,
    options?: SetConsentStateOptions
  ): Promise<ConsentStateRecord>;
  appendConsentEvent(event: ConsentEventRecord): Promise<void>;
}

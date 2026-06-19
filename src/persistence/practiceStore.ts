import type { PracticeCodeOverflowError } from "../domain/practices/practiceCode.ts";

export type PracticeStatus = "draft" | "archived" | "review_pending" | string;

export interface PracticeAttachmentMetadata {
  kind: "audio" | "document" | "image" | "video";
  providerMediaId?: string;
  mimeType?: string;
  fileName?: string;
  sha256?: string;
  receivedAt?: string;
}

export interface PracticeRecord {
  practiceCode: string;
  subjectId: string;
  status: PracticeStatus;
  clientFirstName: string;
  clientLastName: string;
  birthDate: string;
  city: string;
  subjectRef: string;
  legalIssueText: string;
  cleanedIssueText?: string;
  attachmentMetadata: PracticeAttachmentMetadata[];
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePracticeInput {
  practiceCode: string;
  subjectId: string;
  status?: PracticeStatus;
  clientFirstName: string;
  clientLastName: string;
  birthDate: string;
  city: string;
  subjectRef: string;
  legalIssueText: string;
  cleanedIssueText?: string;
  attachmentMetadata?: PracticeAttachmentMetadata[];
  sourceMessageId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PracticeListFilter {
  createdAtOrAfter?: string;
  createdAtBefore?: string;
}

export interface PracticeStore {
  allocateNextPracticeCode(): Promise<string>;
  create(input: CreatePracticeInput): Promise<PracticeRecord>;
  findByPracticeCode(practiceCode: string): Promise<PracticeRecord | null>;
  findBySourceMessageId(sourceMessageId: string): Promise<PracticeRecord | null>;
  list(filter?: PracticeListFilter): Promise<PracticeRecord[]>;
}

export type PracticeStoreAllocationError = PracticeCodeOverflowError;

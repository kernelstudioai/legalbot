export type CaseStatus = "draft" | "duplicate_archived" | "review_pending" | string;

export class CaseDraftUniquenessError extends Error {
  readonly code = "draft_case_already_exists";

  constructor(message: string = "A draft case already exists for this subject.") {
    super(message);
    this.name = "CaseDraftUniquenessError";
  }
}

export interface CaseRecord {
  caseId: string;
  subjectId: string;
  status: CaseStatus;
  name: string;
  problemSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCaseInput {
  caseId: string;
  subjectId: string;
  status?: CaseStatus;
  name: string;
  problemSummary: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateCaseInput {
  caseId: string;
  status?: CaseStatus;
  updatedAt: string;
}

export interface CaseStore {
  create(input: CreateCaseInput): Promise<CaseRecord>;
  findDraftBySubjectId(subjectId: string): Promise<CaseRecord | null>;
  getById(caseId: string): Promise<CaseRecord | null>;
  update(input: UpdateCaseInput): Promise<CaseRecord | null>;
}

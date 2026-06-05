export interface CaseRecord {
  caseId: string;
  subjectId: string;
  status: string;
  name: string;
  problemSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCaseInput {
  caseId: string;
  subjectId: string;
  status?: string;
  name: string;
  problemSummary: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateCaseInput {
  caseId: string;
  status?: string;
  updatedAt: string;
}

export interface CaseStore {
  create(input: CreateCaseInput): Promise<CaseRecord>;
  getById(caseId: string): Promise<CaseRecord | null>;
  update(input: UpdateCaseInput): Promise<CaseRecord | null>;
}

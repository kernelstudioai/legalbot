import {
  defaultBusinessCommandOptions,
  requireBusinessPersistenceEnv,
  toBusinessCommandErrorMessage,
  verifyBusinessDatabase,
  type BusinessCommandOptions
} from "./businessPersistenceCommandCommon.ts";
import { exitWithCode, isDirectExecution, type DbCommandSummary } from "./dbCommandCommon.ts";

interface CountByState {
  [key: string]: number;
}

interface BusinessConsistencyCounts {
  completedIntakeCount: number;
  completedIntakeMissingRequiredFieldCount: number;
  completedIntakeWithoutGrantedConsentCount: number;
  draftCaseCount: number;
  draftCaseWithoutCompletedIntakeCount: number;
  draftCaseWithoutGrantedConsentCount: number;
  duplicateDraftSubjectCount: number;
}

export interface BusinessCheckReport {
  status: "healthy" | "consistency_errors_detected";
  sourceDatabase: string;
  checkedAt: string;
  migrationCount: number;
  pendingMigrationCount: number;
  consentStateCounts: CountByState;
  intakeStateCounts: CountByState;
  completedIntakeCount: number;
  draftCaseCount: number;
  duplicateDraftSubjectCount: number;
  consistencyErrors: string[];
}

export interface BusinessCheckSummary extends DbCommandSummary {
  report?: BusinessCheckReport;
}

const getGroupedCounts = (
  rows: Array<{ state: string; count: number }>
): CountByState => ({
  total: rows.reduce((total, row) => total + Number(row.count), 0),
  ...Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]))
});

const getBusinessConsistencyCounts = (
  database: ReturnType<typeof verifyBusinessDatabase>["database"]
): BusinessConsistencyCounts => {
  const aggregateRow = database.prepare(
    `
      SELECT
        (
          SELECT COUNT(*)
          FROM intake_states
          WHERE intake_state = 'intake_complete'
        ) AS completed_intake_count,
        (
          SELECT COUNT(*)
          FROM cases
          WHERE status = 'draft'
        ) AS draft_case_count,
        (
          SELECT COUNT(*)
          FROM (
            SELECT subject_id
            FROM cases
            WHERE status = 'draft'
            GROUP BY subject_id
            HAVING COUNT(*) > 1
          )
        ) AS duplicate_draft_subject_count,
        (
          SELECT COUNT(*)
          FROM intake_states AS intake
          WHERE intake.intake_state = 'intake_complete'
            AND NOT EXISTS (
              SELECT 1
              FROM consent_states AS consent
              WHERE consent.subject_id = intake.subject_id
                AND consent.consent_state = 'granted'
            )
        ) AS completed_intake_without_granted_consent_count,
        (
          SELECT COUNT(*)
          FROM intake_states AS intake
          WHERE intake.intake_state = 'intake_complete'
            AND EXISTS (
              SELECT 1
              FROM (
                SELECT subject_id
                FROM intake_fields
                WHERE field_name IN ('firstName', 'lastName', 'birthDate', 'city', 'problemSummary')
                GROUP BY subject_id
                HAVING COUNT(DISTINCT field_name) < 5
              ) AS incomplete_fields
              WHERE incomplete_fields.subject_id = intake.subject_id
            )
        ) AS completed_intake_missing_required_field_count,
        (
          SELECT COUNT(*)
          FROM cases AS draft_cases
          WHERE draft_cases.status = 'draft'
            AND NOT EXISTS (
              SELECT 1
              FROM intake_states AS intake
              WHERE intake.subject_id = draft_cases.subject_id
                AND intake.intake_state = 'intake_complete'
            )
        ) AS draft_case_without_completed_intake_count,
        (
          SELECT COUNT(*)
          FROM cases AS draft_cases
          WHERE draft_cases.status = 'draft'
            AND NOT EXISTS (
              SELECT 1
              FROM consent_states AS consent
              WHERE consent.subject_id = draft_cases.subject_id
                AND consent.consent_state = 'granted'
            )
        ) AS draft_case_without_granted_consent_count
    `
  ).get() as {
    completed_intake_count: number;
    completed_intake_missing_required_field_count: number;
    completed_intake_without_granted_consent_count: number;
    draft_case_count: number;
    draft_case_without_completed_intake_count: number;
    draft_case_without_granted_consent_count: number;
    duplicate_draft_subject_count: number;
  };

  return {
    completedIntakeCount: Number(aggregateRow.completed_intake_count),
    completedIntakeMissingRequiredFieldCount: Number(
      aggregateRow.completed_intake_missing_required_field_count
    ),
    completedIntakeWithoutGrantedConsentCount: Number(
      aggregateRow.completed_intake_without_granted_consent_count
    ),
    draftCaseCount: Number(aggregateRow.draft_case_count),
    draftCaseWithoutCompletedIntakeCount: Number(
      aggregateRow.draft_case_without_completed_intake_count
    ),
    draftCaseWithoutGrantedConsentCount: Number(
      aggregateRow.draft_case_without_granted_consent_count
    ),
    duplicateDraftSubjectCount: Number(aggregateRow.duplicate_draft_subject_count)
  };
};

const createBusinessCheckReport = ({
  sourceDatabase,
  appliedMigrationCount,
  pendingMigrationCount,
  consentStateCounts,
  intakeStateCounts,
  consistencyCounts
}: {
  sourceDatabase: string;
  appliedMigrationCount: number;
  pendingMigrationCount: number;
  consentStateCounts: CountByState;
  intakeStateCounts: CountByState;
  consistencyCounts: BusinessConsistencyCounts;
}): BusinessCheckReport => {
  const consistencyErrors: string[] = [];

  if (pendingMigrationCount > 0) {
    consistencyErrors.push("pending_migrations");
  }

  if (consistencyCounts.completedIntakeWithoutGrantedConsentCount > 0) {
    consistencyErrors.push("completed_intake_without_granted_consent");
  }

  if (consistencyCounts.completedIntakeMissingRequiredFieldCount > 0) {
    consistencyErrors.push("completed_intake_missing_required_fields");
  }

  if (consistencyCounts.draftCaseWithoutCompletedIntakeCount > 0) {
    consistencyErrors.push("draft_case_without_completed_intake");
  }

  if (consistencyCounts.draftCaseWithoutGrantedConsentCount > 0) {
    consistencyErrors.push("draft_case_without_granted_consent");
  }

  if (consistencyCounts.duplicateDraftSubjectCount > 0) {
    consistencyErrors.push("duplicate_draft_subjects");
  }

  return {
    status: consistencyErrors.length === 0 ? "healthy" : "consistency_errors_detected",
    sourceDatabase,
    checkedAt: new Date().toISOString(),
    migrationCount: appliedMigrationCount,
    pendingMigrationCount,
    consentStateCounts,
    intakeStateCounts,
    completedIntakeCount: consistencyCounts.completedIntakeCount,
    draftCaseCount: consistencyCounts.draftCaseCount,
    duplicateDraftSubjectCount: consistencyCounts.duplicateDraftSubjectCount,
    consistencyErrors
  };
};

export const runBusinessCheckCommand = (
  options: BusinessCommandOptions = {}
): BusinessCheckSummary => {
  const { cwd, envSource, logger, stdout } = defaultBusinessCommandOptions(options);
  let verifiedDatabase:
    | ReturnType<typeof verifyBusinessDatabase>
    | undefined;

  try {
    const env = requireBusinessPersistenceEnv(envSource);

    logger.info("business_check_starting", {
      business_persistence_enabled: true
    });

    verifiedDatabase = verifyBusinessDatabase({
      cwd,
      databaseUrl: env.DATABASE_URL,
      operationLabel: "Business check"
    });

    if (verifiedDatabase.pendingMigrationIds.length > 0) {
      const report = createBusinessCheckReport({
        sourceDatabase: env.DATABASE_URL,
        appliedMigrationCount: verifiedDatabase.appliedMigrationIds.length,
        pendingMigrationCount: verifiedDatabase.pendingMigrationIds.length,
        consentStateCounts: { total: 0 },
        intakeStateCounts: { total: 0 },
        consistencyCounts: {
          completedIntakeCount: 0,
          completedIntakeMissingRequiredFieldCount: 0,
          completedIntakeWithoutGrantedConsentCount: 0,
          draftCaseCount: 0,
          draftCaseWithoutCompletedIntakeCount: 0,
          draftCaseWithoutGrantedConsentCount: 0,
          duplicateDraftSubjectCount: 0
        }
      });

      stdout.write(`${JSON.stringify(report)}\n`);
      logger.info("business_check_complete", {
        ...report
      });

      return {
        exitCode: 1,
        report
      };
    }

    const consentRows = verifiedDatabase.database.prepare(
      `
        SELECT consent_state AS state, COUNT(*) AS count
        FROM consent_states
        GROUP BY consent_state
        ORDER BY consent_state ASC
      `
    ).all() as Array<{ state: string; count: number }>;
    const intakeRows = verifiedDatabase.database.prepare(
      `
        SELECT intake_state AS state, COUNT(*) AS count
        FROM intake_states
        GROUP BY intake_state
        ORDER BY intake_state ASC
      `
    ).all() as Array<{ state: string; count: number }>;

    const report = createBusinessCheckReport({
      sourceDatabase: env.DATABASE_URL,
      appliedMigrationCount: verifiedDatabase.appliedMigrationIds.length,
      pendingMigrationCount: verifiedDatabase.pendingMigrationIds.length,
      consentStateCounts: getGroupedCounts(consentRows),
      intakeStateCounts: getGroupedCounts(intakeRows),
      consistencyCounts: getBusinessConsistencyCounts(verifiedDatabase.database)
    });

    stdout.write(`${JSON.stringify(report)}\n`);
    logger.info("business_check_complete", {
      ...report
    });

    return {
      exitCode: report.status === "healthy" ? 0 : 1,
      report
    };
  } catch (error) {
    logger.error("business_check_failed", {
      error: toBusinessCommandErrorMessage(error)
    });

    return {
      exitCode: 1
    };
  } finally {
    verifiedDatabase?.database.close();
  }
};

if (isDirectExecution(import.meta.url)) {
  exitWithCode(runBusinessCheckCommand());
}

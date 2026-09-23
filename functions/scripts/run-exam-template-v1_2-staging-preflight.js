'use strict';

const {
  initializeApp,
  deleteApp
} = require('firebase-admin/app');

const {
  getFirestore
} = require('firebase-admin/firestore');

const {
  validateStagingPreflightArguments,
  runExamTemplateStagingPreflight
} = require('../src/migration/exam-template-v1_2-staging-preflight');

async function main() {
  const validated =
    validateStagingPreflightArguments({
      args:
        process.argv.slice(2),
      env:
        process.env
    });

  const app =
    initializeApp(
      {
        projectId:
          validated.projectId
      },
      `exam-template-staging-preflight-${process.pid}-${Date.now()}`
    );

  try {
    const db =
      getFirestore(app);

    const report =
      await runExamTemplateStagingPreflight({
        db,
        projectId:
          validated.projectId
      });

    console.log(
      'MIGRATION_MODE=STAGING_DRY_RUN'
    );

    console.log(
      `TARGET_PROJECT=${report.projectId}`
    );

    console.log(
      'PRODUCTION_ACCESS=False'
    );

    console.log(
      'STAGING_WRITES_ATTEMPTED=False'
    );

    console.log(
      'APPLY_CAPABILITY=False'
    );

    console.log(
      `PLAN_SHA256=${report.planSha256}`
    );

    console.log(
      `LEGACY_CONFIGS=${report.counts.legacyConfigs}`
    );

    console.log(
      `REFERENCED_QUESTIONS=${report.counts.referencedQuestions}`
    );

    console.log(
      `CANONICAL_TARGETS_FIRST=${report.counts.canonicalTargetsFirst}`
    );

    console.log(
      `CANONICAL_TARGETS_SECOND=${report.counts.canonicalTargetsSecond}`
    );

    console.log(
      `PLAN_CREATE=${report.planned.create}`
    );

    console.log(
      `PLAN_NO_CHANGE=${report.planned.noChange}`
    );

    console.log(
      `PLAN_CONFLICT=${report.planned.conflict}`
    );

    console.log(
      `INCONSISTENCIES=${report.planned.inconsistencyCount}`
    );

    console.log(
      `CREATE_TEMPLATES=${report.planned.createByEntity.templates}`
    );

    console.log(
      `CREATE_VERSIONS=${report.planned.createByEntity.versions}`
    );

    console.log(
      `CREATE_QUESTION_SNAPSHOTS=${report.planned.createByEntity.questionSnapshots}`
    );

    console.log(
      `SOURCE_STABLE=${report.sourceStable ? 'True' : 'False'}`
    );

    console.log(
      `TARGET_STABLE=${report.targetStable ? 'True' : 'False'}`
    );

    console.log(
      `APPLY_READY=${report.applyReady ? 'True' : 'False'}`
    );

    console.log(
      `INCONSISTENCY_CODES_JSON=${JSON.stringify(report.inconsistencyCodes)}`
    );

    console.log(
      'STAGING_PREFLIGHT=OK'
    );
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(
    `STAGING_PREFLIGHT_ERROR=${
      error?.code ||
      error?.name ||
      'UNKNOWN'
    }`
  );

  process.exitCode = 1;
});
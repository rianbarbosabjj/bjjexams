"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const crypto =
  require("node:crypto");

const {
  FieldValue
} =
  require("firebase-admin/firestore");

const {
  buildStagingPreparation
} =
  require("./legacy-v1_2-staging-gate");

const STAGING_PROJECT =
  "bjj-exams-staging";

function actionPath(action) {
  if (action.kind === "user") {
    return `users/${action.id}`;
  }

  if (action.kind === "organization") {
    return `organizations/${action.id}`;
  }

  if (action.kind === "membership") {
    return `organization_memberships/${action.id}`;
  }

  throw new Error(
    `STAGING_APPLY_BLOCKED: unsupported kind=${action.kind}`
  );
}

function allActions(plan) {
  return [
    ...(plan?.actions?.users || []),
    ...(plan?.actions?.organizations || []),
    ...(plan?.actions?.memberships || [])
  ];
}

function validateStagingApply({
  plan,
  projectId,
  expectedPlanSha256,
  approvalToken,
  expectedCreateCount
} = {}) {
  if (
    projectId !==
    STAGING_PROJECT
  ) {
    throw new Error(
      `STAGING_APPLY_BLOCKED: project=${projectId || "<EMPTY>"}`
    );
  }

  if (
    process.env
      .FIRESTORE_EMULATOR_HOST ||
    process.env
      .FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "STAGING_APPLY_BLOCKED: emulator variables present."
    );
  }

  const preparation =
    buildStagingPreparation({
      plan,
      projectId
    });

  if (
    preparation.planSha256 !==
    expectedPlanSha256
  ) {
    throw new Error(
      "STAGING_APPLY_BLOCKED: plan hash changed."
    );
  }

  if (
    preparation.approvalToken !==
    approvalToken
  ) {
    throw new Error(
      "STAGING_APPLY_BLOCKED: approval token invalid."
    );
  }

  if (
    preparation.actions.create !==
    Number(expectedCreateCount)
  ) {
    throw new Error(
      `STAGING_APPLY_BLOCKED: createCount=${preparation.actions.create}`
    );
  }

  if (
    preparation.actions.create >
    400
  ) {
    throw new Error(
      "STAGING_APPLY_BLOCKED: more than 400 creates require another migration strategy."
    );
  }

  return preparation;
}

function migrationPayload(action) {
  const desired = {
    ...action.desired
  };

  if (
    action.kind === "user" ||
    action.kind === "organization"
  ) {
    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          desired,
          "createdAt"
        )
    ) {
      desired.createdAt =
        FieldValue.serverTimestamp();
    }

    desired.updatedAt =
      FieldValue.serverTimestamp();
  }

  return desired;
}

function createRollbackReference({
  projectId,
  planSha256,
  actions
}) {
  return {
    formatVersion:
      1,

    migration:
      "legacy-v1.2",

    projectId,

    environment:
      "staging",

    executionId:
      crypto.randomUUID(),

    planSha256,

    status:
      "prepared",

    atomicSingleBatch:
      true,

    automaticRollback:
      false,

    physicalDeletesPerformed:
      false,

    entries:
      actions.map(
        action => ({
          path:
            actionPath(action),

          migrationOperation:
            "CREATE",

          previousExists:
            false,

          rollbackDisposition:
            "CREATED_BY_MIGRATION_REQUIRES_REVIEW"
        })
      )
  };
}

function writeReference(
  filePath,
  reference
) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true
    }
  );

  const temporary =
    `${filePath}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      reference,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    temporary,
    filePath
  );
}

async function applyPlanToStaging({
  db,
  plan,
  projectId,
  expectedPlanSha256,
  approvalToken,
  expectedCreateCount,
  rollbackReferencePath
} = {}) {
  if (!db) {
    throw new Error(
      "STAGING_APPLY_BLOCKED: Firestore required."
    );
  }

  const preparation =
    validateStagingApply({
      plan,
      projectId,
      expectedPlanSha256,
      approvalToken,
      expectedCreateCount
    });

  const createActions =
    allActions(plan)
      .filter(
        action =>
          action.operation ===
          "CREATE"
      );

  const noChangeCount =
    allActions(plan)
      .filter(
        action =>
          action.operation ===
          "NO_CHANGE"
      )
      .length;

  const reference =
    createRollbackReference({
      projectId,
      planSha256:
        preparation.planSha256,
      actions:
        createActions
    });

  writeReference(
    rollbackReferencePath,
    reference
  );

  if (
    createActions.length === 0
  ) {
    reference.status =
      "completed";

    reference.createdCount =
      0;

    reference.noChangeCount =
      noChangeCount;

    writeReference(
      rollbackReferencePath,
      reference
    );

    return {
      createdCount:
        0,
      noChangeCount,
      preparation,
      rollbackReference:
        reference
    };
  }

  const batch =
    db.batch();

  for (
    const action
    of createActions
  ) {
    batch.create(
      db.doc(
        actionPath(action)
      ),
      migrationPayload(
        action
      )
    );
  }

  try {
    await batch.commit();

    reference.status =
      "completed";

    reference.createdCount =
      createActions.length;

    reference.noChangeCount =
      noChangeCount;

    writeReference(
      rollbackReferencePath,
      reference
    );

    return {
      createdCount:
        createActions.length,
      noChangeCount,
      preparation,
      rollbackReference:
        reference
    };
  }
  catch (error) {
    reference.status =
      "commit_failed_or_result_unknown";

    reference.errorCode =
      String(
        error?.code ||
        "UNKNOWN"
      );

    writeReference(
      rollbackReferencePath,
      reference
    );

    throw error;
  }
}

module.exports = {
  STAGING_PROJECT,
  actionPath,
  validateStagingApply,
  createRollbackReference,
  applyPlanToStaging
};
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

const EXPECTED_EMULATOR_PROJECT =
  "demo-bjj-exams";

function isLoopbackHost(value) {
  return /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
    .test(
      String(value || "")
        .trim()
        .toLowerCase()
    );
}

function assertEmulatorWriteSafety({
  projectId,
  firestoreHost =
    process.env.FIRESTORE_EMULATOR_HOST
} = {}) {
  if (
    projectId !==
    EXPECTED_EMULATOR_PROJECT
  ) {
    throw new Error(
      `EMULATOR_WRITE_BLOCKED: project=${projectId || "<EMPTY>"}`
    );
  }

  if (
    !isLoopbackHost(
      firestoreHost
    )
  ) {
    throw new Error(
      "EMULATOR_WRITE_BLOCKED: Firestore host is not loopback."
    );
  }

  return true;
}

function actionPath(action) {
  if (
    action.kind === "user"
  ) {
    return `users/${action.id}`;
  }

  if (
    action.kind ===
      "organization"
  ) {
    return `organizations/${action.id}`;
  }

  if (
    action.kind ===
      "membership"
  ) {
    return `organization_memberships/${action.id}`;
  }

  throw new Error(
    `Unsupported migration kind: ${action.kind}`
  );
}

function allActions(plan) {
  return [
    ...(plan?.actions?.users || []),
    ...(plan?.actions?.organizations || []),
    ...(plan?.actions?.memberships || [])
  ];
}

function validatePlanForApply(plan) {
  if (
    !plan ||
    !plan.actions ||
    !Array.isArray(
      plan.inconsistencies
    )
  ) {
    throw new Error(
      "MIGRATION_PLAN_INVALID"
    );
  }

  if (
    plan.inconsistencies.length >
    0
  ) {
    throw new Error(
      `MIGRATION_PLAN_BLOCKED: inconsistencies=${plan.inconsistencies.length}`
    );
  }

  const actions =
    allActions(plan);

  const conflicts =
    actions.filter(
      action =>
        action.operation ===
        "CONFLICT"
    );

  if (
    conflicts.length >
    0
  ) {
    throw new Error(
      `MIGRATION_PLAN_BLOCKED: conflicts=${conflicts.length}`
    );
  }

  const unsupported =
    actions.filter(
      action =>
        ![
          "CREATE",
          "NO_CHANGE"
        ].includes(
          action.operation
        )
    );

  if (
    unsupported.length >
    0
  ) {
    throw new Error(
      `MIGRATION_PLAN_BLOCKED: unsupportedOperations=${unsupported.length}`
    );
  }

  return actions;
}

function migrationPayload(action) {
  const desired = {
    ...action.desired
  };

  if (
    action.kind === "user" ||
    action.kind ===
      "organization"
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
  executionId,
  projectId,
  createActions
}) {
  return {
    formatVersion:
      1,

    migration:
      "legacy-v1.2",

    executionId,

    projectId,

    environment:
      "emulator",

    status:
      "prepared",

    automaticRollback:
      false,

    physicalDeletesPerformed:
      false,

    entries:
      createActions.map(
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

function writeReferenceFile(
  filePath,
  reference
) {
  if (!filePath) {
    throw new Error(
      "ROLLBACK_REFERENCE_PATH_REQUIRED"
    );
  }

  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true
    }
  );

  const temporaryPath =
    `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(
      reference,
      null,
      2
    ),
    {
      encoding:
        "utf8",
      mode:
        0o600
    }
  );

  fs.renameSync(
    temporaryPath,
    filePath
  );
}

async function applyMigrationPlanToEmulator({
  db,
  plan,
  projectId,
  rollbackReferencePath
} = {}) {
  if (!db) {
    throw new Error(
      "FIRESTORE_REQUIRED"
    );
  }

  assertEmulatorWriteSafety({
    projectId
  });

  const actions =
    validatePlanForApply(
      plan
    );

  const createActions =
    actions.filter(
      action =>
        action.operation ===
        "CREATE"
    );

  const noChangeCount =
    actions.filter(
      action =>
        action.operation ===
        "NO_CHANGE"
    ).length;

  const executionId =
    crypto.randomUUID();

  const reference =
    createRollbackReference({
      executionId,
      projectId,
      createActions
    });

  writeReferenceFile(
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

    writeReferenceFile(
      rollbackReferencePath,
      reference
    );

    return {
      executionId,
      createdCount:
        0,
      noChangeCount,
      rollbackReference:
        reference
    };
  }

  let committedCreates =
    0;

  try {
    const chunkSize =
      400;

    for (
      let offset = 0;
      offset <
      createActions.length;
      offset += chunkSize
    ) {
      const chunk =
        createActions.slice(
          offset,
          offset + chunkSize
        );

      const batch =
        db.batch();

      for (
        const action
        of chunk
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

      await batch.commit();

      committedCreates +=
        chunk.length;

      reference.status =
        "in_progress";

      reference.createdCount =
        committedCreates;

      writeReferenceFile(
        rollbackReferencePath,
        reference
      );
    }

    reference.status =
      "completed";

    reference.createdCount =
      committedCreates;

    reference.noChangeCount =
      noChangeCount;

    writeReferenceFile(
      rollbackReferencePath,
      reference
    );

    return {
      executionId,
      createdCount:
        committedCreates,
      noChangeCount,
      rollbackReference:
        reference
    };
  } catch (error) {
    reference.status =
      "failed_or_partial";

    reference.createdCount =
      committedCreates;

    reference.errorCode =
      String(
        error?.code ||
        "UNKNOWN"
      );

    writeReferenceFile(
      rollbackReferencePath,
      reference
    );

    throw error;
  }
}

module.exports = {
  EXPECTED_EMULATOR_PROJECT,
  isLoopbackHost,
  assertEmulatorWriteSafety,
  actionPath,
  validatePlanForApply,
  createRollbackReference,
  applyMigrationPlanToEmulator
};
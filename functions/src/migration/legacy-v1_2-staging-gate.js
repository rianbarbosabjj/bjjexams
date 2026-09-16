"use strict";

const crypto =
  require("node:crypto");

const EXPECTED_STAGING_PROJECT =
  "bjj-exams-staging";

function assertStagingEnvironment({
  projectId,
  firestoreHost =
    process.env.FIRESTORE_EMULATOR_HOST,
  authHost =
    process.env.FIREBASE_AUTH_EMULATOR_HOST
} = {}) {
  if (
    projectId !==
    EXPECTED_STAGING_PROJECT
  ) {
    throw new Error(
      `STAGING_GATE_BLOCKED: project=${projectId || "<EMPTY>"}`
    );
  }

  if (
    firestoreHost ||
    authHost
  ) {
    throw new Error(
      "STAGING_GATE_BLOCKED: emulator variables are present."
    );
  }

  return true;
}

function allActions(plan) {
  return [
    ...(plan?.actions?.users || []),
    ...(plan?.actions?.organizations || []),
    ...(plan?.actions?.memberships || [])
  ];
}

function validatePlanForStagingPreparation(
  plan
) {
  if (
    !plan ||
    !plan.actions ||
    !Array.isArray(
      plan.inconsistencies
    )
  ) {
    throw new Error(
      "STAGING_GATE_PLAN_INVALID"
    );
  }

  if (
    plan.inconsistencies.length > 0
  ) {
    throw new Error(
      `STAGING_GATE_BLOCKED: inconsistencies=${plan.inconsistencies.length}`
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
    conflicts.length > 0
  ) {
    throw new Error(
      `STAGING_GATE_BLOCKED: conflicts=${conflicts.length}`
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
    unsupported.length > 0
  ) {
    throw new Error(
      `STAGING_GATE_BLOCKED: unsupported=${unsupported.length}`
    );
  }

  return actions;
}

function canonicalize(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }

  if (
    value instanceof Date
  ) {
    return {
      __type:
        "Date",
      value:
        value.toISOString()
    };
  }

  if (
    typeof value ===
      "object" &&
    typeof value.seconds ===
      "number" &&
    typeof value.nanoseconds ===
      "number"
  ) {
    return {
      __type:
        "Timestamp",
      seconds:
        value.seconds,
      nanoseconds:
        value.nanoseconds
    };
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonicalize
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    const result = {};

    for (
      const key
      of Object.keys(value)
        .sort()
    ) {
      if (
        value[key] !==
        undefined
      ) {
        result[key] =
          canonicalize(
            value[key]
          );
      }
    }

    return result;
  }

  return value;
}

function canonicalPlanView(plan) {
  const actions =
    validatePlanForStagingPreparation(
      plan
    );

  return actions
    .map(action => ({
      kind:
        action.kind,
      id:
        action.id,
      operation:
        action.operation,
      desired:
        canonicalize(
          action.desired
        )
    }))
    .sort((left, right) => {
      const a =
        `${left.kind}:${left.id}`;

      const b =
        `${right.kind}:${right.id}`;

      return a.localeCompare(b);
    });
}

function planSha256(plan) {
  const canonical =
    canonicalPlanView(
      plan
    );

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        canonical
      )
    )
    .digest("hex");
}

function countByKind(
  actions,
  kind,
  operation
) {
  return actions.filter(
    action =>
      action.kind === kind &&
      action.operation ===
        operation
  ).length;
}

function buildStagingPreparation({
  plan,
  projectId
} = {}) {
  assertStagingEnvironment({
    projectId
  });

  const actions =
    validatePlanForStagingPreparation(
      plan
    );

  const digest =
    planSha256(
      plan
    );

  const createCount =
    actions.filter(
      action =>
        action.operation ===
        "CREATE"
    ).length;

  const noChangeCount =
    actions.filter(
      action =>
        action.operation ===
        "NO_CHANGE"
    ).length;

  const approvalToken =
    `APPLY_STAGING_LEGACY_V1_2_${digest
      .slice(0, 16)
      .toUpperCase()}`;

  return {
    formatVersion:
      1,

    migration:
      "legacy-v1.2",

    projectId,

    mode:
      "PREPARE_ONLY",

    planSha256:
      digest,

    approvalToken,

    actions: {
      total:
        actions.length,

      create:
        createCount,

      noChange:
        noChangeCount,

      usersToCreate:
        countByKind(
          actions,
          "user",
          "CREATE"
        ),

      organizationsToCreate:
        countByKind(
          actions,
          "organization",
          "CREATE"
        ),

      membershipsToCreate:
        countByKind(
          actions,
          "membership",
          "CREATE"
        )
    },

    inconsistencies:
      0,

    conflicts:
      0,

    physicalDeletesPlanned:
      0,

    stagingWritesAttempted:
      false,

    applyCapability:
      false
  };
}

module.exports = {
  EXPECTED_STAGING_PROJECT,
  assertStagingEnvironment,
  validatePlanForStagingPreparation,
  canonicalize,
  canonicalPlanView,
  planSha256,
  buildStagingPreparation
};
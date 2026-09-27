"use strict";

const assert =
  require("assert");

const {
  OPERATIONAL_EXAM_VIEW_FIELDS,
  EXAM_SUMMARY_MODES,

  EXAM_SESSION_STATUSES,
  EXAM_REGISTRATION_STATUSES,
  EXAM_ATTEMPT_STATUSES,
  EXAM_RESULT_OUTCOMES,
  EXAM_CERTIFICATE_STATUSES,

  AdminExamModelError,

  normalizeCanonicalToken,
  normalizeExamSummaryMode,

  buildExamTotalSummary,
  buildExamRegistrationCounts,
  buildExamAttemptCounts,
  buildExamResultCounts,
  buildExamCertificateCounts,
  buildExamOrganizationSummary,
  buildOperationalExamView
} = require(
  "../functions/src/admin/admin-exam-models"
);

function baseSession() {
  return {
    organizationId:
      "org-1",

    responsibleInstructorId:
      "instructor-secret",

    targetBelt:
      "Azul",

    templateId:
      "template-secret",

    templateVersionId:
      "version-secret",

    status:
      "ready",

    priceCents:
      19900,

    currency:
      "BRL",

    financialRuleId:
      "financial-secret",

    providerPaymentId:
      "provider-secret",

    scheduledAt:
      "scheduled-at",

    correctAnswer:
      "A",

    answers: {
      "q-1":
        "A"
    }
  };
}

function main() {
  assert.deepStrictEqual(
    OPERATIONAL_EXAM_VIEW_FIELDS,
    [
      "sessionId",
      "organizationSummary",
      "targetBelt",
      "scheduledAt",
      "status",
      "registrationCounts",
      "attemptCounts",
      "resultCounts",
      "certificateCounts"
    ]
  );

  assert.deepStrictEqual(
    EXAM_SUMMARY_MODES,
    [
      "total",
      "full"
    ]
  );

  assert.deepStrictEqual(
    EXAM_SESSION_STATUSES,
    [
      "draft",
      "candidates_selected",
      "awaiting_payment",
      "ready",
      "cancelled",
      "archived"
    ]
  );

  assert.strictEqual(
    EXAM_REGISTRATION_STATUSES.length,
    10
  );

  assert.deepStrictEqual(
    EXAM_ATTEMPT_STATUSES,
    [
      "in_progress",
      "submitted",
      "invalidated"
    ]
  );

  assert.deepStrictEqual(
    EXAM_RESULT_OUTCOMES,
    [
      "passed",
      "failed"
    ]
  );

  assert.deepStrictEqual(
    EXAM_CERTIFICATE_STATUSES,
    [
      "valid",
      "revoked"
    ]
  );

  assert.strictEqual(
    normalizeCanonicalToken(
      " READY ",
      EXAM_SESSION_STATUSES
    ),
    "ready"
  );

  assert.strictEqual(
    normalizeCanonicalToken(
      "unknown",
      EXAM_SESSION_STATUSES
    ),
    null
  );

  assert.strictEqual(
    normalizeExamSummaryMode(),
    "full"
  );

  assert.strictEqual(
    normalizeExamSummaryMode(
      " TOTAL "
    ),
    "total"
  );

  assert.throws(
    () =>
      normalizeExamSummaryMode(
        "unknown"
      ),
    error =>
      error instanceof
        AdminExamModelError &&
      error.code ===
        "ADMIN_EXAM_SUMMARY_MODE_INVALID"
  );

  assert.deepStrictEqual(
    buildExamTotalSummary(
      {
        total:
          7,

        passed:
          999
      },
      "result"
    ),
    {
      total:
        7
    }
  );

  assert.deepStrictEqual(
    buildExamRegistrationCounts({
      total:
        11,

      selected:
        1,

      awaiting_payment:
        1,

      authorized:
        1,

      started:
        1,

      submitted:
        1,

      passed:
        1,

      failed:
        1,

      certified:
        1,

      cancelled:
        1,

      needs_reconciliation:
        1
    }),
    {
      total:
        11,

      selected:
        1,

      awaitingPayment:
        1,

      authorized:
        1,

      started:
        1,

      submitted:
        1,

      passed:
        1,

      failed:
        1,

      certified:
        1,

      cancelled:
        1,

      needsReconciliation:
        1
    }
  );

  // Unknown/legacy statuses may make total larger than
  // the sum of known canonical statuses.
  assert.deepStrictEqual(
    buildExamAttemptCounts({
      total:
        4,

      in_progress:
        1,

      submitted:
        1,

      invalidated:
        1
    }),
    {
      total:
        4,

      inProgress:
        1,

      submitted:
        1,

      invalidated:
        1
    }
  );

  assert.deepStrictEqual(
    buildExamResultCounts({
      total:
        2,

      passed:
        1,

      failed:
        1
    }),
    {
      total:
        2,

      passed:
        1,

      failed:
        1
    }
  );

  assert.deepStrictEqual(
    buildExamCertificateCounts({
      total:
        2,

      valid:
        1,

      revoked:
        1
    }),
    {
      total:
        2,

      valid:
        1,

      revoked:
        1
    }
  );

  assert.throws(
    () =>
      buildExamResultCounts({
        total:
          1,

        passed:
          1,

        failed:
          1
      }),
    error =>
      error instanceof
        AdminExamModelError &&
      error.code ===
        "ADMIN_EXAM_COUNT_INCONSISTENT"
  );

  assert.deepStrictEqual(
    buildExamOrganizationSummary(
      "org-1",
      {
        nome:
          " Academia Segura ",

        cpf:
          "must-not-leak",

        asaas_wallet_id:
          "must-not-leak"
      }
    ),
    {
      organizationId:
        "org-1",

      name:
        "Academia Segura"
    }
  );

  const compactView =
    buildOperationalExamView({
      sessionId:
        "session-1",

      session:
        baseSession(),

      organization: {
        name:
          "Academia Exemplo",

        cpf:
          "secret-cpf"
      },

      summaryMode:
        "total",

      registrationCounts: {
        total:
          8
      },

      attemptCounts: {
        total:
          4
      },

      resultCounts: {
        total:
          3
      },

      certificateCounts: {
        total:
          2
      }
    });

  assert.deepStrictEqual(
    compactView.registrationCounts,
    {
      total:
        8
    }
  );

  assert.deepStrictEqual(
    compactView.attemptCounts,
    {
      total:
        4
    }
  );

  assert.deepStrictEqual(
    compactView.resultCounts,
    {
      total:
        3
    }
  );

  assert.deepStrictEqual(
    compactView.certificateCounts,
    {
      total:
        2
    }
  );

  const fullView =
    buildOperationalExamView({
      sessionId:
        "session-1",

      session:
        baseSession(),

      organization: {
        name:
          "Academia Exemplo",

        cpf:
          "secret-cpf",

        asaas_wallet_id:
          "secret-wallet"
      },

      summaryMode:
        "full",

      registrationCounts: {
        total:
          3,

        authorized:
          1,

        started:
          1,

        certified:
          1
      },

      attemptCounts: {
        total:
          2,

        in_progress:
          1,

        submitted:
          1
      },

      resultCounts: {
        total:
          1,

        passed:
          1
      },

      certificateCounts: {
        total:
          1,

        valid:
          1
      }
    });

  assert.deepStrictEqual(
    Object.keys(
      fullView
    ),
    OPERATIONAL_EXAM_VIEW_FIELDS
  );

  assert.strictEqual(
    fullView.registrationCounts
      .authorized,
    1
  );

  assert.strictEqual(
    fullView.attemptCounts
      .inProgress,
    1
  );

  assert.strictEqual(
    fullView.resultCounts
      .passed,
    1
  );

  assert.strictEqual(
    fullView.certificateCounts
      .valid,
    1
  );

  const serialized =
    JSON.stringify(
      fullView
    );

  for (
    const forbidden
    of [
      "responsibleInstructorId",
      "templateId",
      "templateVersionId",
      "priceCents",
      "currency",
      "financialRuleId",
      "providerPaymentId",
      "correctAnswer",
      "answers",
      "cpf",
      "wallet",
      "asaas"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `OperationalExamView leaked ${forbidden}`
    );
  }

  assert.throws(
    () =>
      buildOperationalExamView({
        sessionId:
          "bad/id",

        session:
          baseSession()
      }),
    error =>
      error instanceof
        AdminExamModelError &&
      error.code ===
        "ADMIN_EXAM_IDENTIFIER_INVALID"
  );

  assert.throws(
    () =>
      buildOperationalExamView({
        sessionId:
          "session-1",

        session: {
          ...baseSession(),

          organizationId:
            null
        }
      }),
    error =>
      error instanceof
        AdminExamModelError &&
      error.code ===
        "ADMIN_EXAM_ORGANIZATION_INVALID"
  );

  console.log(
    "MARCO8_OPERATIONAL_EXAM_VIEW_FIELDS=9/9"
  );

  console.log(
    "MARCO8_EXAM_SUMMARY_MODES=2/2"
  );

  console.log(
    "MARCO8_EXAM_LIST_SUMMARIES=TOTAL_ONLY"
  );

  console.log(
    "MARCO8_EXAM_DETAIL_SUMMARIES=FULL"
  );

  console.log(
    "MARCO8_EXAM_COUNT_UNKNOWN_STATUS_TOLERANCE=PASSED"
  );

  console.log(
    "MARCO8_EXAM_ORGANIZATION_SUMMARY=SANITIZED"
  );

  console.log(
    "MARCO8_EXAM_ANSWER_KEY_EXPOSURE=False"
  );

  console.log(
    "MARCO8_EXAM_FINANCIAL_FIELDS_EXPOSURE=False"
  );

  console.log(
    "MARCO8_ADMIN_EXAM_MODELS=PASSED"
  );
}

main();

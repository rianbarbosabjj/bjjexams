"use strict";

const {
  EXAM_SESSION_STATUSES
} = require(
  "../exams/exam-session-domain"
);

const {
  EXAM_REGISTRATION_STATUSES
} = require(
  "../exams/exam-registration-domain"
);

const {
  EXAM_ATTEMPT_STATUSES
} = require(
  "../exams/exam-attempt-domain"
);

const {
  EXAM_RESULT_OUTCOMES
} = require(
  "../exams/exam-result-domain"
);

const {
  EXAM_CERTIFICATE_STATUSES
} = require(
  "../exams/exam-certificate-domain"
);

const OPERATIONAL_EXAM_VIEW_FIELDS =
  Object.freeze([
    "sessionId",
    "organizationSummary",
    "targetBelt",
    "scheduledAt",
    "status",
    "registrationCounts",
    "attemptCounts",
    "resultCounts",
    "certificateCounts"
  ]);

const EXAM_SUMMARY_MODES =
  Object.freeze([
    "total",
    "full"
  ]);

class AdminExamModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminExamModelError";

    this.code =
      code;
  }
}

function cleanText(
  value,
  maxLength = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength
      )
    : null;
}

function cleanIdentifier(
  value
) {
  const id =
    cleanText(
      value,
      128
    );

  if (
    !id ||
    id.includes("/")
  ) {
    return null;
  }

  return id;
}

function normalizeCanonicalToken(
  value,
  allowedValues
) {
  const normalized =
    cleanText(
      value,
      80
    )
      ?.toLowerCase() ||
    null;

  if (
    !normalized ||
    !allowedValues.includes(
      normalized
    )
  ) {
    return null;
  }

  return normalized;
}

function normalizeCount(
  value,
  field
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number < 0
  ) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_COUNT_INVALID",
      `${field} count is invalid.`
    );
  }

  return number;
}

function assertCanonicalCounts(
  total,
  counts,
  field
) {
  const canonicalSum =
    Object.values(
      counts
    )
      .reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      );

  if (
    canonicalSum >
    total
  ) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_COUNT_INCONSISTENT",
      `${field} canonical counts exceed total.`
    );
  }

  return true;
}

function normalizeExamSummaryMode(
  value
) {
  const normalized =
    cleanText(
      value ?? "full",
      20
    )
      ?.toLowerCase();

  if (
    !EXAM_SUMMARY_MODES.includes(
      normalized
    )
  ) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_SUMMARY_MODE_INVALID",
      "Exam summary mode is invalid."
    );
  }

  return normalized;
}

function buildExamTotalSummary(
  input = {},
  field = "summary"
) {
  return Object.freeze({
    total:
      normalizeCount(
        input.total ?? 0,
        `${field}.total`
      )
  });
}

function buildExamRegistrationCounts(
  input = {}
) {
  const total =
    normalizeCount(
      input.total ?? 0,
      "registration.total"
    );

  const canonical = {
    selected:
      normalizeCount(
        input.selected ?? 0,
        "registration.selected"
      ),

    awaitingPayment:
      normalizeCount(
        input.awaiting_payment ??
          input.awaitingPayment ??
          0,
        "registration.awaitingPayment"
      ),

    authorized:
      normalizeCount(
        input.authorized ?? 0,
        "registration.authorized"
      ),

    started:
      normalizeCount(
        input.started ?? 0,
        "registration.started"
      ),

    submitted:
      normalizeCount(
        input.submitted ?? 0,
        "registration.submitted"
      ),

    passed:
      normalizeCount(
        input.passed ?? 0,
        "registration.passed"
      ),

    failed:
      normalizeCount(
        input.failed ?? 0,
        "registration.failed"
      ),

    certified:
      normalizeCount(
        input.certified ?? 0,
        "registration.certified"
      ),

    cancelled:
      normalizeCount(
        input.cancelled ?? 0,
        "registration.cancelled"
      ),

    needsReconciliation:
      normalizeCount(
        input.needs_reconciliation ??
          input.needsReconciliation ??
          0,
        "registration.needsReconciliation"
      )
  };

  assertCanonicalCounts(
    total,
    canonical,
    "registration"
  );

  return Object.freeze({
    total,
    ...canonical
  });
}

function buildExamAttemptCounts(
  input = {}
) {
  const total =
    normalizeCount(
      input.total ?? 0,
      "attempt.total"
    );

  const canonical = {
    inProgress:
      normalizeCount(
        input.in_progress ??
          input.inProgress ??
          0,
        "attempt.inProgress"
      ),

    submitted:
      normalizeCount(
        input.submitted ?? 0,
        "attempt.submitted"
      ),

    invalidated:
      normalizeCount(
        input.invalidated ?? 0,
        "attempt.invalidated"
      )
  };

  assertCanonicalCounts(
    total,
    canonical,
    "attempt"
  );

  return Object.freeze({
    total,
    ...canonical
  });
}

function buildExamResultCounts(
  input = {}
) {
  const total =
    normalizeCount(
      input.total ?? 0,
      "result.total"
    );

  const canonical = {
    passed:
      normalizeCount(
        input.passed ?? 0,
        "result.passed"
      ),

    failed:
      normalizeCount(
        input.failed ?? 0,
        "result.failed"
      )
  };

  assertCanonicalCounts(
    total,
    canonical,
    "result"
  );

  return Object.freeze({
    total,
    ...canonical
  });
}

function buildExamCertificateCounts(
  input = {}
) {
  const total =
    normalizeCount(
      input.total ?? 0,
      "certificate.total"
    );

  const canonical = {
    valid:
      normalizeCount(
        input.valid ?? 0,
        "certificate.valid"
      ),

    revoked:
      normalizeCount(
        input.revoked ?? 0,
        "certificate.revoked"
      )
  };

  assertCanonicalCounts(
    total,
    canonical,
    "certificate"
  );

  return Object.freeze({
    total,
    ...canonical
  });
}

function buildExamOrganizationSummary(
  organizationId,
  organization = {}
) {
  const id =
    cleanIdentifier(
      organizationId
    );

  if (!id) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_ORGANIZATION_INVALID",
      "organizationId is invalid."
    );
  }

  const safeOrganization =
    organization &&
    typeof organization ===
      "object" &&
    !Array.isArray(
      organization
    )
      ? organization
      : {};

  const name =
    cleanText(
      safeOrganization.name ??
      safeOrganization.nome ??
      safeOrganization.organizationName,
      200
    );

  return Object.freeze({
    organizationId:
      id,

    name
  });
}

function buildOperationalExamView(
  input = {}
) {
  const session =
    input.session &&
    typeof input.session ===
      "object" &&
    !Array.isArray(
      input.session
    )
      ? input.session
      : {};

  const sessionId =
    cleanIdentifier(
      input.sessionId
    );

  if (!sessionId) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_IDENTIFIER_INVALID",
      "sessionId is invalid."
    );
  }

  const organizationId =
    cleanIdentifier(
      session.organizationId
    );

  if (!organizationId) {
    throw new AdminExamModelError(
      "ADMIN_EXAM_ORGANIZATION_INVALID",
      "Exam session organization is invalid."
    );
  }

  const summaryMode =
    normalizeExamSummaryMode(
      input.summaryMode
    );

  const compact =
    summaryMode ===
      "total";

  return Object.freeze({
    sessionId,

    organizationSummary:
      buildExamOrganizationSummary(
        organizationId,
        input.organization
      ),

    targetBelt:
      cleanText(
        session.targetBelt,
        80
      ),

    scheduledAt:
      session.scheduledAt ??
      null,

    status:
      normalizeCanonicalToken(
        session.status,
        EXAM_SESSION_STATUSES
      ),

    registrationCounts:
      compact
        ? buildExamTotalSummary(
            input.registrationCounts,
            "registration"
          )
        : buildExamRegistrationCounts(
            input.registrationCounts
          ),

    attemptCounts:
      compact
        ? buildExamTotalSummary(
            input.attemptCounts,
            "attempt"
          )
        : buildExamAttemptCounts(
            input.attemptCounts
          ),

    resultCounts:
      compact
        ? buildExamTotalSummary(
            input.resultCounts,
            "result"
          )
        : buildExamResultCounts(
            input.resultCounts
          ),

    certificateCounts:
      compact
        ? buildExamTotalSummary(
            input.certificateCounts,
            "certificate"
          )
        : buildExamCertificateCounts(
            input.certificateCounts
          )
  });
}

module.exports = {
  OPERATIONAL_EXAM_VIEW_FIELDS,
  EXAM_SUMMARY_MODES,

  EXAM_SESSION_STATUSES,
  EXAM_REGISTRATION_STATUSES,
  EXAM_ATTEMPT_STATUSES,
  EXAM_RESULT_OUTCOMES,
  EXAM_CERTIFICATE_STATUSES,

  AdminExamModelError,

  cleanText,
  cleanIdentifier,
  normalizeCanonicalToken,
  normalizeCount,
  assertCanonicalCounts,
  normalizeExamSummaryMode,

  buildExamTotalSummary,
  buildExamRegistrationCounts,
  buildExamAttemptCounts,
  buildExamResultCounts,
  buildExamCertificateCounts,
  buildExamOrganizationSummary,
  buildOperationalExamView
};

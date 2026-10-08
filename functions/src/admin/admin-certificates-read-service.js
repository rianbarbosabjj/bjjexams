"use strict";

const {
  FieldPath
} = require(
  "firebase-admin/firestore"
);

const {
  normalizeBelt
} = require(
  "../exams/exam-session-domain"
);

const {
  EXAM_CERTIFICATE_STATUSES
} = require(
  "../exams/exam-certificate-domain"
);

const {
  buildOperationalCertificateView
} = require(
  "./admin-certificate-models"
);

const CERTIFICATE_COLLECTION =
  "exam_certificates";

const DEFAULT_CERTIFICATES_LIMIT =
  20;

const MAX_CERTIFICATES_LIMIT =
  25;

const CERTIFICATE_CURSOR_VERSION =
  1;

const CERTIFICATE_SCAN_BATCH_SIZE =
  MAX_CERTIFICATES_LIMIT + 1;

const CERTIFICATE_MAX_SCAN_DOCS =
  CERTIFICATE_SCAN_BATCH_SIZE * 10;

class AdminCertificatesReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminCertificatesReadError";

    this.code =
      code;
  }
}

function text(
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

function requiredIdentifier(
  value,
  field
) {
  const identifier =
    text(
      value,
      128
    );

  if (
    !identifier ||
    identifier.includes("/")
  ) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return identifier;
}

function readCertificatesLimit(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_CERTIFICATES_LIMIT;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed < 1 ||
    parsed >
      MAX_CERTIFICATES_LIMIT
  ) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_LIMIT_INVALID",
      `limit must be an integer between 1 and ${MAX_CERTIFICATES_LIMIT}.`
    );
  }

  return parsed;
}

function optionalIdentifierFilter(
  value,
  field
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requiredIdentifier(
    value,
    field
  );
}

function optionalStatusFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    text(
      value,
      40
    )
      ?.toLowerCase();

  if (
    !normalized ||
    !EXAM_CERTIFICATE_STATUSES
      .includes(
        normalized
      )
  ) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_FILTER_INVALID",
      "status filter is invalid."
    );
  }

  return normalized;
}

function optionalTargetBeltFilter(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    normalizeBelt(
      value
    );

  if (!normalized) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_FILTER_INVALID",
      "targetBelt filter is invalid."
    );
  }

  return normalized;
}

function normalizeCertificateFilters(
  input = {}
) {
  return Object.freeze({
    status:
      optionalStatusFilter(
        input.status
      ),

    organizationId:
      optionalIdentifierFilter(
        input.organizationId,
        "organizationId"
      ),

    targetBelt:
      optionalTargetBeltFilter(
        input.targetBelt
      )
  });
}

function matchesCertificateFilters(
  certificate,
  filters = {}
) {
  const safe =
    certificate &&
    typeof certificate ===
      "object" &&
    !Array.isArray(
      certificate
    )
      ? certificate
      : {};

  if (
    filters.status &&
    text(
      safe.status,
      40
    )
      ?.toLowerCase() !==
      filters.status
  ) {
    return false;
  }

  if (
    filters.organizationId &&
    text(
      safe.organizationId,
      128
    ) !==
      filters.organizationId
  ) {
    return false;
  }

  if (
    filters.targetBelt &&
    normalizeBelt(
      safe.targetBelt
    ) !==
      filters.targetBelt
  ) {
    return false;
  }

  return true;
}

function encodeCertificateCursor(
  certificateIdInput
) {
  const certificateId =
    requiredIdentifier(
      certificateIdInput,
      "certificateId"
    );

  return Buffer
    .from(
      JSON.stringify({
        v:
          CERTIFICATE_CURSOR_VERSION,

        lastCertificateId:
          certificateId
      }),
      "utf8"
    )
    .toString(
      "base64url"
    );
}

function decodeCertificateCursor(
  value
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value !==
      "string" ||
    value.length > 512
  ) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_CURSOR_INVALID",
      "cursor is invalid."
    );
  }

  try {
    const decoded =
      JSON.parse(
        Buffer
          .from(
            value,
            "base64url"
          )
          .toString(
            "utf8"
          )
      );

    if (
      decoded?.v !==
        CERTIFICATE_CURSOR_VERSION
    ) {
      throw new Error(
        "version"
      );
    }

    return requiredIdentifier(
      decoded.lastCertificateId,
      "lastCertificateId"
    );
  }
  catch (_) {
    throw new AdminCertificatesReadError(
      "ADMIN_CERTIFICATES_CURSOR_INVALID",
      "cursor is invalid."
    );
  }
}

function createAdminCertificatesReadService(
  dependencies = {}
) {
  const {
    db,

    documentIdField =
      FieldPath.documentId()
  } = dependencies;

  if (
    !db ||
    typeof db.collection !==
      "function" ||
    typeof db.doc !==
      "function"
  ) {
    throw new TypeError(
      "Admin certificates read service requires Firestore."
    );
  }

  async function listCertificates(
    input = {}
  ) {
    const limit =
      readCertificatesLimit(
        input.limit
      );

    const filters =
      normalizeCertificateFilters(
        input
      );

    const afterCertificateId =
      decodeCertificateCursor(
        input.cursor
      );

    const matchedDocs = [];

    let scanAfterId =
      afterCertificateId;

    let resumeAfterId =
      afterCertificateId;

    let scannedDocs = 0;

    let sourceExhausted =
      false;

    let hasMoreMatches =
      false;

    while (
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs <
        CERTIFICATE_MAX_SCAN_DOCS
    ) {
      const remainingBudget =
        CERTIFICATE_MAX_SCAN_DOCS -
        scannedDocs;

      const batchLimit =
        Math.min(
          CERTIFICATE_SCAN_BATCH_SIZE,
          remainingBudget
        );

      let query =
        db
          .collection(
            CERTIFICATE_COLLECTION
          )
          .orderBy(
            documentIdField
          );

      if (scanAfterId) {
        query =
          query.startAfter(
            scanAfterId
          );
      }

      const snapshot =
        await query
          .limit(
            batchLimit
          )
          .get();

      const docs =
        Array.isArray(
          snapshot?.docs
        )
          ? snapshot.docs
          : [];

      if (
        docs.length === 0
      ) {
        sourceExhausted =
          true;

        break;
      }

      scannedDocs +=
        docs.length;

      for (
        const document
        of docs
      ) {
        const certificate =
          document.data() ||
          {};

        const matches =
          matchesCertificateFilters(
            certificate,
            filters
          );

        if (
          matches &&
          matchedDocs.length >=
            limit
        ) {
          hasMoreMatches =
            true;

          break;
        }

        if (matches) {
          matchedDocs.push(
            document
          );
        }

        /*
         * The cursor advances only across documents actually consumed.
         * The first extra matching certificate is intentionally left
         * unread for the next page, preventing skipped matches.
         */
        resumeAfterId =
          document.id;
      }

      if (hasMoreMatches) {
        break;
      }

      if (
        docs.length <
          batchLimit
      ) {
        sourceExhausted =
          true;

        break;
      }

      scanAfterId =
        resumeAfterId;
    }

    const scanLimitReached =
      !sourceExhausted &&
      !hasMoreMatches &&
      scannedDocs >=
        CERTIFICATE_MAX_SCAN_DOCS;

    const items =
      matchedDocs.map(
        document =>
          buildOperationalCertificateView({
            certificateId:
              document.id,

            certificate:
              document.data() ||
              {}
          })
      );

    const shouldContinue =
      hasMoreMatches ||
      scanLimitReached;

    return Object.freeze({
      limit,

      items:
        Object.freeze(
          items
        ),

      nextCursor:
        shouldContinue &&
        resumeAfterId
          ? encodeCertificateCursor(
              resumeAfterId
            )
          : null
    });
  }

  async function getCertificate(
    input = {}
  ) {
    const certificateId =
      requiredIdentifier(
        input.certificateId,
        "certificateId"
      );

    const reference =
      db.doc(
        `${CERTIFICATE_COLLECTION}/${certificateId}`
      );

    const snapshot =
      await reference.get();

    if (
      !snapshot ||
      snapshot.exists !== true
    ) {
      throw new AdminCertificatesReadError(
        "ADMIN_CERTIFICATE_NOT_FOUND",
        "Certificate was not found."
      );
    }

    return buildOperationalCertificateView({
      certificateId,

      certificate:
        snapshot.data() ||
        {}
    });
  }

  return Object.freeze({
    listCertificates,
    getCertificate
  });
}

module.exports = {
  CERTIFICATE_COLLECTION,
  DEFAULT_CERTIFICATES_LIMIT,
  MAX_CERTIFICATES_LIMIT,
  CERTIFICATE_CURSOR_VERSION,
  CERTIFICATE_SCAN_BATCH_SIZE,
  CERTIFICATE_MAX_SCAN_DOCS,

  EXAM_CERTIFICATE_STATUSES,

  AdminCertificatesReadError,

  text,
  requiredIdentifier,
  readCertificatesLimit,
  optionalIdentifierFilter,
  optionalStatusFilter,
  optionalTargetBeltFilter,
  normalizeCertificateFilters,
  matchesCertificateFilters,

  encodeCertificateCursor,
  decodeCertificateCursor,

  createAdminCertificatesReadService
};
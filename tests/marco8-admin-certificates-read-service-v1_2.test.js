"use strict";

const assert =
  require("assert");

const {
  buildExamCertificate,
  examCertificateDocumentId
} = require(
  "../functions/src/exams/exam-certificate-domain"
);

const {
  CERTIFICATE_COLLECTION,
  DEFAULT_CERTIFICATES_LIMIT,
  MAX_CERTIFICATES_LIMIT,
  CERTIFICATE_CURSOR_VERSION,
  CERTIFICATE_SCAN_BATCH_SIZE,
  CERTIFICATE_MAX_SCAN_DOCS,

  AdminCertificatesReadError,

  encodeCertificateCursor,
  decodeCertificateCursor,

  createAdminCertificatesReadService
} = require(
  "../functions/src/admin/admin-certificates-read-service"
);

function buildCertificateFor(
  resultId,
  overrides = {}
) {
  const certificate =
    buildExamCertificate({
      registrationId:
        `registration-${resultId}`,

      resultId,

      attemptId:
        `attempt-${resultId}`,

      sessionId:
        `session-${resultId}`,

      organizationId:
        "organization-default",

      studentId:
        `student-${resultId}`,

      instructorId:
        "instructor-1",

      templateId:
        "template-1",

      templateVersionId:
        "v1",

      targetBelt:
        "Branca",

      scoreBps:
        7000,

      correctCount:
        7,

      totalQuestions:
        10,

      resultFinalizedAt:
        new Date(
          "2026-09-20T12:00:00.000Z"
        ),

      studentName:
        `Aluno ${resultId}`,

      organizationName:
        "Academia Default",

      instructorName:
        "Professor Teste",

      issuedAt:
        new Date(
          "2026-09-20T12:05:00.000Z"
        ),

      issuedBy:
        `student-${resultId}`,

      ...overrides
    });

  return {
    id:
      examCertificateDocumentId(
        resultId
      ),

    certificate
  };
}

function createFakeDb(
  documents
) {
  const sorted =
    documents
      .slice()
      .sort(
        (
          left,
          right
        ) =>
          left.id.localeCompare(
            right.id
          )
      );

  const queryLog = [];

  function makeSnapshot(
    document
  ) {
    return {
      id:
        document.id,

      exists:
        true,

      data() {
        return {
          ...document.certificate
        };
      }
    };
  }

  function queryState(
    afterId = null,
    limitValue = null
  ) {
    return {
      orderBy() {
        return this;
      },

      startAfter(
        id
      ) {
        return queryState(
          id,
          limitValue
        );
      },

      limit(
        value
      ) {
        return queryState(
          afterId,
          value
        );
      },

      async get() {
        let selected =
          sorted;

        if (afterId) {
          selected =
            selected.filter(
              document =>
                document.id >
                  afterId
            );
        }

        const effectiveLimit =
          Number.isSafeInteger(
            limitValue
          )
            ? limitValue
            : selected.length;

        const page =
          selected.slice(
            0,
            effectiveLimit
          );

        queryLog.push({
          afterId,
          limit:
            effectiveLimit,
          returned:
            page.length
        });

        return {
          docs:
            page.map(
              makeSnapshot
            )
        };
      }
    };
  }

  return {
    queryLog,

    collection(
      name
    ) {
      assert.strictEqual(
        name,
        CERTIFICATE_COLLECTION
      );

      return queryState();
    },

    doc(
      path
    ) {
      const prefix =
        `${CERTIFICATE_COLLECTION}/`;

      assert.ok(
        path.startsWith(
          prefix
        )
      );

      const id =
        path.slice(
          prefix.length
        );

      return {
        async get() {
          const document =
            sorted.find(
              item =>
                item.id ===
                  id
            );

          if (!document) {
            return {
              id,
              exists:
                false,
              data() {
                return undefined;
              }
            };
          }

          return makeSnapshot(
            document
          );
        }
      };
    }
  };
}

async function expectReadError(
  operation,
  expectedCode
) {
  let captured = null;

  try {
    await operation();
  }
  catch (error) {
    captured =
      error;
  }

  assert.ok(
    captured instanceof
      AdminCertificatesReadError
  );

  assert.strictEqual(
    captured.code,
    expectedCode
  );
}

async function main() {
  assert.strictEqual(
    CERTIFICATE_COLLECTION,
    "exam_certificates"
  );

  assert.strictEqual(
    DEFAULT_CERTIFICATES_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_CERTIFICATES_LIMIT,
    25
  );

  assert.strictEqual(
    CERTIFICATE_CURSOR_VERSION,
    1
  );

  assert.strictEqual(
    CERTIFICATE_SCAN_BATCH_SIZE,
    26
  );

  assert.strictEqual(
    CERTIFICATE_MAX_SCAN_DOCS,
    260
  );

  /*
   * Basic pagination.
   */
  const basicDocs =
    Array.from(
      {
        length:
          5
      },
      (
        _,
        index
      ) =>
        buildCertificateFor(
          `basic-${index + 1}`
        )
    );

  const basicDb =
    createFakeDb(
      basicDocs
    );

  const basicService =
    createAdminCertificatesReadService({
      db:
        basicDb,
      documentIdField:
        "__name__"
    });

  const first =
    await basicService
      .listCertificates({
        limit:
          2
      });

  assert.strictEqual(
    first.limit,
    2
  );

  assert.strictEqual(
    first.items.length,
    2
  );

  assert.ok(
    first.nextCursor
  );

  const firstIds =
    first.items.map(
      item =>
        item.certificateId
    );

  const second =
    await basicService
      .listCertificates({
        limit:
          2,
        cursor:
          first.nextCursor
      });

  assert.strictEqual(
    second.items.length,
    2
  );

  for (
    const id
    of second.items.map(
      item =>
        item.certificateId
    )
  ) {
    assert.strictEqual(
      firstIds.includes(id),
      false,
      "Certificate pagination must not duplicate items."
    );
  }

  /*
   * Sparse combined filters must fill the page from later raw docs.
   */
  const sparseMeta =
    Array.from(
      {
        length:
          10
      },
      (
        _,
        index
      ) =>
        buildCertificateFor(
          `sparse-${index + 1}`
        )
    )
      .sort(
        (
          left,
          right
        ) =>
          left.id.localeCompare(
            right.id
          )
      );

  const matchingPositions =
    new Set([
      2,
      5,
      8
    ]);

  const sparseDocs =
    sparseMeta.map(
      (
        item,
        index
      ) => {
        const matching =
          matchingPositions
            .has(index);

        return buildCertificateFor(
          item.certificate.resultId,
          matching
            ? {
                organizationId:
                  "organization-special",
                organizationName:
                  "Academia Especial",
                targetBelt:
                  "Azul"
              }
            : {
                organizationId:
                  "organization-default",
                organizationName:
                  "Academia Default",
                targetBelt:
                  "Branca"
              }
        );
      }
    );

  const sparseSorted =
    sparseDocs
      .slice()
      .sort(
        (
          left,
          right
        ) =>
          left.id.localeCompare(
            right.id
          )
      );

  const expectedMatches =
    [
      sparseSorted[2].id,
      sparseSorted[5].id,
      sparseSorted[8].id
    ];

  const sparseDb =
    createFakeDb(
      sparseDocs
    );

  const sparseService =
    createAdminCertificatesReadService({
      db:
        sparseDb,
      documentIdField:
        "__name__"
    });

  const sparseFirst =
    await sparseService
      .listCertificates({
        limit:
          2,

        status:
          "valid",

        organizationId:
          "organization-special",

        targetBelt:
          "azul"
      });

  assert.deepStrictEqual(
    sparseFirst.items.map(
      item =>
        item.certificateId
    ),
    expectedMatches.slice(
      0,
      2
    )
  );

  assert.ok(
    sparseFirst.nextCursor
  );

  const sparseSecond =
    await sparseService
      .listCertificates({
        limit:
          2,

        cursor:
          sparseFirst.nextCursor,

        status:
          "valid",

        organizationId:
          "organization-special",

        targetBelt:
          "Azul"
      });

  assert.deepStrictEqual(
    sparseSecond.items.map(
      item =>
        item.certificateId
    ),
    [
      expectedMatches[2]
    ]
  );

  assert.strictEqual(
    sparseSecond.nextCursor,
    null
  );

  /*
   * Bounded scan: one matching certificate after the 260th raw doc.
   */
  const boundedMeta =
    Array.from(
      {
        length:
          261
      },
      (
        _,
        index
      ) =>
        buildCertificateFor(
          `bounded-${index + 1}`
        )
    )
      .sort(
        (
          left,
          right
        ) =>
          left.id.localeCompare(
            right.id
          )
      );

  const lastMeta =
    boundedMeta[
      boundedMeta.length - 1
    ];

  const boundedDocs =
    boundedMeta.map(
      item =>
        buildCertificateFor(
          item.certificate.resultId,
          item.id ===
            lastMeta.id
            ? {
                organizationId:
                  "organization-special",
                organizationName:
                  "Academia Especial"
              }
            : {
                organizationId:
                  "organization-default",
                organizationName:
                  "Academia Default"
              }
        )
    );

  const boundedSorted =
    boundedDocs
      .slice()
      .sort(
        (
          left,
          right
        ) =>
          left.id.localeCompare(
            right.id
          )
      );

  const boundedDb =
    createFakeDb(
      boundedDocs
    );

  const boundedService =
    createAdminCertificatesReadService({
      db:
        boundedDb,
      documentIdField:
        "__name__"
    });

  const boundedFirst =
    await boundedService
      .listCertificates({
        limit:
          1,
        organizationId:
          "organization-special"
      });

  assert.strictEqual(
    boundedFirst.items.length,
    0
  );

  assert.ok(
    boundedFirst.nextCursor
  );

  assert.strictEqual(
    decodeCertificateCursor(
      boundedFirst.nextCursor
    ),
    boundedSorted[259].id
  );

  const boundedSecond =
    await boundedService
      .listCertificates({
        limit:
          1,
        cursor:
          boundedFirst.nextCursor,
        organizationId:
          "organization-special"
      });

  assert.deepStrictEqual(
    boundedSecond.items.map(
      item =>
        item.certificateId
    ),
    [
      boundedSorted[260].id
    ]
  );

  assert.strictEqual(
    boundedSecond.nextCursor,
    null
  );

  /*
   * Detail.
   */
  const detailId =
    basicDocs[0].id;

  const detail =
    await basicService
      .getCertificate({
        certificateId:
          detailId
      });

  assert.strictEqual(
    detail.certificateId,
    detailId
  );

  assert.strictEqual(
    Object.keys(detail).length,
    10
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detail,
        "correctAnswers"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detail,
        "revocationReason"
      ),
    false
  );

  await expectReadError(
    () =>
      basicService
        .getCertificate({
          certificateId:
            "not-found"
        }),
    "ADMIN_CERTIFICATE_NOT_FOUND"
  );

  /*
   * Validation.
   */
  await expectReadError(
    () =>
      basicService
        .listCertificates({
          limit:
            26
        }),
    "ADMIN_CERTIFICATES_LIMIT_INVALID"
  );

  await expectReadError(
    () =>
      basicService
        .listCertificates({
          status:
            "pending"
        }),
    "ADMIN_CERTIFICATES_FILTER_INVALID"
  );

  await expectReadError(
    () =>
      basicService
        .listCertificates({
          organizationId:
            "bad/id"
        }),
    "ADMIN_CERTIFICATES_IDENTIFIER_INVALID"
  );

  await expectReadError(
    () =>
      basicService
        .listCertificates({
          targetBelt:
            "Faixa Inexistente"
        }),
    "ADMIN_CERTIFICATES_FILTER_INVALID"
  );

  await expectReadError(
    () =>
      basicService
        .listCertificates({
          cursor:
            "not-a-cursor"
        }),
    "ADMIN_CERTIFICATES_CURSOR_INVALID"
  );

  const cursor =
    encodeCertificateCursor(
      detailId
    );

  assert.strictEqual(
    decodeCertificateCursor(
      cursor
    ),
    detailId
  );

  console.log(
    "MARCO8_CERTIFICATE_COLLECTION=exam_certificates"
  );

  console.log(
    "MARCO8_CERTIFICATES_DEFAULT_LIMIT=20"
  );

  console.log(
    "MARCO8_CERTIFICATES_MAX_LIMIT=25"
  );

  console.log(
    "MARCO8_CERTIFICATES_CURSOR=DOCUMENT_ID_V1"
  );

  console.log(
    "MARCO8_CERTIFICATES_SCAN_BATCH_SIZE=26"
  );

  console.log(
    "MARCO8_CERTIFICATES_MAX_SCAN_DOCS=260"
  );

  console.log(
    "MARCO8_CERTIFICATES_FILTERS=3/3"
  );

  console.log(
    "MARCO8_CERTIFICATES_FILTER_PAGINATION=BOUNDED_RAW_SCAN"
  );

  console.log(
    "MARCO8_CERTIFICATES_FILTER_PAGE_FILL=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_SCAN_CONTINUATION=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_DETAIL=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CORRECT_ANSWERS_ALIAS=False"
  );

  console.log(
    "MARCO8_CERTIFICATES_REVOCATION_REASON_EXPOSURE=False"
  );

  console.log(
    "MARCO8_CERTIFICATES_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
  );

  console.log(
    "MARCO8_ADMIN_CERTIFICATES_READ_SERVICE=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
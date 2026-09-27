"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  CERTIFICATES_READ_CAPABILITY,
  createListCertificatesHandler,
  createGetCertificateHandler,
  mapCertificatesReadError
} = require(
  "../functions/src/admin/admin-certificates-read-functions"
);

const {
  AdminCertificatesReadError
} = require(
  "../functions/src/admin/admin-certificates-read-service"
);

const {
  AdminCertificateModelError
} = require(
  "../functions/src/admin/admin-certificate-models"
);

function requestFor(
  role,
  data = {}
) {
  return {
    auth: {
      uid:
        `uid-${role}`,

      token: {
        [role]:
          true
      }
    },

    data
  };
}

async function expectHttpsError(
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
    captured,
    "Expected HTTPS-style error."
  );

  assert.strictEqual(
    captured.code,
    expectedCode
  );

  return captured;
}

function makeService() {
  const calls = [];

  const service = {
    async listCertificates(
      input
    ) {
      calls.push({
        operation:
          "list",
        input
      });

      return {
        limit:
          input.limit || 20,
        items:
          [],
        nextCursor:
          null
      };
    },

    async getCertificate(
      input
    ) {
      calls.push({
        operation:
          "get",
        input
      });

      return {
        certificateId:
          input.certificateId,
        status:
          "valid",
        studentName:
          "Aluno Teste",
        organizationName:
          "Academia Teste",
        targetBelt:
          "Azul",
        scoreBps:
          8000,
        correctCount:
          8,
        totalQuestions:
          10,
        issuedAt:
          "2026-09-20T12:00:00.000Z",
        revokedAt:
          null
      };
    }
  };

  return {
    calls,
    service
  };
}

async function main() {
  assert.strictEqual(
    CERTIFICATES_READ_CAPABILITY,
    "ops.certificates.read"
  );

  const {
    calls,
    service
  } =
    makeService();

  const listHandler =
    createListCertificatesHandler({
      service
    });

  const detailHandler =
    createGetCertificateHandler({
      service
    });

  await expectHttpsError(
    () =>
      listHandler({
        data: {
          forbidden:
            true
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  await expectHttpsError(
    () =>
      detailHandler({
        data: {
          forbidden:
            true
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  for (
    const role
    of [
      "support_admin",
      "content_admin",
      "platform_admin",
      "super_admin"
    ]
  ) {
    const result =
      await listHandler(
        requestFor(
          role,
          {
            limit:
              10,
            status:
              "valid",
            organizationId:
              "organization-1",
            targetBelt:
              "Azul"
          }
        )
      );

    assert.strictEqual(
      result.ok,
      true
    );
  }

  await expectHttpsError(
    () =>
      listHandler(
        requestFor(
          "finance_admin",
          {}
        )
      ),
    "permission-denied"
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "org-owner-1",

          token: {
            organization_role:
              "owner"
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  for (
    const payload
    of [
      {
        role:
          "super_admin"
      },
      {
        actorRole:
          "super_admin"
      },
      {
        capability:
          "ops.certificates.read"
      },
      {
        collection:
          "other_collection"
      },
      {
        fields: [
          "revocationReason"
        ]
      }
    ]
  ) {
    await expectHttpsError(
      () =>
        listHandler(
          requestFor(
            "support_admin",
            payload
          )
        ),
      "invalid-argument"
    );
  }

  const listResult =
    await listHandler(
      requestFor(
        "support_admin",
        {
          limit:
            5,

          cursor:
            "cursor-value",

          status:
            "revoked",

          organizationId:
            "organization-2",

          targetBelt:
            "Roxa"
        }
      )
    );

  assert.strictEqual(
    listResult.ok,
    true
  );

  const lastListCall =
    calls
      .filter(
        call =>
          call.operation ===
            "list"
      )
      .at(-1);

  assert.deepStrictEqual(
    Object.keys(
      lastListCall.input
    ).sort(),
    [
      "cursor",
      "limit",
      "organizationId",
      "status",
      "targetBelt"
    ]
  );

  const detailResult =
    await detailHandler(
      requestFor(
        "support_admin",
        {
          certificateId:
            "certificate-1"
        }
      )
    );

  assert.strictEqual(
    detailResult.ok,
    true
  );

  assert.strictEqual(
    Object.keys(
      detailResult.certificate
    ).length,
    10
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detailResult.certificate,
        "correctAnswers"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detailResult.certificate,
        "revocationReason"
      ),
    false
  );

  await expectHttpsError(
    () =>
      detailHandler(
        requestFor(
          "support_admin",
          {
            certificateId:
              "certificate-1",

            reason:
              "client-supplied"
          }
        )
      ),
    "invalid-argument"
  );

  const notFound =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapCertificatesReadError(
                new AdminCertificatesReadError(
                  "ADMIN_CERTIFICATE_NOT_FOUND",
                  "Certificate was not found."
                )
              )
          ),
      "not-found"
    );

  assert.strictEqual(
    notFound.details.domainCode,
    "ADMIN_CERTIFICATE_NOT_FOUND"
  );

  const invalid =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapCertificatesReadError(
                new AdminCertificatesReadError(
                  "ADMIN_CERTIFICATES_FILTER_INVALID",
                  "Invalid filter."
                )
              )
          ),
      "invalid-argument"
    );

  assert.strictEqual(
    invalid.details.domainCode,
    "ADMIN_CERTIFICATES_FILTER_INVALID"
  );

  const canonicalInvalid =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapCertificatesReadError(
                new AdminCertificateModelError(
                  "ADMIN_CERTIFICATE_CANONICAL_STATE_INVALID",
                  "Canonical state invalid."
                )
              )
          ),
      "failed-precondition"
    );

  assert.strictEqual(
    canonicalInvalid.details.domainCode,
    "ADMIN_CERTIFICATE_CANONICAL_STATE_INVALID"
  );

  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const source =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/admin/admin-certificates-read-functions.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY",
      "defineSecret",
      "revogarCertificadoExameV12",
      "emitirMeuCertificadoExameV12",
      "validarCertificadoExamePublicoV12",
      "correctAnswers",
      "revocationReason"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Certificate operational reads must not depend on ${forbidden}`
    );
  }

  assert.strictEqual(
    source.includes(
      "request.data.role"
    ),
    false
  );

  assert.strictEqual(
    source.includes(
      "request.data.actorRole"
    ),
    false
  );

  assert.strictEqual(
    source.includes(
      "request.data.capability"
    ),
    false
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_CAPABILITY=ops.certificates.read"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLES=2/2"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_CONTENT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_PLATFORM_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_SUPER_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_FINANCE_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_LIST_FIELDS=5/5"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_CERTIFICATES_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_CERTIFICATES_READ_CALLABLES=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
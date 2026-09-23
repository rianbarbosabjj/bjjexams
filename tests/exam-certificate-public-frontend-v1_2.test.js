"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const api =
  require(
    "../js/exam-certificate-public-api-v1_2.js"
  );

function read(
  relativePath
) {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      relativePath
    ),
    "utf8"
  );
}

let passed =
  0;

async function test(
  name,
  fn
) {
  await fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
}

async function main() {
  await test(
    "runtime publico distingue staging e producao",
    () => {
      assert.equal(
        api.inferEnvironment({
          hostname:
            "bjj-exams-staging.web.app"
        }),
        "staging"
      );

      assert.equal(
        api.inferEnvironment({
          hostname:
            "localhost"
        }),
        "staging"
      );

      assert.equal(
        api.inferEnvironment({
          hostname:
            "bjj-exams.web.app"
        }),
        "production"
      );
    }
  );

  await test(
    "validacao canonica permanece staging only",
    () => {
      assert.equal(
        api.canonicalVerificationEnabled({
          hostname:
            "bjj-exams-staging.web.app"
        }),
        true
      );

      assert.equal(
        api.canonicalVerificationEnabled({
          hostname:
            "bjj-exams.web.app"
        }),
        false
      );

      assert.throws(
        () =>
          api.functionUrl({
            hostname:
              "bjj-exams.web.app"
          }),
        /bloqueada em produção/i
      );

      assert.match(
        api.functionUrl({
          hostname:
            "localhost"
        }),
        /bjj-exams-staging/
      );
    }
  );

  await test(
    "firestore legado bjj exams so e permitido no host oficial de producao",
    () => {
      assert.equal(
        api.legacyExamFirestoreAllowed({
          hostname:
            "bjj-exams.web.app"
        }),
        true
      );

      assert.equal(
        api.legacyExamFirestoreAllowed({
          hostname:
            "bjj-exams.firebaseapp.com"
        }),
        true
      );

      assert.equal(
        api.legacyExamFirestoreAllowed({
          hostname:
            "bjj-exams-staging.web.app"
        }),
        false
      );

      assert.equal(
        api.legacyExamFirestoreAllowed({
          hostname:
            "localhost"
        }),
        false
      );
    }
  );

  await test(
    "certificateId canonico exige sha256 hexadecimal",
    () => {
      const id =
        "A".repeat(64);

      assert.equal(
        api.normalizeCertificateId(
          id
        ),
        "a".repeat(64)
      );

      assert.equal(
        api.normalizeCertificateId(
          "CERT-LEGADO-123"
        ),
        null
      );

      assert.equal(
        api.normalizeCertificateId(
          "a".repeat(63)
        ),
        null
      );
    }
  );

  await test(
    "callable publica envia somente certificateId sem bearer",
    async () => {
      const certificateId =
        "a".repeat(64);

      let captured =
        null;

      const certificate =
        await api.verifyCertificate(
          certificateId,
          {
            hostname:
              "localhost",
            fetchImpl:
              async (
                url,
                options
              ) => {
                captured = {
                  url,
                  options,
                  body:
                    JSON.parse(
                      options.body
                    )
                };

                return {
                  ok:
                    true,
                  status:
                    200,
                  text:
                    async () =>
                      JSON.stringify({
                        result: {
                          ok:
                            true,
                          certificate: {
                            certificateId,
                            status:
                              "valid",
                            studentName:
                              "Aluno Teste",
                            targetBelt:
                              "Azul",
                            organizationName:
                              "Academia Teste",
                            instructorName:
                              "Professor Teste",
                            scoreBps:
                              8500,
                            correctCount:
                              17,
                            totalQuestions:
                              20,
                            issuedAt:
                              "2026-09-23T15:00:00.000Z",
                            revokedAt:
                              null
                          }
                        }
                      })
                };
              }
          }
        );

      assert.equal(
        certificate.certificateId,
        certificateId
      );

      assert.deepEqual(
        captured.body,
        {
          data: {
            certificateId
          }
        }
      );

      assert.equal(
        Object.hasOwn(
          captured.options.headers,
          "Authorization"
        ),
        false
      );

      assert.match(
        captured.url,
        /validarCertificadoExamePublicoV12$/
      );
    }
  );

  await test(
    "read model frontend elimina campos internos extras",
    () => {
      const certificateId =
        "b".repeat(64);

      const certificate =
        api.normalizePublicCertificate(
          {
            certificateId,
            status:
              "revoked",
            studentName:
              "Aluno",
            targetBelt:
              "Roxa",
            organizationName:
              "Academia",
            instructorName:
              "Professor",
            scoreBps:
              9000,
            correctCount:
              9,
            totalQuestions:
              10,
            issuedAt:
              "2026-09-23T15:00:00.000Z",
            revokedAt:
              "2026-09-23T17:00:00.000Z",
            revokedBy:
              "admin-interno",
            revocationReason:
              "motivo-interno",
            studentId:
              "uid-interno",
            resultId:
              "result-interno"
          },
          certificateId
        );

      for (
        const forbidden of [
          "revokedBy",
          "revocationReason",
          "studentId",
          "resultId"
        ]
      ) {
        assert.equal(
          Object.hasOwn(
            certificate,
            forbidden
          ),
          false,
          forbidden
        );
      }

      assert.equal(
        certificate.status,
        "revoked"
      );
    }
  );

  await test(
    "resposta publica com identidade divergente falha fechado",
    () => {
      assert.throws(
        () =>
          api.normalizePublicCertificate(
            {
              certificateId:
                "c".repeat(64),
              status:
                "valid",
              studentName:
                "Aluno",
              targetBelt:
                "Azul",
              organizationName:
                "Academia",
              instructorName:
                "Professor",
              scoreBps:
                10000,
              correctCount:
                10,
              totalQuestions:
                10,
              issuedAt:
                "2026-09-23T15:00:00.000Z",
              revokedAt:
                null
            },
            "d".repeat(64)
          ),
        /divergente/i
      );
    }
  );

  await test(
    "not found canonico e classificado para fallback seguro",
    () => {
      assert.equal(
        api.isNotFoundError({
          callableStatus:
            "NOT_FOUND"
        }),
        true
      );

      assert.equal(
        api.isNotFoundError({
          domainCode:
            "EXAM_CERTIFICATE_NOT_FOUND"
        }),
        true
      );

      assert.equal(
        api.isNotFoundError({
          callableStatus:
            "UNAVAILABLE"
        }),
        false
      );
    }
  );

  const html =
    read(
      "validar.html"
    );

  await test(
    "validar html carrega cliente publico canonico",
    () => {
      assert.match(
        html,
        /exam-certificate-public-api-v1_2\.js/
      );

      assert.match(
        html,
        /BjjExamsCertificatePublicApi/
      );

      assert.match(
        html,
        /preencherCertificadoCanonico/
      );
    }
  );

  await test(
    "validacao canonica ocorre antes do legado bjj exams",
    () => {
      const canonicalIndex =
        html.indexOf(
          "await certificateApi.verifyCertificate"
        );

      const legacyIndex =
        html.indexOf(
          'doc(\n                                dbExams,\n                                "certificados"'
        );

      assert.ok(
        canonicalIndex >= 0,
        "callable canonica ausente"
      );

      assert.ok(
        legacyIndex >
          canonicalIndex,
        "legado apareceu antes da callable canonica"
      );
    }
  );

  await test(
    "staging nao abre firestore legado do projeto de producao",
    () => {
      assert.match(
        html,
        /const allowLegacyExamFirestore\s*=\s*certificateApi\.legacyExamFirestoreAllowed/
      );

      assert.match(
        html,
        /const appExams = allowLegacyExamFirestore/
      );

      assert.match(
        html,
        /if \(allowLegacyExamFirestore && dbExams\)/
      );

      assert.match(
        html,
        /Nenhuma consulta ao banco legado de produção foi realizada/
      );
    }
  );

  await test(
    "browser nao acessa colecao canonica exam_certificates",
    () => {
      assert.equal(
        html.includes(
          "exam_certificates"
        ),
        false
      );

      assert.equal(
        html.includes(
          "revocationReason"
        ),
        false
      );

      assert.equal(
        html.includes(
          "revokedBy"
        ),
        false
      );
    }
  );

  await test(
    "certificado revoked permanece verificavel visualmente",
    () => {
      assert.match(
        html,
        /Certificado Revogado/
      );

      assert.match(
        html,
        /Documento autêntico com validade administrativa revogada/
      );

      assert.match(
        html,
        /Revogado em/
      );
    }
  );

  await test(
    "fallback manager permanece depois das fontes bjj exams",
    () => {
      const canonicalIndex =
        html.indexOf(
          "await certificateApi.verifyCertificate"
        );

      const managerIndex =
        html.indexOf(
          'collection(dbManager, "alunos")'
        );

      assert.ok(
        canonicalIndex >= 0
      );

      assert.ok(
        managerIndex >
          canonicalIndex
      );

      assert.match(
        html,
        /BJJ Manager \(Carteirinhas\)/
      );

      assert.match(
        html,
        /BJJ Manager \(certificados\/diplomas\)/
      );
    }
  );

  console.log(
    `EXAM_CERTIFICATE_PUBLIC_FRONTEND_V1_2=${passed}/14`
  );

  if (passed !== 14) {
    process.exitCode = 1;
  }
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exitCode = 1;
  }
);
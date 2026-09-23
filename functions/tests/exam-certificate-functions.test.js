'use strict';

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const path =
  require('node:path');

const {
  HttpsError
} = require(
  'firebase-functions/v2/https'
);

const {
  ExamCertificateServiceError
} = require(
  '../src/exams/exam-certificate-service'
);

const {
  requireAuth,
  assertOnlyFields,
  parseIdentifier,
  parseIssueInput,
  mapExamCertificateError,
  createExamCertificateFunctions
} = require(
  '../src/exams/exam-certificate-functions'
);

let passed = 0;

function test(
  name,
  fn
) {
  try {
    fn();
    passed += 1;

    console.log(
      `PASS | ${name}`
    );
  } catch (error) {
    console.error(
      `FAIL | ${name}`
    );

    throw error;
  }
}

function expectHttps(
  expectedCode,
  fn,
  domainCode = undefined
) {
  assert.throws(
    fn,
    error => {
      assert.ok(
        error instanceof
          HttpsError
      );

      assert.equal(
        error.code,
        expectedCode
      );

      if (
        domainCode !==
          undefined
      ) {
        assert.equal(
          error.details
            ?.domainCode,
          domainCode
        );
      }

      return true;
    }
  );
}

test(
  'auth e obrigatoria',
  () => {
    expectHttps(
      'unauthenticated',
      () =>
        requireAuth({
          auth: null
        })
    );
  }
);

test(
  'auth retorna somente uid do ator',
  () => {
    assert.equal(
      requireAuth({
        auth: {
          uid:
            'student_1'
        }
      }),
      'student_1'
    );
  }
);

test(
  'payload aceita somente registrationId',
  () => {
    const parsed =
      parseIssueInput({
        auth: {
          uid:
            'student_1'
        },
        data: {
          registrationId:
            'registration_1'
        }
      });

    assert.deepEqual(
      parsed,
      {
        actorId:
          'student_1',
        registrationId:
          'registration_1'
      }
    );

    expectHttps(
      'invalid-argument',
      () =>
        parseIssueInput({
          auth: {
            uid:
              'student_1'
          },
          data: {
            registrationId:
              'registration_1',
            certificateId:
              'browser_forbidden'
          }
        })
    );
  }
);

test(
  'identifier invalido e rejeitado',
  () => {
    expectHttps(
      'invalid-argument',
      () =>
        parseIdentifier(
          'bad/id',
          'registrationId'
        )
    );
  }
);

test(
  'erro de propriedade vira permission denied',
  () => {
    expectHttps(
      'permission-denied',
      () =>
        mapExamCertificateError(
          new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_STUDENT_MISMATCH',
            'Outro aluno.'
          )
        ),
      'EXAM_CERTIFICATE_STUDENT_MISMATCH'
    );
  }
);

test(
  'ausencia canonica vira not found',
  () => {
    expectHttps(
      'not-found',
      () =>
        mapExamCertificateError(
          new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_RESULT_NOT_FOUND',
            'Resultado ausente.'
          )
        ),
      'EXAM_CERTIFICATE_RESULT_NOT_FOUND'
    );
  }
);

test(
  'estado inconsistente vira failed precondition',
  () => {
    expectHttps(
      'failed-precondition',
      () =>
        mapExamCertificateError(
          new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_STATE_INCONSISTENT',
            'Estado inconsistente.'
          )
        ),
      'EXAM_CERTIFICATE_STATE_INCONSISTENT'
    );
  }
);

test(
  'erro inesperado nao vaza detalhe interno',
  () => {
    expectHttps(
      'unavailable',
      () =>
        mapExamCertificateError(
          new Error(
            'segredo interno'
          )
        )
    );
  }
);

test(
  'factory expoe somente callable canonica de emissao',
  () => {
    const fakeDb = {
      doc() {},
      collection() {},
      runTransaction() {}
    };

    const functions =
      createExamCertificateFunctions({
        REGION:
          'southamerica-east1',
        db:
          fakeDb
      });

    assert.deepEqual(
      Object.keys(
        functions
      ),
      [
        'emitirMeuCertificadoExameV12'
      ]
    );
  }
);

test(
  'composition root mantem certificado sob gate staging demo',
  () => {
    const root =
      path.resolve(
        __dirname,
        '..',
        'main.js'
      );

    const main =
      fs.readFileSync(
        root,
        'utf8'
      );

    const source =
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../src/exams/exam-certificate-functions.js'
        ),
        'utf8'
      );

    assert.ok(
      main.includes(
        'createExamCertificateFunctions'
      )
    );

    assert.ok(
      main.includes(
        'const examCertificateFunctions = webhookRuntimeAllowed'
      )
    );

    assert.ok(
      main.includes(
        '...examCertificateFunctions'
      )
    );

    assert.ok(
      source.includes(
        "['registrationId']"
      ) ||
      source.includes(
        "'registrationId'"
      )
    );

    for (
      const forbidden of [
        'ASAAS_API_KEY',
        'ASAAS_WEBHOOK_TOKEN',
        'certificateId:',
        'resultId:',
        'scoreBps:',
        'targetBelt:'
      ]
    ) {
      assert.equal(
        source.includes(
          forbidden
        ),
        false,
        `Campo/dependencia proibida na callable: ${forbidden}`
      );
    }
  }
);

console.log(
  `EXAM_CERTIFICATE_FUNCTIONS_V1_2=${passed}/10`
);

if (passed !== 10) {
  process.exitCode = 1;
}
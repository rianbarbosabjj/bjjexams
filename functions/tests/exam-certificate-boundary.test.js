'use strict';

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const path =
  require('node:path');

const {
  buildExamResult,
  validateExamResult,
  publicExamResult
} = require('../src/exams/exam-result-domain');

const {
  ExamRegistrationDomainError,
  validateExamRegistration,
  assertExamRegistrationStatusTransition,
  markRegistrationOutcome
} = require('../src/exams/exam-registration-domain');

let passed =
  0;

const now =
  new Date(
    '2026-09-23T12:00:00.000Z'
  );

function read(relativePath) {
  return fs.readFileSync(
    path.join(
      __dirname,
      '..',
      relativePath
    ),
    'utf8'
  );
}

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

function baseResultInput() {
  return {
    attemptId:
      'attempt_certificate_boundary',
    registrationId:
      'registration_certificate_boundary',
    sessionId:
      'session_certificate_boundary',
    organizationId:
      'organization_certificate_boundary',
    studentId:
      'student_certificate_boundary',
    templateId:
      'template_certificate_boundary',
    templateVersionId:
      'v0000001',
    targetBelt:
      'Azul',
    questionIds: [
      'question_1',
      'question_2'
    ],
    answerKey: {
      question_1:
        'A',
      question_2:
        'B'
    },
    passingScoreBps:
      7000,
    finalizedAt:
      now
  };
}

function submittedRegistration() {
  return validateExamRegistration({
    sessionId:
      'session_certificate_boundary',
    organizationId:
      'organization_certificate_boundary',
    studentId:
      'student_certificate_boundary',
    instructorId:
      'instructor_certificate_boundary',
    currentBelt:
      'Branca',
    targetBelt:
      'Azul',
    membershipId:
      'membership_certificate_boundary',
    status:
      'submitted',
    orderId:
      'order_certificate_boundary',
    attemptId:
      'attempt_certificate_boundary',
    resultId:
      'result_certificate_boundary',
    certificateId:
      null,
    selectedAt:
      now,
    paidAt:
      now,
    authorizedAt:
      now,
    cancelledAt:
      null,
    updatedAt:
      now
  });
}

async function main() {
  await test(
    'passed gera somente certificateEligible true',
    () => {
      const result =
        buildExamResult({
          ...baseResultInput(),
          answers: {
            question_1:
              'A',
            question_2:
              'B'
          }
        });

      assert.equal(
        result.outcome,
        'passed'
      );

      assert.equal(
        result.certificateEligible,
        true
      );

      assert.equal(
        Object.hasOwn(
          result,
          'certificateId'
        ),
        false
      );

      assert.equal(
        Object.hasOwn(
          result,
          'certificateCode'
        ),
        false
      );

      assert.equal(
        Object.hasOwn(
          result,
          'certificateUrl'
        ),
        false
      );
    }
  );

  await test(
    'failed gera somente certificateEligible false',
    () => {
      const result =
        buildExamResult({
          ...baseResultInput(),
          answers: {
            question_1:
              'A',
            question_2:
              'A'
          }
        });

      assert.equal(
        result.outcome,
        'failed'
      );

      assert.equal(
        result.certificateEligible,
        false
      );
    }
  );

  await test(
    'resultado rejeita elegibilidade divergente',
    () => {
      assert.throws(
        () =>
          validateExamResult({
            resultVersion:
              1,
            attemptId:
              'attempt_boundary',
            registrationId:
              'registration_boundary',
            sessionId:
              'session_boundary',
            organizationId:
              'organization_boundary',
            studentId:
              'student_boundary',
            templateId:
              'template_boundary',
            templateVersionId:
              'v0000001',
            targetBelt:
              'Azul',
            scoreBps:
              10000,
            correctCount:
              2,
            totalQuestions:
              2,
            outcome:
              'passed',
            reason:
              'score_passed',
            certificateEligible:
              false,
            finalizedAt:
              now
          }),
        error =>
          error?.code ===
          'EXAM_RESULT_CERTIFICATE_ELIGIBILITY_MISMATCH'
      );
    }
  );

  await test(
    'public result expoe elegibilidade mas nao certificado',
    () => {
      const result =
        buildExamResult({
          ...baseResultInput(),
          answers: {
            question_1:
              'A',
            question_2:
              'B'
          }
        });

      const {
        examResultDocumentId
      } =
        require('../src/exams/exam-result-domain');

      const resultId =
        examResultDocumentId(
          result.attemptId
        );

      const publicView =
        publicExamResult(
          resultId,
          result
        );

      assert.equal(
        publicView.certificateEligible,
        true
      );

      for (
        const forbidden of [
          'certificateId',
          'certificateCode',
          'certificateUrl',
          'qrCode',
          'targetBelt',
          'studentId'
        ]
      ) {
        assert.equal(
          Object.hasOwn(
            publicView,
            forbidden
          ),
          false,
          forbidden
        );
      }
    }
  );

  await test(
    'passed registration permanece sem certificateId no Marco 6',
    () => {
      const registration =
        markRegistrationOutcome(
          submittedRegistration(),
          {
            resultId:
              'result_certificate_boundary',
            outcome:
              'passed',
            finalizedAt:
              now
          }
        );

      assert.equal(
        registration.status,
        'passed'
      );

      assert.equal(
        registration.resultId,
        'result_certificate_boundary'
      );

      assert.equal(
        registration.certificateId,
        null
      );
    }
  );

  await test(
    'failed registration permanece sem certificateId',
    () => {
      const registration =
        markRegistrationOutcome(
          submittedRegistration(),
          {
            resultId:
              'result_certificate_boundary',
            outcome:
              'failed',
            finalizedAt:
              now
          }
        );

      assert.equal(
        registration.status,
        'failed'
      );

      assert.equal(
        registration.certificateId,
        null
      );
    }
  );

  await test(
    'Marco 6 nao aceita certified como outcome de finalizacao',
    () => {
      assert.throws(
        () =>
          markRegistrationOutcome(
            submittedRegistration(),
            {
              resultId:
                'result_certificate_boundary',
              outcome:
                'certified',
              finalizedAt:
                now
            }
          ),
        error =>
          error instanceof
            ExamRegistrationDomainError &&
          error.code ===
            'INVALID_EXAM_REGISTRATION_OUTCOME'
      );
    }
  );

  await test(
    'certified fica reservado e exige certificateId',
    () => {
      assert.equal(
        assertExamRegistrationStatusTransition(
          'passed',
          'certified'
        ),
        true
      );

      const passedRegistration =
        markRegistrationOutcome(
          submittedRegistration(),
          {
            resultId:
              'result_certificate_boundary',
            outcome:
              'passed',
            finalizedAt:
              now
          }
        );

      assert.throws(
        () =>
          validateExamRegistration({
            ...passedRegistration,
            status:
              'certified',
            certificateId:
              null
          }),
        error =>
          error instanceof
            ExamRegistrationDomainError &&
          error.code ===
            'EXAM_REGISTRATION_CERTIFICATE_REQUIRED'
      );
    }
  );

  await test(
    'servico de tentativa nao emite certificado nem altera faixa',
    () => {
      const source =
        read(
          'src/exams/exam-attempt-service.js'
        );

      for (
        const forbidden of [
          'exam_certificates',
          '`certificados/',
          '"certificados/',
          "'certificados/",
          'certificateId:',
          'faixa_atual',
          'markRegistrationCertified'
        ]
      ) {
        assert.equal(
          source.includes(
            forbidden
          ),
          false,
          forbidden
        );
      }

      assert.match(
        source,
        /markRegistrationOutcome/
      );
    }
  );

  await test(
    'callable de finalizacao nao recebe campos de certificado',
    () => {
      const source =
        read(
          'src/exams/exam-attempt-functions.js'
        );

      assert.match(
        source,
        /finalizarExameOficialV12/
      );

      for (
        const forbidden of [
          'certificateId',
          'certificateCode',
          'certificateUrl',
          'targetBelt',
          'newBelt'
        ]
      ) {
        assert.equal(
          source.includes(
            forbidden
          ),
          false,
          forbidden
        );
      }
    }
  );

  await test(
    'frontend oficial nao cria certificado nem muda faixa',
    () => {
      const executionSource =
        read(
          '../js/belt-exam-execution-ui-v1_2.js'
        );

      const html =
        read(
          '../exame.html'
        );

      for (
        const source of [
          executionSource,
          html
        ]
      ) {
        for (
          const forbidden of [
            'exam_certificates',
            'certificados"',
            "certificados'",
            'faixa_atual',
            'updateDoc(',
            'setDoc(',
            'addDoc('
          ]
        ) {
          assert.equal(
            source.includes(
              forbidden
            ),
            false,
            forbidden
          );
        }
      }

      assert.match(
        html,
        /não emite certificado/i
      );
    }
  );

  await test(
    'rules nao abrem collection canonica de certificado ao browser',
    () => {
      const rules =
        read(
          '../firestore.rules'
        );

      assert.match(
        rules,
        /match \/exam_certificates\/\{id\} \{\s*allow read, write: if false;\s*\}/
      );

      assert.match(
        rules,
        /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/
      );
    }
  );

  console.log(
    `EXAM_CERTIFICATE_BOUNDARY_V1_2=${passed}/12`
  );

  if (passed !== 12) {
    process.exitCode = 1;
  }
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function read(relativePath) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

function has(
  text,
  marker,
  label
) {
  assert.ok(
    text.includes(marker),
    `${label}: missing ${marker}`
  );
}

const architecture =
  read(
    "docs/architecture/MARCO_8_EXAMS_QUESTIONS_CERTIFICATES.md"
  );

const rbac =
  read(
    "docs/architecture/MARCO_8_RBAC_CONTRACTS.md"
  );

const questionDomain =
  read(
    "functions/src/exams/exam-question-domain.js"
  );

const sessionDomain =
  read(
    "functions/src/exams/exam-session-domain.js"
  );

const registrationDomain =
  read(
    "functions/src/exams/exam-registration-domain.js"
  );

const attemptDomain =
  read(
    "functions/src/exams/exam-attempt-domain.js"
  );

const resultDomain =
  read(
    "functions/src/exams/exam-result-domain.js"
  );

const certificateDomain =
  read(
    "functions/src/exams/exam-certificate-domain.js"
  );

for (
  const marker
  of [
    "exam_templates",
    "exam_sessions",
    "exam_registrations",
    "exam_attempts",
    "exam_results",
    "exam_certificates"
  ]
) {
  has(
    architecture,
    `\`${marker}\``,
    "canonical exam collection"
  );
}

for (
  const marker
  of [
    "listarExamesOperacionaisV12",
    "obterExameOperacionalV12"
  ]
) {
  has(
    rbac,
    `\`${marker}\``,
    "operational exam contract"
  );
}

has(
  rbac,
  "`ops.exams.read`",
  "operational exam capability"
);

for (
  const marker
  of [
    "listarQuestoesOperacionaisV12",
    "obterQuestaoOperacionalV12",
    "obterQuestaoEdicaoOperacionalV12",
    "criarQuestaoOperacionalV12",
    "atualizarQuestaoOperacionalV12",
    "moderarQuestaoOperacionalV12",
    "arquivarQuestaoOperacionalV12",
    "importarQuestoesOperacionaisV12"
  ]
) {
  has(
    rbac,
    `\`${marker}\``,
    "question operational contract"
  );
}

has(
  architecture,
  "`exam_question_bank`",
  "canonical question authoring collection"
);

has(
  architecture,
  "Snapshots de prova nao podem virar documentos editaveis",
  "snapshot versus bank boundary"
);

has(
  architecture,
  "OperationalQuestionAuthoringView",
  "question authoring view"
);

has(
  architecture,
  "`correctAnswer`",
  "authoring answer key field"
);

has(
  architecture,
  "`ops.questions.manage`",
  "question manage capability"
);

const publicQuestionStart =
  questionDomain.indexOf(
    "function publicExamQuestion"
  );

const publicQuestionEnd =
  questionDomain.indexOf(
    "function assertExamQuestionSnapshotImmutable"
  );

assert.ok(
  publicQuestionStart >= 0 &&
  publicQuestionEnd >
    publicQuestionStart,
  "publicExamQuestion block missing"
);

const publicQuestionBlock =
  questionDomain.slice(
    publicQuestionStart,
    publicQuestionEnd
  );

assert.strictEqual(
  publicQuestionBlock.includes(
    "correctAnswer"
  ),
  false,
  "publicExamQuestion must not expose answer key"
);

for (
  const status
  of [
    "draft",
    "candidates_selected",
    "awaiting_payment",
    "ready",
    "cancelled",
    "archived"
  ]
) {
  has(
    sessionDomain,
    `'${status}'`,
    "canonical session status"
  );
}

for (
  const status
  of [
    "selected",
    "awaiting_payment",
    "authorized",
    "started",
    "submitted",
    "passed",
    "failed",
    "certified",
    "cancelled",
    "needs_reconciliation"
  ]
) {
  has(
    registrationDomain,
    `'${status}'`,
    "canonical registration status"
  );
}

for (
  const status
  of [
    "in_progress",
    "submitted",
    "invalidated"
  ]
) {
  has(
    attemptDomain,
    `'${status}'`,
    "canonical attempt status"
  );
}

for (
  const outcome
  of [
    "passed",
    "failed"
  ]
) {
  has(
    resultDomain,
    `'${outcome}'`,
    "canonical result outcome"
  );
}

for (
  const status
  of [
    "valid",
    "revoked"
  ]
) {
  has(
    certificateDomain,
    `'${status}'`,
    "canonical certificate status"
  );
}

has(
  certificateDomain,
  "exam-certificate-v1:",
  "deterministic certificate identity"
);

has(
  certificateDomain,
  "correctCount",
  "canonical certificate correct count"
);

has(
  rbac,
  "`correctCount`",
  "operational certificate correct count"
);

assert.strictEqual(
  rbac.includes(
    "`correctAnswers`"
  ),
  false,
  "RBAC contract must not retain correctAnswers alias"
);

for (
  const marker
  of [
    "emitirMeuCertificadoExameV12",
    "revogarCertificadoExameV12",
    "validarCertificadoExamePublicoV12"
  ]
) {
  has(
    rbac,
    `\`${marker}\``,
    "canonical certificate reuse"
  );
}

has(
  architecture,
  "staging/demo-emulator only",
  "runtime gate"
);

has(
  architecture,
  "Nenhum passo deste documento autoriza deploy em producao.",
  "production boundary"
);

console.log(
  "MARCO8_EXAM_OPERATIONAL_READ_CONTRACTS=2/2"
);

console.log(
  "MARCO8_QUESTION_OPERATIONAL_CONTRACTS=8/8"
);

console.log(
  "MARCO8_QUESTION_BANK_CANONICAL_COLLECTION=exam_question_bank"
);

console.log(
  "MARCO8_QUESTION_SNAPSHOT_BOUNDARY=PASSED"
);

console.log(
  "MARCO8_ANSWER_KEY_BOUNDARY=PASSED"
);

console.log(
  "MARCO8_CERTIFICATE_CORRECT_FIELD=correctCount"
);

console.log(
  "MARCO8_CERTIFICATE_CANONICAL_REUSE=PASSED"
);

console.log(
  "MARCO8_EXAMS_QUESTIONS_CERTIFICATES_ARCHITECTURE=PASSED"
);

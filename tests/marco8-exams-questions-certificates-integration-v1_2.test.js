"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  hasAdminCapability
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  EXAM_QUESTION_BANK_COLLECTION
} = require(
  "../functions/src/exams/exam-question-bank-domain"
);

const {
  OPERATIONAL_EXAM_VIEW_FIELDS
} = require(
  "../functions/src/admin/admin-exam-models"
);

const {
  QUESTION_VIEW_FIELDS,
  QUESTION_AUTHORING_VIEW_FIELDS
} = require(
  "../functions/src/admin/admin-question-models"
);

const {
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS
} = require(
  "../functions/src/admin/admin-certificate-models"
);

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function read(
  relativePath
) {
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

function contains(
  text,
  value,
  label
) {
  assert.ok(
    text.includes(value),
    `${label}: missing ${value}`
  );
}

function excludes(
  text,
  value,
  label
) {
  assert.strictEqual(
    text.includes(value),
    false,
    `${label}: forbidden ${value}`
  );
}

const architecture =
  read(
    "docs/architecture/MARCO_8_EXAMS_QUESTIONS_CERTIFICATES.md"
  );

const main =
  read(
    "functions/main.js"
  );

const examFunctions =
  read(
    "functions/src/admin/admin-exams-read-functions.js"
  );

const examService =
  read(
    "functions/src/admin/admin-exams-read-service.js"
  );

const questionFunctions =
  read(
    "functions/src/admin/admin-question-functions.js"
  );

const questionReadService =
  read(
    "functions/src/admin/admin-questions-read-service.js"
  );

const questionWriteService =
  read(
    "functions/src/admin/admin-question-write-service.js"
  );

const certificateFunctions =
  read(
    "functions/src/admin/admin-certificates-read-functions.js"
  );

const certificateService =
  read(
    "functions/src/admin/admin-certificates-read-service.js"
  );

/*
 * 1. Architecture still defines G as integration/regression,
 *    H as controlled staging, and production as blocked.
 */
contains(
  architecture,
  "### 8.4G",
  "8.4G architecture"
);

contains(
  architecture,
  "Integracao e regressao local.",
  "8.4G architecture"
);

contains(
  architecture,
  "### 8.4H",
  "8.4H architecture"
);

contains(
  architecture,
  "Staging controlado.",
  "8.4H architecture"
);

contains(
  architecture,
  "Nenhum passo deste documento autoriza deploy em producao.",
  "production boundary"
);

/*
 * 2. Canonical sources remain separated.
 */
contains(
  examService,
  '"exam_sessions"',
  "exam canonical source"
);

assert.strictEqual(
  EXAM_QUESTION_BANK_COLLECTION,
  "exam_question_bank",
  "question bank canonical collection"
);

contains(
  questionReadService,
  "EXAM_QUESTION_BANK_COLLECTION",
  "question read canonical source binding"
);

contains(
  questionWriteService,
  "EXAM_QUESTION_BANK_COLLECTION",
  "question write canonical source binding"
);

contains(
  certificateService,
  '"exam_certificates"',
  "certificate canonical source"
);

/*
 * 3. Operational view field contracts.
 */
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
  QUESTION_VIEW_FIELDS,
  [
    "questionId",
    "statement",
    "options",
    "difficulty",
    "category",
    "lifecycleStatus",
    "authorSummary",
    "createdAt",
    "updatedAt"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS,
  [
    "certificateId",
    "status",
    "studentName",
    "organizationName",
    "targetBelt",
    "scoreBps",
    "correctCount",
    "totalQuestions",
    "issuedAt",
    "revokedAt"
  ]
);

assert.strictEqual(
  QUESTION_VIEW_FIELDS.includes(
    "correctAnswer"
  ),
  false,
  "sanitized question view must not expose answer key"
);

assert.strictEqual(
  QUESTION_AUTHORING_VIEW_FIELDS.includes(
    "correctAnswer"
  ),
  true,
  "authoring view must retain privileged answer key"
);

assert.strictEqual(
  OPERATIONAL_EXAM_VIEW_FIELDS.includes(
    "correctAnswer"
  ),
  false,
  "exam operational view must not expose answer key"
);

assert.strictEqual(
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS.includes(
    "correctAnswer"
  ),
  false,
  "certificate operational view must not expose answer key"
);

assert.strictEqual(
  OPERATIONAL_CERTIFICATE_VIEW_FIELDS.includes(
    "correctAnswers"
  ),
  false,
  "certificate operational view must use correctCount only"
);

/*
 * 4. Global RBAC integration.
 */
const readCapabilities = [
  "ops.exams.read",
  "ops.questions.read",
  "ops.certificates.read"
];

for (
  const capability
  of readCapabilities
) {
  for (
    const role
    of [
      "super_admin",
      "platform_admin",
      "content_admin",
      "support_admin"
    ]
  ) {
    assert.strictEqual(
      hasAdminCapability(
        {
          [role]:
            true
        },
        capability
      ),
      true,
      `${role} must receive ${capability}`
    );
  }

  assert.strictEqual(
    hasAdminCapability(
      {
        finance_admin:
          true
      },
      capability
    ),
    false,
    `finance_admin must not receive ${capability}`
  );

  assert.strictEqual(
    hasAdminCapability(
      {
        organization_role:
          "owner"
      },
      capability
    ),
    false,
    `organization role must not escalate to ${capability}`
  );
}

for (
  const role
  of [
    "super_admin",
    "platform_admin",
    "content_admin"
  ]
) {
  assert.strictEqual(
    hasAdminCapability(
      {
        [role]:
          true
      },
      "ops.questions.manage"
    ),
    true,
    `${role} must receive ops.questions.manage`
  );
}

for (
  const role
  of [
    "support_admin",
    "finance_admin"
  ]
) {
  assert.strictEqual(
    hasAdminCapability(
      {
        [role]:
          true
      },
      "ops.questions.manage"
    ),
    false,
    `${role} must not receive ops.questions.manage`
  );
}

/*
 * 5. Public/admin callable contracts coexist without crossing domains.
 */
for (
  const callable
  of [
    "listarExamesOperacionaisV12",
    "obterExameOperacionalV12"
  ]
) {
  contains(
    examFunctions,
    callable,
    "exam operational callable"
  );
}

for (
  const callable
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
  contains(
    questionFunctions,
    callable,
    "question operational callable"
  );
}

for (
  const callable
  of [
    "listarCertificadosOperacionaisV12",
    "obterCertificadoOperacionalV12"
  ]
) {
  contains(
    certificateFunctions,
    callable,
    "certificate operational callable"
  );
}

contains(
  examFunctions,
  "ops.exams.read",
  "exam capability"
);

contains(
  questionFunctions,
  "ops.questions.read",
  "question read capability"
);

contains(
  questionFunctions,
  "ops.questions.manage",
  "question manage capability"
);

contains(
  certificateFunctions,
  "ops.certificates.read",
  "certificate read capability"
);

/*
 * 6. Certificate admin reads must not own canonical issue/revoke/public
 *    validation behavior.
 */
for (
  const forbidden
  of [
    "revogarCertificadoExameV12",
    "emitirMeuCertificadoExameV12",
    "validarCertificadoExamePublicoV12"
  ]
) {
  excludes(
    certificateFunctions,
    forbidden,
    "certificate operational read boundary"
  );
}

/*
 * 7. Financial/moderation secret isolation.
 */
for (
  const source
  of [
    examFunctions,
    questionFunctions,
    certificateFunctions
  ]
) {
  for (
    const forbidden
    of [
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY",
      "defineSecret"
    ]
  ) {
    excludes(
      source,
      forbidden,
      "admin academic callable secret boundary"
    );
  }
}

/*
 * 8. Client-controlled global authorization must not be trusted.
 */
for (
  const source
  of [
    examFunctions,
    questionFunctions,
    certificateFunctions
  ]
) {
  for (
    const forbidden
    of [
      "request.data.role",
      "request.data.actorRole",
      "request.data.capability"
    ]
  ) {
    excludes(
      source,
      forbidden,
      "client authorization boundary"
    );
  }
}

/*
 * 9. main.js integration and ordering.
 */
for (
  const factory
  of [
    "createAdminExamsReadFunctions",
    "createAdminQuestionFunctions",
    "createAdminCertificatesReadFunctions"
  ]
) {
  contains(
    main,
    factory,
    "main admin academic factory"
  );
}

for (
  const exportName
  of [
    "...adminExamsReadFunctions,",
    "...adminQuestionFunctions,",
    "...adminCertificatesReadFunctions,"
  ]
) {
  contains(
    main,
    exportName,
    "main admin academic export"
  );
}

const examBlock =
  main.indexOf(
    "const adminExamsReadFunctions ="
  );

const questionBlock =
  main.indexOf(
    "const adminQuestionFunctions ="
  );

const certificateBlock =
  main.indexOf(
    "const adminCertificatesReadFunctions ="
  );

const workflowBlock =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

assert.ok(
  examBlock >= 0 &&
  questionBlock >
    examBlock &&
  certificateBlock >
    questionBlock &&
  workflowBlock >
    certificateBlock,
  "academic admin composition order is invalid"
);

/*
 * All three surfaces are guarded by the shared admin gate.
 */
const adminGateStart =
  main.indexOf(
    "const adminRuntimeAllowed ="
  );

const adminGateEnd =
  main.indexOf(
    "const adminRuntimeEnvironment =",
    adminGateStart
  );

assert.ok(
  adminGateStart >= 0 &&
  adminGateEnd >
    adminGateStart,
  "admin runtime gate missing"
);

const adminGate =
  main.slice(
    adminGateStart,
    adminGateEnd
  );

contains(
  adminGate,
  "firebaseProjectId === STAGING_PROJECT_ID",
  "staging admin gate"
);

contains(
  adminGate,
  "webhookDemoEmulatorAllowed",
  "demo emulator admin gate"
);

excludes(
  adminGate,
  'firebaseProjectId === "bjj-exams"',
  "production admin gate"
);

const academicAdminBlock =
  main.slice(
    examBlock,
    workflowBlock
  );

const adminGateReferences =
  academicAdminBlock
    .split("adminRuntimeAllowed")
    .length - 1;

assert.ok(
  adminGateReferences >= 3,
  "exam/question/certificate surfaces must use adminRuntimeAllowed"
);

excludes(
  academicAdminBlock,
  "webhookRuntimeAllowed",
  "academic admin runtime boundary"
);

/*
 * 10. Read-only exam/certificate services must not write.
 *
 * Do not flag generic Map.set(...), which is used by read-side
 * aggregation helpers. Detect Firestore-style mutation surfaces instead.
 */
for (
  const source
  of [
    examService,
    certificateService
  ]
) {
  for (
    const forbiddenPattern
    of [
      /\bdb\s*\.\s*runTransaction\s*\(/,
      /\bdb\s*\.\s*batch\s*\(/,
      /\b(?:transaction|batch)\s*\.\s*(?:create|set|update|delete)\s*\(/,
      /\bawait\s+[\w$.]+\s*\.\s*(?:create|set|update|delete)\s*\(/,
      /\bFieldValue\b/,
      /\bserverTimestamp\s*\(/
    ]
  ) {
    assert.strictEqual(
      forbiddenPattern.test(
        source
      ),
      false,
      "read service must not perform Firestore writes"
    );
  }
}

console.log(
  "MARCO8_4G_ARCHITECTURE_SEQUENCE=PASSED"
);

console.log(
  "MARCO8_4G_CANONICAL_SOURCES=3/3"
);

console.log(
  "MARCO8_4G_QUESTION_COLLECTION_BINDING=CANONICAL_DOMAIN_CONSTANT"
);

console.log(
  "MARCO8_4G_OPERATIONAL_VIEWS=3/3"
);

console.log(
  "MARCO8_4G_READ_CAPABILITIES=3/3"
);

console.log(
  "MARCO8_4G_QUESTION_MANAGE_BOUNDARY=PASSED"
);

console.log(
  "MARCO8_4G_ANSWER_KEY_BOUNDARY=PASSED"
);

console.log(
  "MARCO8_4G_CERTIFICATE_CANONICAL_REUSE=PASSED"
);

console.log(
  "MARCO8_4G_ADMIN_COMPOSITION=PASSED"
);

console.log(
  "MARCO8_4G_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_4G_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_4G_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_4G_CLIENT_AUTHORIZATION_ESCALATION=BLOCKED"
);

console.log(
  "MARCO8_4G_READ_SERVICE_WRITE_DETECTION=FIRESTORE_SPECIFIC"
);

console.log(
  "MARCO8_4G_READ_SERVICE_WRITES=False"
);

console.log(
  "MARCO8_EXAMS_QUESTIONS_CERTIFICATES_INTEGRATION=PASSED"
);
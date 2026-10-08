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

function count(
  text,
  value
) {
  return text
    .split(value)
    .length - 1;
}

const main =
  read(
    "functions/main.js"
  );

contains(
  main,
  "createAdminCertificatesReadFunctions",
  "certificate factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminCertificatesReadFunctions"
  ),
  2,
  "certificate factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-certificates-read-functions")',
  "certificate import"
);

contains(
  main,
  `const adminRuntimeAllowed =
  firebaseProjectId === STAGING_PROJECT_ID ||
  webhookDemoEmulatorAllowed;`,
  "shared administrative runtime gate"
);

contains(
  main,
  `const adminCertificatesReadFunctions =
  adminRuntimeAllowed
    ? createAdminCertificatesReadFunctions({
        REGION,
        db
      })
    : {};`,
  "certificate guarded composition"
);

contains(
  main,
  "...adminCertificatesReadFunctions,",
  "certificate export"
);

const questionBlockStart =
  main.indexOf(
    "const adminQuestionFunctions ="
  );

const certificateBlockStart =
  main.indexOf(
    "const adminCertificatesReadFunctions ="
  );

const workflowBlockStart =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

assert.ok(
  questionBlockStart >= 0,
  "question composition block missing"
);

assert.ok(
  certificateBlockStart >
    questionBlockStart,
  "certificate block must follow question block"
);

assert.ok(
  workflowBlockStart >
    certificateBlockStart,
  "certificate block must precede course workflow block"
);

const certificateBlock =
  main.slice(
    certificateBlockStart,
    workflowBlockStart
  );

contains(
  certificateBlock,
  "adminRuntimeAllowed",
  "certificate runtime gate"
);

contains(
  certificateBlock,
  "createAdminCertificatesReadFunctions",
  "certificate factory"
);

contains(
  certificateBlock,
  "REGION",
  "certificate REGION binding"
);

contains(
  certificateBlock,
  "db",
  "certificate Firestore binding"
);

for (
  const forbidden
  of [
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "financialEnvironment",
    '"production"',
    "defineSecret",
    "providerFactory",
    "GEMINI_COURSE_MODERATION_API_KEY",
    "revogarCertificadoExameV12",
    "emitirMeuCertificadoExameV12",
    "validarCertificadoExamePublicoV12"
  ]
) {
  assert.strictEqual(
    certificateBlock.includes(
      forbidden
    ),
    false,
    `certificate composition must not bind ${forbidden}`
  );
}

const contextExport =
  main.indexOf(
    "...adminContextFunctions,"
  );

const peopleExport =
  main.indexOf(
    "...adminPeopleReadFunctions,"
  );

const organizationExport =
  main.indexOf(
    "...adminOrganizationsReadFunctions,"
  );

const courseExport =
  main.indexOf(
    "...adminCoursesReadFunctions,"
  );

const examExport =
  main.indexOf(
    "...adminExamsReadFunctions,"
  );

const questionExport =
  main.indexOf(
    "...adminQuestionFunctions,"
  );

const certificateExport =
  main.indexOf(
    "...adminCertificatesReadFunctions,"
  );

const workflowExport =
  main.indexOf(
    "...adminCourseWorkflowFunctions,"
  );

const lifecycleExport =
  main.indexOf(
    "...adminLifecycleFunctions,"
  );

const financialExport =
  main.indexOf(
    "...financialAdminFunctions,"
  );

assert.ok(
  contextExport >= 0 &&
  peopleExport > contextExport &&
  organizationExport > peopleExport &&
  courseExport > organizationExport &&
  examExport > courseExport &&
  questionExport > examExport &&
  certificateExport > questionExport &&
  workflowExport > certificateExport &&
  lifecycleExport > workflowExport &&
  financialExport > lifecycleExport,
  "administrative export order is invalid"
);

const factoryCall =
  `createAdminCertificatesReadFunctions({
        REGION,
        db
      })`;

assert.strictEqual(
  count(
    main,
    factoryCall
  ),
  1,
  "certificate factory must only exist once"
);

/*
 * Fail-closed administrative runtime:
 * production project is not accepted.
 */
const runtimeGateBlockStart =
  main.indexOf(
    "const adminRuntimeAllowed ="
  );

const runtimeGateBlockEnd =
  main.indexOf(
    "const adminRuntimeEnvironment =",
    runtimeGateBlockStart
  );

assert.ok(
  runtimeGateBlockStart >= 0 &&
  runtimeGateBlockEnd >
    runtimeGateBlockStart,
  "administrative runtime gate block missing"
);

const runtimeGateBlock =
  main.slice(
    runtimeGateBlockStart,
    runtimeGateBlockEnd
  );

contains(
  runtimeGateBlock,
  "firebaseProjectId === STAGING_PROJECT_ID",
  "staging runtime allow"
);

contains(
  runtimeGateBlock,
  "webhookDemoEmulatorAllowed",
  "demo emulator runtime allow"
);

assert.strictEqual(
  runtimeGateBlock.includes(
    'firebaseProjectId === "bjj-exams"'
  ),
  false,
  "production project must not be explicitly allowed"
);

assert.strictEqual(
  certificateBlock.includes(
    "webhookRuntimeAllowed"
  ),
  false,
  "certificate operational reads must use administrative runtime gate"
);

console.log(
  "MARCO8_CERTIFICATE_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_CERTIFICATE_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_CERTIFICATE_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_CERTIFICATE_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_CERTIFICATE_MODERATION_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_CERTIFICATE_CANONICAL_MUTATION_BINDING=NONE"
);

console.log(
  "MARCO8_CERTIFICATE_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
);

console.log(
  "MARCO8_CERTIFICATE_RUNTIME_COMPOSITION=PASSED"
);
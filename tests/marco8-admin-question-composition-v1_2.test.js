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
  "createAdminQuestionFunctions",
  "question factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminQuestionFunctions"
  ),
  2,
  "question factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-question-functions")',
  "question import"
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
  `const adminQuestionFunctions =
  adminRuntimeAllowed
    ? createAdminQuestionFunctions({
        REGION,
        db
      })
    : {};`,
  "question guarded composition"
);

contains(
  main,
  "...adminQuestionFunctions,",
  "question export"
);

const examBlockStart =
  main.indexOf(
    "const adminExamsReadFunctions ="
  );

const questionBlockStart =
  main.indexOf(
    "const adminQuestionFunctions ="
  );

const workflowBlockStart =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

assert.ok(
  examBlockStart >= 0,
  "exam composition block missing"
);

assert.ok(
  questionBlockStart >
    examBlockStart,
  "question block must follow exam read block"
);

assert.ok(
  workflowBlockStart >
    questionBlockStart,
  "question block must precede course workflow block"
);

const questionBlock =
  main.slice(
    questionBlockStart,
    workflowBlockStart
  );

contains(
  questionBlock,
  "adminRuntimeAllowed",
  "question runtime gate"
);

contains(
  questionBlock,
  "createAdminQuestionFunctions",
  "question factory"
);

contains(
  questionBlock,
  "REGION",
  "question REGION binding"
);

contains(
  questionBlock,
  "db",
  "question Firestore binding"
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
    "GEMINI_COURSE_MODERATION_API_KEY"
  ]
) {
  assert.strictEqual(
    questionBlock.includes(
      forbidden
    ),
    false,
    `question composition must not bind ${forbidden}`
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
  workflowExport > questionExport &&
  lifecycleExport > workflowExport &&
  financialExport > lifecycleExport,
  "administrative export order is invalid"
);

const factoryCall =
  `createAdminQuestionFunctions({
        REGION,
        db
      })`;

assert.strictEqual(
  count(
    main,
    factoryCall
  ),
  1,
  "question factory must only exist once"
);

/*
 * The administrative runtime condition is explicitly fail-closed:
 * production project ID is not accepted by adminRuntimeAllowed.
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
  questionBlock.includes(
    "webhookRuntimeAllowed"
  ),
  false,
  "question surface must use administrative runtime gate"
);

console.log(
  "MARCO8_QUESTION_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_QUESTION_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_QUESTION_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_QUESTION_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_QUESTION_MODERATION_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_QUESTION_FIRESTORE_DEPENDENCY=READ_WRITE_SERVICES"
);

console.log(
  "MARCO8_QUESTION_RUNTIME_COMPOSITION=PASSED"
);
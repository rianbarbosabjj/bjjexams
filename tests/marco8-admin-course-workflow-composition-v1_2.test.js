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

const functionsSource =
  read(
    "functions/src/admin/admin-course-workflow-functions.js"
  );

contains(
  main,
  "createAdminCourseWorkflowFunctions",
  "course workflow factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminCourseWorkflowFunctions"
  ),
  2,
  "course workflow factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-course-workflow-functions")',
  "course workflow import"
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
  `const adminCourseWorkflowFunctions =
  adminRuntimeAllowed
    ? createAdminCourseWorkflowFunctions({
        REGION,
        db
      })
    : {};`,
  "course workflow guarded composition"
);

contains(
  main,
  "...adminCourseWorkflowFunctions,",
  "course workflow export"
);

contains(
  functionsSource,
  "suspenderCursoOperacionalV12",
  "suspend callable"
);

contains(
  functionsSource,
  "reativarCursoOperacionalV12",
  "reactivate callable"
);

contains(
  functionsSource,
  '"ops.courses.manage"',
  "course workflow capability"
);

const workflowBlockStart =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

const observabilityBlockStart =
  main.indexOf(
    "const adminOperationalObservabilityConfig ="
  );

assert.ok(
  workflowBlockStart >= 0,
  "course workflow composition block missing"
);

assert.ok(
  observabilityBlockStart >
    workflowBlockStart,
  "course workflow block must precede generic lifecycle block"
);

const workflowBlock =
  main.slice(
    workflowBlockStart,
    observabilityBlockStart
  );

contains(
  workflowBlock,
  "adminRuntimeAllowed",
  "course workflow runtime gate"
);

contains(
  workflowBlock,
  "REGION",
  "course workflow REGION binding"
);

contains(
  workflowBlock,
  "db",
  "course workflow Firestore binding"
);

for (
  const forbidden
  of [
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "financialEnvironment",
    "defineSecret",
    "providerFactory",
    "GEMINI_COURSE_MODERATION_API_KEY"
  ]
) {
  assert.strictEqual(
    workflowBlock.includes(
      forbidden
    ),
    false,
    `course workflow composition must not bind ${forbidden}`
  );
}

const readExport =
  main.indexOf(
    "...adminCoursesReadFunctions,"
  );

const workflowExport =
  main.indexOf(
    "...adminCourseWorkflowFunctions,"
  );

const lifecycleExport =
  main.indexOf(
    "...adminLifecycleFunctions,"
  );

const financeExport =
  main.indexOf(
    "...financialAdminFunctions,"
  );

assert.ok(
  readExport >= 0 &&
  workflowExport > readExport &&
  lifecycleExport > workflowExport &&
  financeExport > lifecycleExport,
  "administrative workflow export order is invalid"
);

assert.strictEqual(
  count(
    main,
    `createAdminCourseWorkflowFunctions({
        REGION,
        db
      })`
  ),
  1,
  "course workflow factory call must exist exactly once"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_MODERATION_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_COURSE_WORKFLOW_RUNTIME_COMPOSITION=PASSED"
);

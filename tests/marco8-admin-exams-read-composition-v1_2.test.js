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
  "createAdminExamsReadFunctions",
  "exam read factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminExamsReadFunctions"
  ),
  2,
  "exam read factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-exams-read-functions")',
  "exam read import"
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
  `const adminExamsReadFunctions =
  adminRuntimeAllowed
    ? createAdminExamsReadFunctions({
        REGION,
        db
      })
    : {};`,
  "exam guarded composition"
);

contains(
  main,
  "...adminExamsReadFunctions,",
  "exam read export"
);

const courseBlockStart =
  main.indexOf(
    "const adminCoursesReadFunctions ="
  );

const examBlockStart =
  main.indexOf(
    "const adminExamsReadFunctions ="
  );

const workflowBlockStart =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

assert.ok(
  courseBlockStart >= 0,
  "course composition block missing"
);

assert.ok(
  examBlockStart >
    courseBlockStart,
  "exam block must follow course read block"
);

assert.ok(
  workflowBlockStart >
    examBlockStart,
  "exam block must precede course workflow block"
);

const examBlock =
  main.slice(
    examBlockStart,
    workflowBlockStart
  );

contains(
  examBlock,
  "adminRuntimeAllowed",
  "exam runtime gate"
);

contains(
  examBlock,
  "createAdminExamsReadFunctions",
  "exam factory"
);

contains(
  examBlock,
  "REGION",
  "exam REGION binding"
);

contains(
  examBlock,
  "db",
  "exam Firestore binding"
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
    examBlock.includes(
      forbidden
    ),
    false,
    `exam composition must not bind ${forbidden}`
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
  workflowExport > examExport &&
  lifecycleExport > workflowExport &&
  financialExport > lifecycleExport,
  "administrative export order is invalid"
);

const factoryCall =
  `createAdminExamsReadFunctions({
        REGION,
        db
      })`;

assert.strictEqual(
  count(
    main,
    factoryCall
  ),
  1,
  "exam factory must only exist once"
);

console.log(
  "MARCO8_EXAM_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_EXAM_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_EXAM_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_EXAM_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_EXAM_MODERATION_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_EXAM_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
);

console.log(
  "MARCO8_EXAM_RUNTIME_COMPOSITION=PASSED"
);
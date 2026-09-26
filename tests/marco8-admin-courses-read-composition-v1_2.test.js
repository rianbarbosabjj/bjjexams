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
  "createAdminCoursesReadFunctions",
  "course read factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminCoursesReadFunctions"
  ),
  2,
  "course read factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-courses-read-functions")',
  "course read import"
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
  `const adminCoursesReadFunctions =
  adminRuntimeAllowed
    ? createAdminCoursesReadFunctions({
        REGION,
        db
      })
    : {};`,
  "course guarded composition"
);

contains(
  main,
  "...adminCoursesReadFunctions,",
  "course read export"
);

const courseBlockStart =
  main.indexOf(
    "const adminCoursesReadFunctions ="
  );

const lifecycleBlockStart =
  main.indexOf(
    "const adminLifecycleFunctions ="
  );

assert.ok(
  courseBlockStart >= 0,
  "course composition block missing"
);

assert.ok(
  lifecycleBlockStart >
    courseBlockStart,
  "course block must precede lifecycle block"
);

const courseBlock =
  main.slice(
    courseBlockStart,
    lifecycleBlockStart
  );

contains(
  courseBlock,
  "adminRuntimeAllowed",
  "course runtime gate"
);

contains(
  courseBlock,
  "createAdminCoursesReadFunctions",
  "course factory"
);

contains(
  courseBlock,
  "REGION",
  "course REGION binding"
);

contains(
  courseBlock,
  "db",
  "course Firestore binding"
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
    courseBlock.includes(
      forbidden
    ),
    false,
    `course composition must not bind ${forbidden}`
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
  lifecycleExport > courseExport &&
  financialExport > lifecycleExport,
  "administrative export order is invalid"
);

const factoryCall =
  `createAdminCoursesReadFunctions({
        REGION,
        db
      })`;

assert.strictEqual(
  count(
    main,
    factoryCall
  ),
  1,
  "course factory must only exist once"
);

console.log(
  "MARCO8_COURSE_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_COURSE_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_COURSE_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_COURSE_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_COURSE_MODERATION_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_COURSE_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
);

console.log(
  "MARCO8_COURSE_RUNTIME_COMPOSITION=PASSED"
);

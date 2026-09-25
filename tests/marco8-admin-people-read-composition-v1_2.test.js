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
  "createAdminPeopleReadFunctions",
  "people read factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminPeopleReadFunctions"
  ),
  2,
  "people read factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-people-read-functions")',
  "people read module import"
);

contains(
  main,
  `const adminRuntimeAllowed =
  firebaseProjectId === STAGING_PROJECT_ID ||
  webhookDemoEmulatorAllowed;`,
  "shared admin runtime gate"
);

contains(
  main,
  `const adminPeopleReadFunctions =
  adminRuntimeAllowed
    ? createAdminPeopleReadFunctions({
        REGION,
        db
      })
    : {};`,
  "people read guarded composition"
);

contains(
  main,
  "...adminPeopleReadFunctions,",
  "people read export"
);

const peopleBlockStart =
  main.indexOf(
    "const adminPeopleReadFunctions ="
  );

const financeBlockStart =
  main.indexOf(
    "const financialAdminFunctions ="
  );

assert.ok(
  peopleBlockStart >= 0,
  "people composition block missing"
);

assert.ok(
  financeBlockStart >
    peopleBlockStart,
  "people block must precede financial admin block"
);

const peopleBlock =
  main.slice(
    peopleBlockStart,
    financeBlockStart
  );

assert.ok(
  peopleBlock.includes(
    "adminRuntimeAllowed"
  ),
  "people composition must use admin runtime gate"
);

assert.ok(
  peopleBlock.includes(
    "createAdminPeopleReadFunctions"
  ),
  "people composition factory missing"
);

assert.ok(
  peopleBlock.includes(
    "REGION"
  ),
  "people composition REGION missing"
);

assert.ok(
  peopleBlock.includes(
    "db"
  ),
  "people composition Firestore dependency missing"
);

for (
  const forbidden of [
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "financialEnvironment",
    '"production"',
    "defineSecret",
    "providerFactory"
  ]
) {
  assert.strictEqual(
    peopleBlock.includes(
      forbidden
    ),
    false,
    `people composition must not bind ${forbidden}`
  );
}

assert.ok(
  main.indexOf(
    "...adminPeopleReadFunctions,"
  ) >
  main.indexOf(
    "const adminPeopleReadFunctions ="
  ),
  "people exports must follow composition"
);

const adminContextExport =
  main.indexOf(
    "...adminContextFunctions,"
  );

const peopleExport =
  main.indexOf(
    "...adminPeopleReadFunctions,"
  );

const financialExport =
  main.indexOf(
    "...financialAdminFunctions,"
  );

assert.ok(
  adminContextExport >= 0 &&
  peopleExport > adminContextExport &&
  financialExport > peopleExport,
  "administrative export order is invalid"
);

console.log(
  "MARCO8_PEOPLE_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_PEOPLE_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_PEOPLE_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_PEOPLE_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_PEOPLE_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
);

console.log(
  "MARCO8_PEOPLE_EXPORT=PASSED"
);

console.log(
  "MARCO8_PEOPLE_RUNTIME_COMPOSITION=PASSED"
);

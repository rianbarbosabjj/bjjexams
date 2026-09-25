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
  "createAdminLifecycleFunctions",
  "lifecycle factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminLifecycleFunctions"
  ),
  2,
  "lifecycle factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-lifecycle-functions")',
  "lifecycle module import"
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
  `const adminLifecycleFunctions =
  adminRuntimeAllowed
    ? createAdminLifecycleFunctions({
        REGION,
        db
      })
    : {};`,
  "lifecycle guarded composition"
);

contains(
  main,
  "...adminLifecycleFunctions,",
  "lifecycle export"
);

const lifecycleBlockStart =
  main.indexOf(
    "const adminLifecycleFunctions ="
  );

const financeBlockStart =
  main.indexOf(
    "const financialAdminFunctions ="
  );

assert.ok(
  lifecycleBlockStart >= 0,
  "lifecycle composition block missing"
);

assert.ok(
  financeBlockStart >
    lifecycleBlockStart,
  "lifecycle block must precede financial admin block"
);

const lifecycleBlock =
  main.slice(
    lifecycleBlockStart,
    financeBlockStart
  );

contains(
  lifecycleBlock,
  "adminRuntimeAllowed",
  "lifecycle runtime gate"
);

contains(
  lifecycleBlock,
  "createAdminLifecycleFunctions",
  "lifecycle factory"
);

contains(
  lifecycleBlock,
  "REGION",
  "lifecycle REGION binding"
);

contains(
  lifecycleBlock,
  "db",
  "lifecycle Firestore binding"
);

for (
  const forbidden of [
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "financialEnvironment",
    '"production"',
    "defineSecret",
    "providerFactory",
    "getAuth",
    "revokeRefreshTokens",
    "setCustomUserClaims"
  ]
) {
  assert.strictEqual(
    lifecycleBlock.includes(
      forbidden
    ),
    false,
    `lifecycle composition must not bind ${forbidden}`
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
  lifecycleExport > organizationExport &&
  financialExport > lifecycleExport,
  "administrative export order is invalid"
);

assert.ok(
  lifecycleExport >
    lifecycleBlockStart,
  "lifecycle export must follow composition"
);

console.log(
  "MARCO8_LIFECYCLE_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_LIFECYCLE_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_LIFECYCLE_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_LIFECYCLE_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_LIFECYCLE_AUTH_BINDING=NONE"
);

console.log(
  "MARCO8_LIFECYCLE_FIRESTORE_DEPENDENCY=TRANSACTIONAL_SERVICE"
);

console.log(
  "MARCO8_LIFECYCLE_EXPORT=PASSED"
);

console.log(
  "MARCO8_LIFECYCLE_RUNTIME_COMPOSITION=PASSED"
);

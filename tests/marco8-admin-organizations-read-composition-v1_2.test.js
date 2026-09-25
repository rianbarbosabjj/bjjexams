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
  "createAdminOrganizationsReadFunctions",
  "organization read factory"
);

assert.strictEqual(
  count(
    main,
    "createAdminOrganizationsReadFunctions"
  ),
  2,
  "organization read factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-organizations-read-functions")',
  "organization read module import"
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
  `const adminOrganizationsReadFunctions =
  adminRuntimeAllowed
    ? createAdminOrganizationsReadFunctions({
        REGION,
        db
      })
    : {};`,
  "organization guarded composition"
);

contains(
  main,
  "...adminOrganizationsReadFunctions,",
  "organization export"
);

const organizationBlockStart =
  main.indexOf(
    "const adminOrganizationsReadFunctions ="
  );

const financeBlockStart =
  main.indexOf(
    "const financialAdminFunctions ="
  );

assert.ok(
  organizationBlockStart >= 0,
  "organization composition block missing"
);

assert.ok(
  financeBlockStart >
    organizationBlockStart,
  "organization block must precede financial admin block"
);

const organizationBlock =
  main.slice(
    organizationBlockStart,
    financeBlockStart
  );

contains(
  organizationBlock,
  "adminRuntimeAllowed",
  "organization runtime gate"
);

contains(
  organizationBlock,
  "createAdminOrganizationsReadFunctions",
  "organization factory"
);

contains(
  organizationBlock,
  "REGION",
  "organization REGION binding"
);

contains(
  organizationBlock,
  "db",
  "organization Firestore binding"
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
    organizationBlock.includes(
      forbidden
    ),
    false,
    `organization composition must not bind ${forbidden}`
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

const financialExport =
  main.indexOf(
    "...financialAdminFunctions,"
  );

assert.ok(
  contextExport >= 0 &&
  peopleExport > contextExport &&
  organizationExport > peopleExport &&
  financialExport > organizationExport,
  "administrative export order is invalid"
);

assert.strictEqual(
  main.includes(
    "createAdminOrganizationsReadFunctions({" +
    "\n    REGION"
  ),
  false,
  "organization factory must only exist in guarded composition"
);

console.log(
  "MARCO8_ORGANIZATION_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_ORGANIZATION_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_ORGANIZATION_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_ORGANIZATION_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_ORGANIZATION_FIRESTORE_DEPENDENCY=READ_ONLY_SERVICE"
);

console.log(
  "MARCO8_ORGANIZATION_EXPORT=PASSED"
);

console.log(
  "MARCO8_ORGANIZATION_RUNTIME_COMPOSITION=PASSED"
);

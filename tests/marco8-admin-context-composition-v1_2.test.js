"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT =
  path.resolve(__dirname, "..");

function read(relativePath) {
  return fs
    .readFileSync(
      path.join(ROOT, relativePath),
      "utf8"
    )
    .replace(/\r\n/g, "\n");
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
  read("functions/main.js");

contains(
  main,
  'createAdminContextFunctions',
  "admin context import"
);

assert.strictEqual(
  count(
    main,
    "createAdminContextFunctions"
  ),
  2,
  "admin context factory symbol count"
);

contains(
  main,
  'require("./src/admin/admin-context-functions")',
  "admin context module import"
);

contains(
  main,
  `const adminRuntimeAllowed =
  firebaseProjectId === STAGING_PROJECT_ID ||
  webhookDemoEmulatorAllowed;`,
  "admin runtime gate"
);

contains(
  main,
  `const adminRuntimeEnvironment =
  firebaseProjectId === STAGING_PROJECT_ID
    ? "staging"
    : webhookDemoEmulatorAllowed
      ? "demo-emulator"
      : null;`,
  "admin environment mapping"
);

contains(
  main,
  `const adminContextFunctions =
  adminRuntimeAllowed
    ? createAdminContextFunctions({
        REGION,
        environment: adminRuntimeEnvironment
      })
    : {};`,
  "admin context guarded composition"
);

contains(
  main,
  "...adminContextFunctions,",
  "admin context export"
);

const adminBlockStart =
  main.indexOf(
    "const adminContextFunctions ="
  );

const financeBlockStart =
  main.indexOf(
    "const financialAdminFunctions ="
  );

assert.ok(
  adminBlockStart >= 0
);

assert.ok(
  financeBlockStart > adminBlockStart
);

const adminCompositionBlock =
  main.slice(
    adminBlockStart,
    financeBlockStart
  );

assert.ok(
  !adminCompositionBlock.includes(
    "ASAAS_API_KEY"
  ),
  "admin context must not bind Asaas API key"
);

assert.ok(
  !adminCompositionBlock.includes(
    "ASAAS_WEBHOOK_TOKEN"
  ),
  "admin context must not bind webhook token"
);

assert.ok(
  !adminCompositionBlock.includes(
    "financialEnvironment"
  ),
  "admin context must not depend on financial environment"
);

assert.ok(
  !adminCompositionBlock.includes(
    '"production"'
  ),
  "admin context production environment must not be composed"
);

assert.ok(
  main.indexOf(
    "...adminContextFunctions,"
  ) >
  main.indexOf(
    "const adminContextFunctions ="
  )
);

console.log(
  "MARCO8_ADMIN_COMPOSITION_IMPORT=PASSED"
);

console.log(
  "MARCO8_ADMIN_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_ADMIN_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_ADMIN_FINANCIAL_SECRET_BINDING=NONE"
);

console.log(
  "MARCO8_ADMIN_CONTEXT_EXPORT=PASSED"
);

console.log(
  "MARCO8_ADMIN_CONTEXT_COMPOSITION=PASSED"
);

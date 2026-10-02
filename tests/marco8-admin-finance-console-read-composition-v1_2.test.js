"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const source =
  fs
    .readFileSync(
      path.join(
        __dirname,
        "../functions/main.js"
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );

assert.ok(
  source.includes(
    'createAdminFinanceConsoleReadFunctions'
  )
);

assert.ok(
  source.includes(
    'const adminFinanceConsoleReadFunctions ='
  )
);

assert.ok(
  source.includes(
    'adminRuntimeAllowed'
  )
);

assert.ok(
  source.includes(
    'environment: financialEnvironment'
  )
);

assert.ok(
  source.includes(
    '...adminFinanceConsoleReadFunctions'
  )
);

const creationBlockStart =
  source.indexOf(
    'const adminFinanceConsoleReadFunctions ='
  );

const creationBlockEnd =
  source.indexOf(
    'const financialAdminFunctions =',
    creationBlockStart
  );

assert.ok(
  creationBlockStart >=
    0
);

assert.ok(
  creationBlockEnd >
    creationBlockStart
);

const creationBlock =
  source.slice(
    creationBlockStart,
    creationBlockEnd
  );

assert.ok(
  creationBlock.includes(
    'adminRuntimeAllowed'
  )
);

assert.ok(
  creationBlock.includes(
    'createAdminFinanceConsoleReadFunctions'
  )
);

assert.strictEqual(
  creationBlock.includes(
    'providerFactory'
  ),
  false
);

assert.strictEqual(
  creationBlock.includes(
    'secrets:'
  ),
  false
);

assert.strictEqual(
  creationBlock.includes(
    'ASAAS_API_KEY'
  ),
  false
);

assert.strictEqual(
  creationBlock.includes(
    'ASAAS_WEBHOOK_TOKEN'
  ),
  false
);

console.log(
  "MARCO8_7D1_ADMIN_RUNTIME_GATE=PASSED"
);

console.log(
  "MARCO8_7D1_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_7D1_PROVIDER_SECRET_BINDING=False"
);

console.log(
  "MARCO8_7D1_COMPOSITION=PASSED"
);

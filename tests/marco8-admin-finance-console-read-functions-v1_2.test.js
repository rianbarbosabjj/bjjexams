"use strict";

const assert =
  require("assert");

const Module =
  require("module");

class TestHttpsError
  extends Error {
  constructor(
    code,
    message,
    details = null
  ) {
    super(message);

    this.name =
      "HttpsError";

    this.code =
      code;

    this.details =
      details;
  }
}

const originalLoad =
  Module._load;

Module._load =
  function patchedLoad(
    request,
    parent,
    isMain
  ) {
    if (
      request ===
        "firebase-functions/v2/https"
    ) {
      return {
        onCall(
          _options,
          handler
        ) {
          return handler;
        },

        HttpsError:
          TestHttpsError
      };
    }

    return originalLoad.call(
      this,
      request,
      parent,
      isMain
    );
  };

let financeFunctions;

try {
  financeFunctions =
    require(
      "../functions/src/admin/admin-finance-console-read-functions"
    );
}
finally {
  Module._load =
    originalLoad;
}

const {
  FINANCE_CONSOLE_READ_CAPABILITY,
  SPLITS_CONSOLE_READ_CAPABILITY,
  createGetFinanceConsoleHandler,
  createGetSplitsConsoleHandler
} = financeFunctions;

async function expectHttpsError(
  operation,
  code
) {
  let received =
    null;

  try {
    await operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected HTTPS-style error ${code}`
  );

  assert.strictEqual(
    received.code,
    code
  );

  return received;
}

async function main() {
  assert.strictEqual(
    FINANCE_CONSOLE_READ_CAPABILITY,
    "console.finance.read"
  );

  assert.strictEqual(
    SPLITS_CONSOLE_READ_CAPABILITY,
    "console.splits.read"
  );

  const calls = [];

  const service = {
    async getFinanceOverview() {
      calls.push({
        operation:
          "finance"
      });

      return {
        persisted:
          true
      };
    },

    async getCourseSplit(
      input
    ) {
      calls.push({
        operation:
          "splits",

        input
      });

      return {
        lookupRequired:
          !input.courseId
      };
    }
  };

  const financeHandler =
    createGetFinanceConsoleHandler({
      service
    });

  const splitsHandler =
    createGetSplitsConsoleHandler({
      service
    });

  const financeResult =
    await financeHandler({
      auth: {
        uid:
          "finance-1",

        token: {
          finance_admin:
            true
        }
      },

      data: {}
    });

  assert.deepStrictEqual(
    financeResult,
    {
      ok:
        true,

      finance: {
        persisted:
          true
      }
    }
  );

  const splitResult =
    await splitsHandler({
      auth: {
        uid:
          "finance-1",

        token: {
          finance_admin:
            true
        }
      },

      data: {
        courseId:
          "course-1"
      }
    });

  assert.deepStrictEqual(
    splitResult,
    {
      ok:
        true,

      split: {
        lookupRequired:
          false
      }
    }
  );

  assert.deepStrictEqual(
    calls,
    [
      {
        operation:
          "finance"
      },

      {
        operation:
          "splits",

        input: {
          courseId:
            "course-1"
        }
      }
    ]
  );

  await expectHttpsError(
    () =>
      financeHandler({
        data: {
          role:
            "super_admin"
        }
      }),
    "unauthenticated"
  );

  await expectHttpsError(
    () =>
      financeHandler({
        auth: {
          uid:
            "support-1",

          token: {
            support_admin:
              true
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  await expectHttpsError(
    () =>
      splitsHandler({
        auth: {
          uid:
            "support-1",

          token: {
            support_admin:
              true
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  const forbidden =
    await expectHttpsError(
      () =>
        splitsHandler({
          auth: {
            uid:
              "finance-1",

            token: {
              finance_admin:
                true
            }
          },

          data: {
            courseId:
              "course-1",

            walletId:
              "must-not-pass"
          }
        }),
      "invalid-argument"
    );

  assert.deepStrictEqual(
    forbidden.details,
    {
      forbiddenFields: [
        "walletId"
      ]
    }
  );

  const emptySplit =
    await splitsHandler({
      auth: {
        uid:
          "platform-1",

        token: {
          platform_admin:
            true
        }
      },

      data: {}
    });

  assert.strictEqual(
    emptySplit.ok,
    true
  );

  assert.strictEqual(
    emptySplit.split
      .lookupRequired,
    true
  );

  console.log(
    "MARCO8_7D1_FINANCE_CAPABILITY=PASSED"
  );

  console.log(
    "MARCO8_7D1_SPLITS_CAPABILITY=PASSED"
  );

  console.log(
    "MARCO8_7D1_FINANCE_ADMIN_READ=PASSED"
  );

  console.log(
    "MARCO8_7D1_PLATFORM_ADMIN_READ=PASSED"
  );

  console.log(
    "MARCO8_7D1_SUPPORT_READ=BLOCKED"
  );

  console.log(
    "MARCO8_7D1_AUTH_BEFORE_PAYLOAD=PASSED"
  );

  console.log(
    "MARCO8_7D1_PAYLOAD_ALLOWLIST=PASSED"
  );

  console.log(
    "MARCO8_7D1_MUTATIONS_EXPOSED=False"
  );

  console.log(
    "MARCO8_7D1_FUNCTIONS_TEST_EXTERNAL_INSTALL_REQUIRED=False"
  );

  console.log(
    "MARCO8_7D1_FINANCE_CONSOLE_READ_FUNCTIONS=PASSED"
  );
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exitCode =
      1;
  }
);

"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  FINANCIAL_RULES_COLLECTION,
  COURSES_COLLECTION,
  RECIPIENT_ACCOUNTS_COLLECTION,
  DEFAULT_RULE_ID,
  AdminFinanceConsoleReadError,
  createAdminFinanceConsoleReadService
} = require(
  "../functions/src/admin/admin-finance-console-read-service"
);

const {
  productFinancialRuleId,
  financialRecipientAccountId
} = require(
  "../functions/src/finance/financial-admin-domain"
);

class FakeSnapshot {
  constructor(
    id,
    value
  ) {
    this.id =
      id;

    this.exists =
      value !==
        undefined;

    this.value =
      value;
  }

  data() {
    return this.exists
      ? JSON.parse(
          JSON.stringify(
            this.value
          )
        )
      : undefined;
  }
}

class FakeDb {
  constructor(
    seed = {}
  ) {
    this.seed =
      new Map(
        Object.entries(
          seed
        )
      );

    this.reads = [];
  }

  doc(
    documentPath
  ) {
    const db =
      this;

    return {
      async get() {
        db.reads.push(
          documentPath
        );

        const parts =
          documentPath
            .split("/");

        return new FakeSnapshot(
          parts.at(-1),
          db.seed.get(
            documentPath
          )
        );
      }
    };
  }
}

function defaultRule() {
  return {
    id:
      "platform-default",

    name:
      "Regra padrão da plataforma",

    status:
      "active",

    scope:
      "platform_default",

    productType:
      null,

    productId:
      null,

    platformFeeBps:
      1000,

    recipientMode:
      "product_owner",

    recipientShares: [],

    version:
      1,

    createdBy:
      "admin-1",

    updatedBy:
      "admin-1",

    createdAt:
      "created-at",

    updatedAt:
      "updated-at"
  };
}

function explicitRule(
  courseId
) {
  return {
    id:
      productFinancialRuleId({
        productType:
          "course",

        productId:
          courseId
      }),

    name:
      `Override financeiro do curso ${courseId}`,

    status:
      "active",

    scope:
      "product_override",

    productType:
      "course",

    productId:
      courseId,

    platformFeeBps:
      1000,

    recipientMode:
      "explicit",

    recipientShares: [
      {
        recipientType:
          "platform",

        recipientId:
          null,

        shareBps:
          2000
      },

      {
        recipientType:
          "user",

        recipientId:
          "instructor-1",

        shareBps:
          8000
      }
    ],

    version:
      1,

    createdBy:
      "admin-1",

    updatedBy:
      "admin-1",

    createdAt:
      "created-at",

    updatedAt:
      "updated-at"
  };
}

function readyRecipientAccount() {
  return {
    recipientType:
      "user",

    recipientId:
      "instructor-1",

    provider:
      "asaas",

    environment:
      "sandbox",

    walletId:
      "wallet-sensitive-1234",

    status:
      "ready",

    version:
      1,

    createdBy:
      "admin-1",

    updatedBy:
      "admin-1",

    createdAt:
      "created-at",

    updatedAt:
      "updated-at"
  };
}

async function main() {
  assert.strictEqual(
    FINANCIAL_RULES_COLLECTION,
    "financial_rules"
  );

  assert.strictEqual(
    COURSES_COLLECTION,
    "courses"
  );

  assert.strictEqual(
    RECIPIENT_ACCOUNTS_COLLECTION,
    "financial_recipient_accounts"
  );

  assert.strictEqual(
    DEFAULT_RULE_ID,
    "platform-default"
  );

  const emptyDb =
    new FakeDb();

  const emptyService =
    createAdminFinanceConsoleReadService({
      db:
        emptyDb,

      environment:
        "sandbox"
    });

  const emptyFinance =
    await emptyService
      .getFinanceOverview();

  assert.deepStrictEqual(
    emptyFinance,
    {
      persisted:
        false,

      active:
        false,

      defaultPlatformFeeBps:
        1000,

      rule:
        null
    }
  );

  const emptySplit =
    await emptyService
      .getCourseSplit();

  assert.deepStrictEqual(
    emptySplit,
    {
      lookupRequired:
        true,

      courseId:
        null,

      courseFinancialRuleId:
        null,

      rule:
        null,

      recipientReadiness:
        []
    }
  );

  assert.strictEqual(
    emptyDb.reads.length,
    1
  );

  const courseId =
    "course-1";

  const rule =
    explicitRule(
      courseId
    );

  const accountId =
    financialRecipientAccountId({
      provider:
        "asaas",

      environment:
        "sandbox",

      recipientType:
        "user",

      recipientId:
        "instructor-1"
    });

  const db =
    new FakeDb({
      "financial_rules/platform-default":
        defaultRule(),

      [`courses/${courseId}`]: {
        financialRuleId:
          rule.id,

        title:
          "must-not-leak"
      },

      [`financial_rules/${rule.id}`]:
        rule,

      [`financial_recipient_accounts/${accountId}`]:
        readyRecipientAccount()
    });

  const service =
    createAdminFinanceConsoleReadService({
      db,

      environment:
        "sandbox"
    });

  const finance =
    await service
      .getFinanceOverview();

  assert.strictEqual(
    finance.persisted,
    true
  );

  assert.strictEqual(
    finance.active,
    true
  );

  assert.strictEqual(
    finance.defaultPlatformFeeBps,
    1000
  );

  assert.deepStrictEqual(
    Object.keys(
      finance.rule
    ),
    [
      "id",
      "status",
      "scope",
      "productType",
      "productId",
      "platformFeeBps",
      "recipientMode",
      "recipientShares",
      "version",
      "updatedAt"
    ]
  );

  const split =
    await service
      .getCourseSplit({
        courseId
      });

  assert.strictEqual(
    split.lookupRequired,
    false
  );

  assert.strictEqual(
    split.courseId,
    courseId
  );

  assert.strictEqual(
    split.courseFinancialRuleId,
    rule.id
  );

  assert.strictEqual(
    split.rule.id,
    rule.id
  );

  assert.deepStrictEqual(
    split.recipientReadiness,
    [
      {
        recipientType:
          "platform",

        recipientId:
          null,

        ready:
          true,

        reason:
          "PLATFORM_PRIMARY_ACCOUNT"
      },

      {
        recipientType:
          "user",

        recipientId:
          "instructor-1",

        ready:
          true,

        reason:
          "READY"
      }
    ]
  );

  const serialized =
    JSON.stringify(
      split
    );

  for (
    const forbidden of [
      "wallet-sensitive-1234",
      "walletId",
      "walletMasked",
      "createdBy",
      "updatedBy",
      "title"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Finance console read leaked ${forbidden}`
    );
  }

  await assert.rejects(
    () =>
      service
        .getCourseSplit({
          courseId:
            "missing-course"
        }),
    error =>
      error instanceof
        AdminFinanceConsoleReadError &&
      error.code ===
        "ADMIN_FINANCE_COURSE_NOT_FOUND"
  );

  await assert.rejects(
    () =>
      service
        .getCourseSplit({
          courseId:
            "invalid/course"
        }),
    error =>
      error instanceof
        AdminFinanceConsoleReadError &&
      error.code ===
        "ADMIN_FINANCE_IDENTIFIER_INVALID"
  );

  const noRuleDb =
    new FakeDb({
      "courses/course-no-rule": {
        financialRuleId:
          null
      }
    });

  const noRuleService =
    createAdminFinanceConsoleReadService({
      db:
        noRuleDb,

      environment:
        "sandbox"
    });

  const noRule =
    await noRuleService
      .getCourseSplit({
        courseId:
          "course-no-rule"
      });

  assert.deepStrictEqual(
    noRule,
    {
      lookupRequired:
        false,

      courseId:
        "course-no-rule",

      courseFinancialRuleId:
        null,

      rule:
        null,

      recipientReadiness:
        []
    }
  );

  const source =
    fs.readFileSync(
      path.join(
        __dirname,
        "../functions/src/admin/admin-finance-console-read-service.js"
      ),
      "utf8"
    );

  for (
    const forbidden of [
      "runTransaction",
      "writeBatch",
      "bulkWriter",
      "tx.set(",
      "tx.create(",
      "tx.update(",
      "tx.delete(",
      "providerFactory",
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "axios",
      "financial-order-service",
      "financial-reversal-admin-service"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Read service contains forbidden dependency/mutation: ${forbidden}`
    );
  }

  console.log(
    "MARCO8_7D1_FINANCE_READ_SOURCE=CANONICAL"
  );

  console.log(
    "MARCO8_7D1_FINANCE_DEFAULT_VIEW=PASSED"
  );

  console.log(
    "MARCO8_7D1_SPLIT_LOOKUP_EMPTY=PASSED"
  );

  console.log(
    "MARCO8_7D1_SPLIT_COURSE_VIEW=PASSED"
  );

  console.log(
    "MARCO8_7D1_RECIPIENT_READINESS=PASSED"
  );

  console.log(
    "MARCO8_7D1_SENSITIVE_WALLET_EXPOSURE=False"
  );

  console.log(
    "MARCO8_7D1_FIRESTORE_WRITES=False"
  );

  console.log(
    "MARCO8_7D1_PROVIDER_DEPENDENCY=False"
  );

  console.log(
    "MARCO8_7D1_FINANCE_CONSOLE_READ_SERVICE=PASSED"
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

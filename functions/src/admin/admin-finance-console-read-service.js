"use strict";

const {
  DEFAULT_PLATFORM_FEE_BPS
} = require(
  "../finance/financial-domain"
);

const {
  FinancialAdminDomainError,
  financialRecipientAccountId,
  productFinancialRuleId,
  recipientReadiness,
  financialRuleView
} = require(
  "../finance/financial-admin-domain"
);

const FINANCIAL_RULES_COLLECTION =
  "financial_rules";

const COURSES_COLLECTION =
  "courses";

const RECIPIENT_ACCOUNTS_COLLECTION =
  "financial_recipient_accounts";

const DEFAULT_RULE_ID =
  "platform-default";

class AdminFinanceConsoleReadError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminFinanceConsoleReadError";

    this.code =
      code;
  }
}

function text(
  value,
  maxLength = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(
        0,
        maxLength
      )
    : null;
}

function optionalIdentifier(
  value,
  field
) {
  const normalized =
    text(
      value,
      200
    );

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("/")
  ) {
    throw new AdminFinanceConsoleReadError(
      "ADMIN_FINANCE_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function snapshotData(
  snapshot
) {
  if (
    !snapshot ||
    snapshot.exists !== true
  ) {
    return null;
  }

  return (
    typeof snapshot.data ===
      "function"
      ? snapshot.data()
      : null
  );
}

function storedRule(
  snapshot,
  expectedId
) {
  const data =
    snapshotData(
      snapshot
    );

  if (!data) {
    return null;
  }

  return {
    ...data,
    id:
      snapshot.id ||
      expectedId
  };
}

function createAdminFinanceConsoleReadService(
  dependencies = {}
) {
  const {
    db,
    environment,
    provider = "asaas"
  } = dependencies;

  if (
    !db ||
    typeof db.doc !==
      "function"
  ) {
    throw new TypeError(
      "Admin finance console read service requires Firestore."
    );
  }

  const canonicalEnvironment =
    String(
      environment || ""
    )
      .trim()
      .toLowerCase();

  if (
    ![
      "sandbox",
      "production"
    ].includes(
      canonicalEnvironment
    )
  ) {
    throw new TypeError(
      "Admin finance console read service requires sandbox or production environment."
    );
  }

  const canonicalProvider =
    String(
      provider || ""
    )
      .trim()
      .toLowerCase();

  if (
    canonicalProvider !==
      "asaas"
  ) {
    throw new TypeError(
      "Admin finance console read service supports only the canonical Asaas provider."
    );
  }

  async function getFinanceOverview() {
    const snapshot =
      await db
        .doc(
          `${FINANCIAL_RULES_COLLECTION}/${DEFAULT_RULE_ID}`
        )
        .get();

    if (!snapshot.exists) {
      return Object.freeze({
        persisted:
          false,

        active:
          false,

        defaultPlatformFeeBps:
          DEFAULT_PLATFORM_FEE_BPS,

        rule:
          null
      });
    }

    let rule;

    try {
      rule =
        financialRuleView(
          storedRule(
            snapshot,
            DEFAULT_RULE_ID
          )
        );
    }
    catch (error) {
      if (
        error instanceof
          FinancialAdminDomainError ||
        error?.name ===
          "FinancialDomainError"
      ) {
        throw new AdminFinanceConsoleReadError(
          "ADMIN_FINANCE_CANONICAL_STATE_INVALID",
          "Canonical platform financial rule is invalid."
        );
      }

      throw error;
    }

    return Object.freeze({
      persisted:
        true,

      active:
        rule.status ===
          "active",

      defaultPlatformFeeBps:
        DEFAULT_PLATFORM_FEE_BPS,

      rule:
        Object.freeze({
          ...rule
        })
    });
  }

  async function getCourseSplit(
    input = {}
  ) {
    const courseId =
      optionalIdentifier(
        input.courseId,
        "courseId"
      );

    if (!courseId) {
      return Object.freeze({
        lookupRequired:
          true,

        courseId:
          null,

        courseFinancialRuleId:
          null,

        rule:
          null,

        recipientReadiness:
          Object.freeze([])
      });
    }

    const ruleId =
      productFinancialRuleId({
        productType:
          "course",

        productId:
          courseId
      });

    const courseRef =
      db.doc(
        `${COURSES_COLLECTION}/${courseId}`
      );

    const ruleRef =
      db.doc(
        `${FINANCIAL_RULES_COLLECTION}/${ruleId}`
      );

    const [
      courseSnapshot,
      ruleSnapshot
    ] =
      await Promise.all([
        courseRef.get(),
        ruleRef.get()
      ]);

    if (!courseSnapshot.exists) {
      throw new AdminFinanceConsoleReadError(
        "ADMIN_FINANCE_COURSE_NOT_FOUND",
        "Course was not found."
      );
    }

    const course =
      snapshotData(
        courseSnapshot
      ) || {};

    if (!ruleSnapshot.exists) {
      return Object.freeze({
        lookupRequired:
          false,

        courseId,

        courseFinancialRuleId:
          text(
            course.financialRuleId,
            200
          ),

        rule:
          null,

        recipientReadiness:
          Object.freeze([])
      });
    }

    let rule;

    try {
      rule =
        financialRuleView(
          storedRule(
            ruleSnapshot,
            ruleId
          )
        );
    }
    catch (error) {
      if (
        error instanceof
          FinancialAdminDomainError ||
        error?.name ===
          "FinancialDomainError"
      ) {
        throw new AdminFinanceConsoleReadError(
          "ADMIN_FINANCE_CANONICAL_STATE_INVALID",
          "Canonical course financial rule is invalid."
        );
      }

      throw error;
    }

    const readiness = [];

    if (
      rule.recipientMode ===
        "explicit"
    ) {
      for (
        const share of
        rule.recipientShares
      ) {
        if (
          share.recipientType ===
            "platform"
        ) {
          readiness.push(
            Object.freeze({
              recipientType:
                "platform",

              recipientId:
                null,

              ready:
                true,

              reason:
                "PLATFORM_PRIMARY_ACCOUNT"
            })
          );

          continue;
        }

        const accountId =
          financialRecipientAccountId({
            provider:
              canonicalProvider,

            environment:
              canonicalEnvironment,

            recipientType:
              share.recipientType,

            recipientId:
              share.recipientId
          });

        const accountSnapshot =
          await db
            .doc(
              `${RECIPIENT_ACCOUNTS_COLLECTION}/${accountId}`
            )
            .get();

        const state =
          recipientReadiness({
            recipientType:
              share.recipientType,

            recipientId:
              share.recipientId,

            account:
              accountSnapshot.exists
                ? snapshotData(
                    accountSnapshot
                  )
                : null,

            provider:
              canonicalProvider,

            environment:
              canonicalEnvironment
          });

        readiness.push(
          Object.freeze({
            recipientType:
              share.recipientType,

            recipientId:
              share.recipientId,

            ready:
              state.ready,

            reason:
              state.reason
          })
        );
      }
    }

    return Object.freeze({
      lookupRequired:
        false,

      courseId,

      courseFinancialRuleId:
        text(
          course.financialRuleId,
          200
        ),

      rule:
        Object.freeze({
          ...rule
        }),

      recipientReadiness:
        Object.freeze(
          readiness
        )
    });
  }

  return Object.freeze({
    getFinanceOverview,
    getCourseSplit
  });
}

module.exports = {
  FINANCIAL_RULES_COLLECTION,
  COURSES_COLLECTION,
  RECIPIENT_ACCOUNTS_COLLECTION,
  DEFAULT_RULE_ID,

  AdminFinanceConsoleReadError,
  optionalIdentifier,
  createAdminFinanceConsoleReadService
};

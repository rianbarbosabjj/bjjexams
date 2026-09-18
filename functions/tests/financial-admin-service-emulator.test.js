"use strict";

const assert = require("node:assert/strict");
const {
  initializeApp,
  deleteApp
} = require("firebase-admin/app");
const {
  getFirestore
} = require("firebase-admin/firestore");

const {
  createFinancialAdminService
} = require("../src/finance/financial-admin-service");

const {
  financialRecipientAccountId,
  productFinancialRuleId
} = require("../src/finance/financial-admin-domain");

function assertLocal(name, value) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)
  ) {
    throw new Error(
      `${name} nao e local: ${value || "<EMPTY>"}`
    );
  }
}

assertLocal(
  "FIRESTORE_EMULATOR_HOST",
  process.env.FIRESTORE_EMULATOR_HOST
);

const projectId = "demo-bjj-exams-finance-admin";
const app = initializeApp(
  { projectId },
  `financial-admin-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const now1 = new Date("2026-09-17T22:00:00.000Z");
const now2 = new Date("2026-09-17T22:05:00.000Z");
const now3 = new Date("2026-09-17T22:10:00.000Z");

let passed = 0;

function id(label) {
  return `${label}_${runId}`;
}

function claims(role = "platform_admin") {
  return {
    [role]: true
  };
}

function adminInput(actorId, data = {}, role = "platform_admin") {
  return {
    actorId,
    claims: claims(role),
    data
  };
}

function paidCourse(overrides = {}) {
  return {
    title: "Curso financeiro admin emulator",
    description:
      "Curso pago usado somente no teste local do dominio financeiro administrativo.",
    ownerType: "user",
    ownerId: id("owner"),
    instructorIds: [id("owner")],
    visibility: "platform",
    organizationId: null,
    status: "published",
    isPaid: true,
    priceCents: 10000,
    currency: "BRL",
    financialRuleId: null,
    createdBy: id("creator"),
    createdAt: now1,
    updatedAt: now1,
    publishedAt: now1,
    ...overrides
  };
}

function service({
  clock = () => now1,
  dbOverride = db
} = {}) {
  return createFinancialAdminService({
    db: dbOverride,
    environment: "sandbox",
    clock
  });
}

function rollbackDb(fixedAuditId) {
  return {
    doc(path) {
      return db.doc(path);
    },

    collection(name) {
      if (name === "audit_logs") {
        return {
          doc() {
            return db.doc(
              `audit_logs/${fixedAuditId}`
            );
          }
        };
      }

      return db.collection(name);
    },

    runTransaction(callback) {
      return db.runTransaction(callback);
    }
  };
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function auditDocs(actorId) {
  return db
    .collection("audit_logs")
    .where("actorId", "==", actorId)
    .get();
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();

  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();

    for (const doc of snap.docs.slice(offset, offset + 400)) {
      batch.delete(doc.ref);
    }

    await batch.commit();
  }
}

async function cleanup() {
  for (const collectionName of [
    "audit_logs",
    "financial_rules",
    "financial_recipient_accounts",
    "courses",
    "usuarios",
    "organizacoes"
  ]) {
    await deleteCollection(collectionName);
  }

  await deleteApp(app);
}

async function main() {
  try {
    await test(
      "default persiste regra e audit na mesma operacao real",
      async () => {
        const actor = id("admin_default");
        const financial =
          service({ clock: () => now1 });

        const result =
          await financial.updateDefaultRule(
            adminInput(actor, {
              platformFeeBps: 1000
            })
          );

        assert.equal(result.changed, true);
        assert.equal(result.created, true);
        assert.equal(result.rule.version, 1);

        const ruleSnap = await db.doc(
          "financial_rules/platform-default"
        ).get();

        assert.equal(ruleSnap.exists, true);
        assert.equal(
          ruleSnap.data().platformFeeBps,
          1000
        );
        assert.equal(ruleSnap.data().version, 1);

        const audits = await auditDocs(actor);
        assert.equal(audits.size, 1);
        assert.equal(
          audits.docs[0].data().action,
          "financial.default_rule.updated"
        );
      }
    );

    await test(
      "default identico nao cria nova versao nem nova auditoria",
      async () => {
        const actor = id("admin_default");
        const financial =
          service({ clock: () => now2 });

        const beforeAudits = await auditDocs(actor);

        const result =
          await financial.updateDefaultRule(
            adminInput(actor, {
              platformFeeBps: 1000
            })
          );

        const afterAudits = await auditDocs(actor);
        const ruleSnap = await db.doc(
          "financial_rules/platform-default"
        ).get();

        assert.equal(result.changed, false);
        assert.equal(ruleSnap.data().version, 1);
        assert.equal(
          afterAudits.size,
          beforeAudits.size
        );
      }
    );

    await test(
      "conta canonical ready persiste e auditoria nao expoe wallet completa",
      async () => {
        const actor = id("admin_account");
        const userId = id("recipient_user");
        const walletId =
          `wallet-sandbox-${runId}-9876`;

        await db.doc(
          `usuarios/${userId}`
        ).set({
          nome: "Recebedor canônico"
        });

        const financial =
          service({ clock: () => now1 });

        const result =
          await financial.configureRecipientAccount(
            adminInput(actor, {
              recipientType: "user",
              recipientId: userId,
              walletId,
              status: "ready"
            })
          );

        assert.equal(result.changed, true);
        assert.equal(result.account.status, "ready");
        assert.equal(
          result.account.walletMasked,
          "••••9876"
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(
            result.account,
            "walletId"
          ),
          false
        );

        const accountId =
          financialRecipientAccountId({
            environment: "sandbox",
            recipientType: "user",
            recipientId: userId
          });

        const accountSnap = await db.doc(
          `financial_recipient_accounts/${accountId}`
        ).get();

        assert.equal(accountSnap.exists, true);
        assert.equal(
          accountSnap.data().walletId,
          walletId
        );

        const audits = await auditDocs(actor);
        assert.equal(audits.size, 1);

        const auditJson = JSON.stringify(
          audits.docs[0].data()
        );

        assert.equal(
          auditJson.includes(walletId),
          false
        );
        assert.equal(
          auditJson.includes("••••9876"),
          true
        );
      }
    );

    await test(
      "override explicit liga curso e retorna readiness sem wallet",
      async () => {
        const actor = id("admin_override");
        const courseId = id("course_explicit");
        const userId = id("recipient_explicit");

        await db.doc(
          `courses/${courseId}`
        ).set(
          paidCourse({
            ownerId: userId,
            instructorIds: [userId]
          })
        );

        await db.doc(
          `usuarios/${userId}`
        ).set({
          nome: "Recebedor explicit"
        });

        const financial =
          service({ clock: () => now1 });

        await financial.configureRecipientAccount(
          adminInput(actor, {
            recipientType: "user",
            recipientId: userId,
            walletId:
              `wallet-explicit-${runId}-4321`,
            status: "ready"
          })
        );

        const result =
          await financial.saveCourseRule(
            adminInput(actor, {
              courseId,
              status: "active",
              platformFeeBps: 1000,
              recipientMode: "explicit",
              recipientShares: [
                {
                  recipientType: "user",
                  recipientId: userId,
                  shareBps: 10000
                }
              ]
            })
          );

        const ruleId =
          productFinancialRuleId({
            productType: "course",
            productId: courseId
          });

        assert.equal(result.changed, true);
        assert.equal(
          result.courseFinancialRuleId,
          ruleId
        );

        const [courseSnap, ruleSnap] =
          await Promise.all([
            db.doc(
              `courses/${courseId}`
            ).get(),
            db.doc(
              `financial_rules/${ruleId}`
            ).get()
          ]);

        assert.equal(
          courseSnap.data().financialRuleId,
          ruleId
        );
        assert.equal(ruleSnap.exists, true);
        assert.equal(
          ruleSnap.data().recipientMode,
          "explicit"
        );

        const view =
          await financial.getCourseRule({
            actorId: actor,
            claims: claims(),
            courseId
          });

        assert.equal(
          view.recipientReadiness.length,
          1
        );
        assert.equal(
          view.recipientReadiness[0].ready,
          true
        );
        assert.equal(
          JSON.stringify(view).includes(
            "wallet-explicit"
          ),
          false
        );
      }
    );

    await test(
      "override identico e no-op e inativacao preserva regra limpando vinculo",
      async () => {
        const actor = id("admin_override");
        const courseId = id("course_explicit");
        const userId = id("recipient_explicit");

        const financialNoop =
          service({ clock: () => now2 });

        const beforeAudits = await auditDocs(actor);

        const noop =
          await financialNoop.saveCourseRule(
            adminInput(actor, {
              courseId,
              status: "active",
              platformFeeBps: 1000,
              recipientMode: "explicit",
              recipientShares: [
                {
                  recipientType: "user",
                  recipientId: userId,
                  shareBps: 10000
                }
              ]
            })
          );

        const afterNoopAudits =
          await auditDocs(actor);

        assert.equal(noop.changed, false);
        assert.equal(
          afterNoopAudits.size,
          beforeAudits.size
        );

        const financialInactive =
          service({ clock: () => now3 });

        const inactive =
          await financialInactive.saveCourseRule(
            adminInput(actor, {
              courseId,
              status: "inactive",
              platformFeeBps: 1000,
              recipientMode: "explicit",
              recipientShares: [
                {
                  recipientType: "user",
                  recipientId: userId,
                  shareBps: 10000
                }
              ]
            })
          );

        assert.equal(inactive.changed, true);
        assert.equal(
          inactive.courseFinancialRuleId,
          null
        );
        assert.equal(inactive.rule.status, "inactive");
        assert.equal(inactive.rule.version, 2);

        const ruleId =
          productFinancialRuleId({
            productType: "course",
            productId: courseId
          });

        const [courseSnap, ruleSnap] =
          await Promise.all([
            db.doc(
              `courses/${courseId}`
            ).get(),
            db.doc(
              `financial_rules/${ruleId}`
            ).get()
          ]);

        assert.equal(
          courseSnap.data().financialRuleId,
          null
        );
        assert.equal(ruleSnap.exists, true);
        assert.equal(
          ruleSnap.data().status,
          "inactive"
        );
        assert.equal(
          ruleSnap.data().version,
          2
        );
      }
    );

    await test(
      "falha ao criar audit faz rollback de regra e vinculo do curso",
      async () => {
        const actor = id("admin_rollback");
        const courseId = id("course_rollback");
        const fixedAuditId = id("audit_collision");

        await db.doc(
          `courses/${courseId}`
        ).set(
          paidCourse()
        );

        await db.doc(
          `audit_logs/${fixedAuditId}`
        ).set({
          sentinel: true,
          actorId: id("sentinel")
        });

        const financial = service({
          clock: () => now1,
          dbOverride: rollbackDb(
            fixedAuditId
          )
        });

        await assert.rejects(
          financial.saveCourseRule(
            adminInput(actor, {
              courseId,
              status: "active",
              platformFeeBps: 1250,
              recipientMode: "product_owner",
              recipientShares: []
            })
          )
        );

        const ruleId =
          productFinancialRuleId({
            productType: "course",
            productId: courseId
          });

        const [courseSnap, ruleSnap, auditSnap] =
          await Promise.all([
            db.doc(
              `courses/${courseId}`
            ).get(),
            db.doc(
              `financial_rules/${ruleId}`
            ).get(),
            db.doc(
              `audit_logs/${fixedAuditId}`
            ).get()
          ]);

        assert.equal(
          courseSnap.data().financialRuleId,
          null
        );
        assert.equal(ruleSnap.exists, false);
        assert.equal(auditSnap.exists, true);
        assert.equal(
          auditSnap.data().sentinel,
          true
        );
      }
    );

    console.log(
      `FINANCIAL_ADMIN_SERVICE_EMULATOR_V1_2=${passed}/6`
    );
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

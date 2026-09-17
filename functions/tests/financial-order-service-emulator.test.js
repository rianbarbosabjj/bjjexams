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
  FinancialDomainError
} = require("../src/finance/financial-domain");
const {
  createFinancialOrderService
} = require("../src/finance/financial-order-service");

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

const projectId = "demo-bjj-exams-finance";
const app = initializeApp(
  { projectId },
  `financial-order-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdPaths = new Set();
const buyers = new Set();
let passed = 0;

function id(label) {
  return `${label}_${runId}`;
}

async function setDoc(path, data) {
  await db.doc(path).set(data);
  createdPaths.add(path);
}

function paidCourse(overrides = {}) {
  return {
    title: "Curso financeiro emulator",
    description:
      "Curso publicado e pago para validar o domínio financeiro no emulador.",
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
    ...overrides
  };
}

function defaultRule(overrides = {}) {
  return {
    name: "Regra padrao 10%",
    status: "active",
    scope: "platform_default",
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: "product_owner",
    recipientShares: [],
    version: 1,
    createdBy: id("admin"),
    updatedBy: id("admin"),
    createdAt: new Date("2026-09-17T20:00:00.000Z"),
    updatedAt: new Date("2026-09-17T20:00:00.000Z"),
    ...overrides
  };
}

function overrideRule(courseId, overrides = {}) {
  return {
    name: "Override curso 15%",
    status: "active",
    scope: "product_override",
    productType: "course",
    productId: courseId,
    platformFeeBps: 1500,
    recipientMode: "product_owner",
    recipientShares: [],
    version: 2,
    createdBy: id("admin"),
    updatedBy: id("admin"),
    createdAt: new Date("2026-09-17T20:00:00.000Z"),
    updatedAt: new Date("2026-09-17T20:00:00.000Z"),
    ...overrides
  };
}

function serviceDb({
  fixedOrderId = null,
  fixedAuditId = null
} = {}) {
  return {
    doc(path) {
      return db.doc(path);
    },

    collection(name) {
      if (name === "orders" && fixedOrderId) {
        return {
          doc() {
            return db.doc(`orders/${fixedOrderId}`);
          }
        };
      }

      if (name === "audit_logs" && fixedAuditId) {
        return {
          doc() {
            return db.doc(`audit_logs/${fixedAuditId}`);
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

function service(options = {}) {
  return createFinancialOrderService({
    db: serviceDb(options),
    clock: () => new Date("2026-09-17T21:00:00.000Z")
  });
}

async function trackGeneratedAudit(buyerUserId) {
  const snap = await db
    .collection("audit_logs")
    .where("actorId", "==", buyerUserId)
    .get();

  for (const doc of snap.docs) {
    createdPaths.add(doc.ref.path);
  }

  return snap;
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function cleanup() {
  for (const buyer of buyers) {
    const orderSnap = await db
      .collection("orders")
      .where("buyerUserId", "==", buyer)
      .get();

    for (const doc of orderSnap.docs) {
      createdPaths.add(doc.ref.path);
    }

    await trackGeneratedAudit(buyer);
  }

  const ordered = [...createdPaths]
    .sort(
      (a, b) =>
        b.split("/").length -
        a.split("/").length
    );

  for (let offset = 0; offset < ordered.length; offset += 400) {
    const batch = db.batch();

    for (const path of ordered.slice(offset, offset + 400)) {
      batch.delete(db.doc(path));
    }

    await batch.commit();
  }

  await deleteApp(app);
}

async function main() {
  try {
    await test(
      "regra default cria order e audit atomicos no Firestore real",
      async () => {
        const courseId = id("course_default");
        const buyer = id("buyer_default");
        buyers.add(buyer);

        await setDoc(
          `courses/${courseId}`,
          paidCourse()
        );
        await setDoc(
          "financial_rules/platform-default",
          defaultRule()
        );

        const result =
          await service().createPendingCourseOrder({
            buyerUserId: buyer,
            courseId,
            idempotencyKey: id("intent_default")
          });

        createdPaths.add(`orders/${result.orderId}`);

        const persisted =
          await db.doc(`orders/${result.orderId}`).get();

        assert.equal(persisted.exists, true);

        const order = persisted.data();
        assert.equal(order.status, "pending_payment");
        assert.equal(order.amountCents, 10000);
        assert.equal(order.provider, null);
        assert.equal(order.currentTransactionId, null);
        assert.equal(
          order.financialSnapshot.ruleId,
          "platform-default"
        );
        assert.equal(
          order.financialSnapshot.platformFeeCents,
          1000
        );
        assert.equal(
          order.financialSnapshot.sellerPoolCents,
          9000
        );

        const audits = await trackGeneratedAudit(buyer);
        assert.equal(audits.size, 1);
        assert.equal(
          audits.docs[0].data().action,
          "financial.order.created"
        );
        assert.equal(
          audits.docs[0].data().entityId,
          result.orderId
        );
      }
    );

    await test(
      "override referenciado pelo curso e persistido no snapshot",
      async () => {
        const courseId = id("course_override");
        const ruleId = id("rule_override");
        const buyer = id("buyer_override");
        buyers.add(buyer);

        await setDoc(
          `courses/${courseId}`,
          paidCourse({
            financialRuleId: ruleId
          })
        );
        await setDoc(
          `financial_rules/${ruleId}`,
          overrideRule(courseId)
        );

        const result =
          await service().createPendingCourseOrder({
            buyerUserId: buyer,
            courseId,
            idempotencyKey: id("intent_override")
          });

        createdPaths.add(`orders/${result.orderId}`);

        const orderSnap =
          await db.doc(`orders/${result.orderId}`).get();
        const order = orderSnap.data();

        assert.equal(
          order.financialSnapshot.ruleId,
          ruleId
        );
        assert.equal(
          order.financialSnapshot.ruleVersion,
          2
        );
        assert.equal(
          order.financialSnapshot.platformFeeBps,
          1500
        );
        assert.equal(
          order.financialSnapshot.platformFeeCents,
          1500
        );

        const audits = await trackGeneratedAudit(buyer);
        assert.equal(audits.size, 1);
      }
    );

    await test(
      "override ausente falha fechado e nao persiste order nem audit",
      async () => {
        const courseId = id("course_missing_override");
        const buyer = id("buyer_missing_override");
        buyers.add(buyer);

        await setDoc(
          `courses/${courseId}`,
          paidCourse({
            financialRuleId: id("missing_rule")
          })
        );

        await assert.rejects(
          service().createPendingCourseOrder({
            buyerUserId: buyer,
            courseId,
            idempotencyKey: id("intent_missing_override")
          }),
          error =>
            error instanceof FinancialDomainError &&
            error.code === "FINANCIAL_OVERRIDE_NOT_FOUND"
        );

        const orders = await db
          .collection("orders")
          .where("buyerUserId", "==", buyer)
          .get();

        const audits = await db
          .collection("audit_logs")
          .where("actorId", "==", buyer)
          .get();

        assert.equal(orders.empty, true);
        assert.equal(audits.empty, true);
      }
    );

    await test(
      "falha na segunda create da transacao faz rollback do order",
      async () => {
        const courseId = id("course_rollback");
        const buyer = id("buyer_rollback");
        const orderId = id("forced_order");
        const auditId = id("forced_audit");
        buyers.add(buyer);

        await setDoc(
          `courses/${courseId}`,
          paidCourse()
        );
        await setDoc(
          `audit_logs/${auditId}`,
          {
            sentinel: true,
            actorId: id("sentinel_actor")
          }
        );

        await assert.rejects(
          service({
            fixedOrderId: orderId,
            fixedAuditId: auditId
          }).createPendingCourseOrder({
            buyerUserId: buyer,
            courseId,
            idempotencyKey: id("intent_rollback")
          })
        );

        const orderSnap =
          await db.doc(`orders/${orderId}`).get();
        const auditSnap =
          await db.doc(`audit_logs/${auditId}`).get();

        assert.equal(orderSnap.exists, false);
        assert.equal(auditSnap.exists, true);
        assert.equal(auditSnap.data().sentinel, true);
      }
    );

    console.log(
      `FINANCIAL_ORDER_SERVICE_EMULATOR_V1_2=${passed}/4`
    );
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

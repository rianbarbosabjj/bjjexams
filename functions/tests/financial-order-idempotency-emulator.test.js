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

const projectId =
  "demo-bjj-exams-finance-order-idempotency";

const app = initializeApp(
  { projectId },
  `financial-order-idempotency-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdPaths = new Set();
let passed = 0;

function id(label) {
  return `${label}_${runId}`;
}

function course(ownerId, overrides = {}) {
  return {
    title: "Curso idempotencia",
    description:
      "Curso usado exclusivamente no gate de idempotencia financeira.",
    ownerType: "user",
    ownerId,
    instructorIds: [ownerId],
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
    createdAt: new Date("2026-09-18T10:00:00.000Z"),
    updatedAt: new Date("2026-09-18T10:00:00.000Z"),
    ...overrides
  };
}

function service() {
  return createFinancialOrderService({
    db,
    clock: () =>
      new Date("2026-09-18T11:30:00.000Z")
  });
}

async function setDoc(path, data) {
  await db.doc(path).set(data);
  createdPaths.add(path);
}

async function trackOrderArtifacts(buyerUserId) {
  const orders = await db
    .collection("orders")
    .where("buyerUserId", "==", buyerUserId)
    .get();

  for (const doc of orders.docs) {
    createdPaths.add(doc.ref.path);
  }

  const audits = await db
    .collection("audit_logs")
    .where("actorId", "==", buyerUserId)
    .get();

  for (const doc of audits.docs) {
    createdPaths.add(doc.ref.path);
  }

  return { orders, audits };
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function cleanup() {
  const ordered = [...createdPaths]
    .sort(
      (a, b) =>
        b.split("/").length -
        a.split("/").length
    );

  for (
    let offset = 0;
    offset < ordered.length;
    offset += 400
  ) {
    const batch = db.batch();

    for (
      const path
      of ordered.slice(offset, offset + 400)
    ) {
      batch.delete(db.doc(path));
    }

    await batch.commit();
  }

  await deleteApp(app);
}

async function main() {
  try {
    await test(
      "retry sequencial converge para o mesmo pedido e um audit",
      async () => {
        const buyer = id("buyer_seq");
        const owner = id("owner_seq");
        const courseId = id("course_seq");
        const input = {
          buyerUserId: buyer,
          courseId,
          idempotencyKey: id("intent_seq")
        };

        await setDoc(
          `courses/${courseId}`,
          course(owner)
        );
        await setDoc(
          "financial_rules/platform-default",
          defaultRule()
        );

        const first =
          await service().createPendingCourseOrder(input);
        const second =
          await service().createPendingCourseOrder(input);

        createdPaths.add(`orders/${first.orderId}`);

        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(second.orderId, first.orderId);
        assert.equal(
          second.order.financialSnapshot.ruleVersion,
          1
        );

        const artifacts =
          await trackOrderArtifacts(buyer);

        assert.equal(artifacts.orders.size, 1);
        assert.equal(artifacts.audits.size, 1);
      }
    );

    await test(
      "duas chamadas concorrentes criam um pedido e um audit",
      async () => {
        const buyer = id("buyer_concurrent");
        const owner = id("owner_concurrent");
        const courseId = id("course_concurrent");
        const input = {
          buyerUserId: buyer,
          courseId,
          idempotencyKey: id("intent_concurrent")
        };

        await setDoc(
          `courses/${courseId}`,
          course(owner)
        );
        await setDoc(
          "financial_rules/platform-default",
          defaultRule()
        );

        const [left, right] = await Promise.all([
          service().createPendingCourseOrder(input),
          service().createPendingCourseOrder(input)
        ]);

        createdPaths.add(`orders/${left.orderId}`);

        assert.equal(left.orderId, right.orderId);
        assert.equal(
          [left.created, right.created]
            .filter(Boolean)
            .length,
          1
        );

        const artifacts =
          await trackOrderArtifacts(buyer);

        assert.equal(artifacts.orders.size, 1);
        assert.equal(artifacts.audits.size, 1);
      }
    );

    await test(
      "retry real preserva snapshot mesmo apos mudanca de preco e regra",
      async () => {
        const buyer = id("buyer_history");
        const owner = id("owner_history");
        const courseId = id("course_history");
        const input = {
          buyerUserId: buyer,
          courseId,
          idempotencyKey: id("intent_history")
        };

        await setDoc(
          `courses/${courseId}`,
          course(owner)
        );
        await setDoc(
          "financial_rules/platform-default",
          defaultRule()
        );

        const first =
          await service().createPendingCourseOrder(input);
        createdPaths.add(`orders/${first.orderId}`);

        await db.doc(`courses/${courseId}`).update({
          priceCents: 25000
        });
        await db.doc("financial_rules/platform-default").update({
          platformFeeBps: 2000,
          version: 2,
          updatedAt: new Date("2026-09-18T12:00:00.000Z")
        });

        const second =
          await service().createPendingCourseOrder(input);

        assert.equal(second.created, false);
        assert.equal(second.order.amountCents, 10000);
        assert.equal(
          second.order.financialSnapshot.platformFeeBps,
          1000
        );
        assert.equal(
          second.order.financialSnapshot.ruleVersion,
          1
        );

        const artifacts =
          await trackOrderArtifacts(buyer);

        assert.equal(artifacts.orders.size, 1);
        assert.equal(artifacts.audits.size, 1);
      }
    );

    console.log(
      `FINANCIAL_ORDER_IDEMPOTENCY_EMULATOR_V1_2=${passed}/3`
    );

    if (passed !== 3) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

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
  getAuth
} = require("firebase-admin/auth");

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

assertLocal(
  "FIREBASE_AUTH_EMULATOR_HOST",
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);

const projectId = "demo-bjj-exams";

const functionBase =
  `http://127.0.0.1:5001/${projectId}/southamerica-east1`;

const authBase =
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const app = initializeApp(
  { projectId },
  `financial-admin-functions-${process.pid}-${Date.now()}`
);

const db = getFirestore(app);
const auth = getAuth(app);

const runId =
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createdUids = new Set();
let passed = 0;

function id(label) {
  return `finance_admin_${runId}_${label}`;
}

function email(label) {
  return `${id(label)}@example.test`;
}

function password(label) {
  return `Finance-${runId}-${label}!Aa1`;
}

async function createUser(label, claims = {}) {
  const uid = id(label);
  const mail = email(label);
  const pass = password(label);

  await auth.createUser({
    uid,
    email: mail,
    password: pass,
    emailVerified: true
  });

  createdUids.add(uid);

  if (Object.keys(claims).length) {
    await auth.setCustomUserClaims(
      uid,
      claims
    );
  }

  await db.doc(
    `usuarios/${uid}`
  ).set({
    nome: label,
    email: mail,
    status_conta: "ativo"
  });

  return {
    uid,
    email: mail,
    password: pass
  };
}

async function signIn(actor) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email: actor.email,
        password: actor.password,
        returnSecureToken: true
      })
    }
  );

  const body = await response.json();

  assert.ok(
    body.idToken,
    JSON.stringify(body)
  );

  return body.idToken;
}

async function call(
  functionName,
  token,
  data = {}
) {
  const headers = {
    "content-type": "application/json"
  };

  if (token) {
    headers.authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    `${functionBase}/${functionName}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        data
      })
    }
  );

  const text = await response.text();
  let body = {};

  try {
    body = JSON.parse(text);
  } catch (_) {}

  return {
    status: response.status,
    body,
    text
  };
}

function payload(response) {
  return (
    response.body?.result ??
    response.body?.data ??
    null
  );
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function deleteCollection(name) {
  const snap =
    await db.collection(name).get();

  for (
    let offset = 0;
    offset < snap.docs.length;
    offset += 400
  ) {
    const batch = db.batch();

    for (
      const doc
      of snap.docs.slice(
        offset,
        offset + 400
      )
    ) {
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
    "orders",
    "payment_transactions",
    "payment_webhook_events",
    "enrollments",
    "courses",
    "usuarios"
  ]) {
    await deleteCollection(
      collectionName
    );
  }

  await Promise.allSettled(
    [...createdUids]
      .map(uid => auth.deleteUser(uid))
  );

  await deleteApp(app);
}

async function main() {
  try {
    const platformAdmin =
      await createUser(
        "platform",
        {
          platform_admin: true
        }
      );

    const superAdmin =
      await createUser(
        "super",
        {
          super_admin: true
        }
      );

    const financeAdmin =
      await createUser(
        "finance",
        {
          finance_admin: true
        }
      );

    const contentAdmin =
      await createUser(
        "content",
        {
          content_admin: true
        }
      );

    const recipient =
      await createUser(
        "recipient"
      );

    const platformToken =
      await signIn(platformAdmin);

    const superToken =
      await signIn(superAdmin);

    const financeToken =
      await signIn(financeAdmin);

    const contentToken =
      await signIn(contentAdmin);

    await test(
      "anonimo nao consulta configuracao financeira",
      async () => {
        const response = await call(
          "obterConfiguracaoFinanceiraV12",
          null,
          {}
        );

        assert.equal(
          response.status,
          401,
          response.text
        );
      }
    );

    await test(
      "finance_admin isolado continua sem permissao",
      async () => {
        const response = await call(
          "obterConfiguracaoFinanceiraV12",
          financeToken,
          {}
        );

        assert.equal(
          response.status,
          403,
          response.text
        );
      }
    );

    await test(
      "content_admin nao administra financeiro",
      async () => {
        const response = await call(
          "obterConfiguracaoFinanceiraV12",
          contentToken,
          {}
        );

        assert.equal(
          response.status,
          403,
          response.text
        );
      }
    );

    await test(
      "platform_admin consulta default ausente sanitizado",
      async () => {
        const response = await call(
          "obterConfiguracaoFinanceiraV12",
          platformToken,
          {}
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(
          result.configuration.persisted,
          false
        );
        assert.equal(
          result.configuration.defaultPlatformFeeBps,
          1000
        );
        assert.equal(
          result.configuration.rule,
          null
        );
      }
    );

    await test(
      "super_admin inicializa default de 10 por cento",
      async () => {
        const response = await call(
          "atualizarTaxaPadraoFinanceiraV12",
          superToken,
          {
            platformFeeBps: 1000
          }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(result.created, true);
        assert.equal(
          result.rule.platformFeeBps,
          1000
        );
        assert.equal(
          result.rule.version,
          1
        );
      }
    );

    await test(
      "payload extra na taxa padrao e rejeitado",
      async () => {
        const response = await call(
          "atualizarTaxaPadraoFinanceiraV12",
          platformToken,
          {
            platformFeeBps: 1000,
            recipientMode: "explicit"
          }
        );

        assert.equal(
          response.status,
          400,
          response.text
        );

        const snap = await db.doc(
          "financial_rules/platform-default"
        ).get();

        assert.equal(
          snap.data().version,
          1
        );
      }
    );

    const walletId =
      `wallet-functions-${runId}-2468`;

    await test(
      "platform_admin configura recebedor com retorno mascarado",
      async () => {
        const response = await call(
          "configurarContaRecebedorFinanceiroV12",
          platformToken,
          {
            recipientType: "user",
            recipientId: recipient.uid,
            walletId,
            status: "ready"
          }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(result.account.status, "ready");
        assert.equal(
          result.account.walletMasked,
          "••••2468"
        );
        assert.equal(
          result.account.walletConfigured,
          true
        );

        assert.equal(
          JSON.stringify(result).includes(
            walletId
          ),
          false
        );

        const accountId =
          financialRecipientAccountId({
            environment: "sandbox",
            recipientType: "user",
            recipientId: recipient.uid
          });

        const persisted = await db.doc(
          `financial_recipient_accounts/${accountId}`
        ).get();

        assert.equal(
          persisted.data().walletId,
          walletId
        );
      }
    );

    const courseId = id("course");

    await db.doc(
      `courses/${courseId}`
    ).set({
      title:
        "Curso pago para Functions Emulator",
      description:
        "Curso usado exclusivamente no gate local das callables financeiras.",
      ownerType: "user",
      ownerId: recipient.uid,
      instructorIds: [
        recipient.uid
      ],
      visibility: "platform",
      organizationId: null,
      status: "published",
      isPaid: true,
      priceCents: 10000,
      currency: "BRL",
      financialRuleId: null,
      createdBy: platformAdmin.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: new Date()
    });

    await test(
      "override explicit e salvo por callable e liga curso",
      async () => {
        const response = await call(
          "salvarRegraFinanceiraCursoV12",
          platformToken,
          {
            courseId,
            status: "active",
            platformFeeBps: 1000,
            recipientMode: "explicit",
            recipientShares: [
              {
                recipientType: "user",
                recipientId: recipient.uid,
                shareBps: 10000
              }
            ]
          }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(result.changed, true);
        assert.equal(
          result.rule.recipientMode,
          "explicit"
        );

        const ruleId =
          productFinancialRuleId({
            productType: "course",
            productId: courseId
          });

        const courseSnap = await db.doc(
          `courses/${courseId}`
        ).get();

        assert.equal(
          courseSnap.data().financialRuleId,
          ruleId
        );
      }
    );

    await test(
      "consulta de override retorna readiness sem wallet",
      async () => {
        const response = await call(
          "obterRegraFinanceiraCursoV12",
          superToken,
          {
            courseId
          }
        );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result = payload(response);

        assert.equal(result.ok, true);
        assert.equal(
          result.recipientReadiness.length,
          1
        );
        assert.equal(
          result.recipientReadiness[0].ready,
          true
        );
        assert.equal(
          JSON.stringify(result).includes(
            walletId
          ),
          false
        );
      }
    );

    await test(
      "callables 5.2 nao criam pedido pagamento ou enrollment",
      async () => {
        for (const name of [
          "orders",
          "payment_transactions",
          "payment_webhook_events",
          "enrollments"
        ]) {
          const snap =
            await db.collection(name).get();

          assert.equal(
            snap.empty,
            true,
            `${name} nao deveria possuir documentos`
          );
        }
      }
    );

    console.log(
      `FINANCIAL_ADMIN_FUNCTIONS_EMULATOR_V1_2=${passed}/10`
    );
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

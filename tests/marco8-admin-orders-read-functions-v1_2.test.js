"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  ORDERS_READ_CAPABILITY,
  createListOrdersHandler,
  createGetOrderHandler,
  mapOrdersReadError
} = require(
  "../functions/src/admin/admin-orders-read-functions"
);

const {
  AdminOrdersReadError
} = require(
  "../functions/src/admin/admin-orders-read-service"
);

const {
  AdminOrderModelError
} = require(
  "../functions/src/admin/admin-order-models"
);

function requestFor(
  role,
  data = {}
) {
  return {
    auth: {
      uid:
        `uid-${role}`,

      token: {
        [role]:
          true
      }
    },

    data
  };
}

async function expectHttpsError(
  operation,
  expectedCode
) {
  let captured = null;

  try {
    await operation();
  }
  catch (error) {
    captured =
      error;
  }

  assert.ok(
    captured,
    "Expected HTTPS-style error."
  );

  assert.strictEqual(
    captured.code,
    expectedCode
  );

  return captured;
}

function operationalOrder(
  orderId = "order-1"
) {
  return {
    orderId,
    productType:
      "course",

    productSummary: {
      productType:
        "course",
      productId:
        "course-1",
      label:
        "Curso Teste"
    },

    buyerSummary: {
      userId:
        "user-1",
      displayName:
        "Aluno Teste",
      email:
        "aluno@example.com"
    },

    paymentStatus: {
      orderStatus:
        "paid",
      transactionStatus:
        "paid"
    },

    fulfillmentStatus: {
      kind:
        "enrollment",
      status:
        "active"
    },

    reversalStatus: {
      status:
        null,
      operation:
        null
    },

    reconciliationStatus: {
      required:
        false
    },

    createdAt:
      "2026-09-30T10:00:00.000Z"
  };
}

function makeService() {
  const calls = [];

  const service = {
    async listOrders(
      input
    ) {
      calls.push({
        operation:
          "list",
        input
      });

      return {
        limit:
          input.limit || 20,
        items: [
          operationalOrder()
        ],
        nextCursor:
          null
      };
    },

    async getOrder(
      input
    ) {
      calls.push({
        operation:
          "get",
        input
      });

      return operationalOrder(
        input.orderId
      );
    }
  };

  return {
    calls,
    service
  };
}

async function main() {
  assert.strictEqual(
    ORDERS_READ_CAPABILITY,
    "ops.orders.read"
  );

  const {
    calls,
    service
  } =
    makeService();

  const listHandler =
    createListOrdersHandler({
      service
    });

  const detailHandler =
    createGetOrderHandler({
      service
    });

  await expectHttpsError(
    () =>
      listHandler({
        data: {
          forbidden:
            true
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  await expectHttpsError(
    () =>
      detailHandler({
        data: {
          forbidden:
            true
        }
      }),
    "unauthenticated"
  );

  assert.strictEqual(
    calls.length,
    0
  );

  for (
    const role
    of [
      "support_admin",
      "finance_admin",
      "platform_admin",
      "super_admin"
    ]
  ) {
    const result =
      await listHandler(
        requestFor(
          role,
          {
            limit:
              10,
            productType:
              "course",
            orderStatus:
              "paid"
          }
        )
      );

    assert.strictEqual(
      result.ok,
      true
    );
  }

  await expectHttpsError(
    () =>
      listHandler(
        requestFor(
          "content_admin",
          {}
        )
      ),
    "permission-denied"
  );

  await expectHttpsError(
    () =>
      listHandler({
        auth: {
          uid:
            "org-owner-1",

          token: {
            organization_role:
              "owner"
          }
        },

        data: {}
      }),
    "permission-denied"
  );

  for (
    const payload
    of [
      {
        role:
          "super_admin"
      },
      {
        actorRole:
          "super_admin"
      },
      {
        capability:
          "ops.orders.read"
      },
      {
        collection:
          "payment_transactions"
      },
      {
        providerPaymentId:
          "payment-secret"
      }
    ]
  ) {
    await expectHttpsError(
      () =>
        listHandler(
          requestFor(
            "support_admin",
            payload
          )
        ),
      "invalid-argument"
    );
  }

  const listResult =
    await listHandler(
      requestFor(
        "support_admin",
        {
          limit:
            5,

          cursor:
            "cursor-value",

          productType:
            "belt_exam",

          orderStatus:
            "refunded"
        }
      )
    );

  assert.strictEqual(
    listResult.ok,
    true
  );

  const lastListCall =
    calls
      .filter(
        call =>
          call.operation ===
            "list"
      )
      .at(-1);

  assert.deepStrictEqual(
    Object.keys(
      lastListCall.input
    ).sort(),
    [
      "cursor",
      "limit",
      "orderStatus",
      "productType"
    ]
  );

  const detailResult =
    await detailHandler(
      requestFor(
        "finance_admin",
        {
          orderId:
            "order-detail"
        }
      )
    );

  assert.strictEqual(
    detailResult.ok,
    true
  );

  assert.deepStrictEqual(
    detailResult.order,
    operationalOrder(
      "order-detail"
    )
  );

  for (
    const forbiddenField
    of [
      "providerPaymentId",
      "providerCustomerId",
      "walletId",
      "splitSnapshot",
      "financialSnapshot",
      "platformFeeBps",
      "idempotencyKey",
      "cpf"
    ]
  ) {
    assert.strictEqual(
      JSON.stringify(
        detailResult.order
      ).includes(
        forbiddenField
      ),
      false
    );
  }

  await expectHttpsError(
    () =>
      detailHandler(
        requestFor(
          "support_admin",
          {
            orderId:
              "order-1",

            providerPaymentId:
              "client-supplied"
          }
        )
      ),
    "invalid-argument"
  );

  const notFound =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapOrdersReadError(
                new AdminOrdersReadError(
                  "ADMIN_ORDER_NOT_FOUND",
                  "Order was not found."
                )
              )
          ),
      "not-found"
    );

  assert.strictEqual(
    notFound.details.domainCode,
    "ADMIN_ORDER_NOT_FOUND"
  );

  const invalid =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapOrdersReadError(
                new AdminOrdersReadError(
                  "ADMIN_ORDERS_FILTER_INVALID",
                  "Invalid filter."
                )
              )
          ),
      "invalid-argument"
    );

  assert.strictEqual(
    invalid.details.domainCode,
    "ADMIN_ORDERS_FILTER_INVALID"
  );

  const canonicalInvalid =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapOrdersReadError(
                new AdminOrdersReadError(
                  "ADMIN_ORDERS_CANONICAL_STATE_INVALID",
                  "Canonical state invalid."
                )
              )
          ),
      "failed-precondition"
    );

  assert.strictEqual(
    canonicalInvalid.details.domainCode,
    "ADMIN_ORDERS_CANONICAL_STATE_INVALID"
  );

  const modelInvalid =
    await expectHttpsError(
      () =>
        Promise.resolve()
          .then(
            () =>
              mapOrdersReadError(
                new AdminOrderModelError(
                  "ADMIN_ORDER_MODEL_INVALID",
                  "Order model invalid."
                )
              )
          ),
      "failed-precondition"
    );

  assert.strictEqual(
    modelInvalid.details.domainCode,
    "ADMIN_ORDER_MODEL_INVALID"
  );

  const ROOT =
    path.resolve(
      __dirname,
      ".."
    );

  const source =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/src/admin/admin-orders-read-functions.js"
      ),
      "utf8"
    );

  for (
    const forbidden
    of [
      "ASAAS_API_KEY",
      "ASAAS_WEBHOOK_TOKEN",
      "GEMINI_COURSE_MODERATION_API_KEY",
      "defineSecret",
      "createAsaasCheckoutProviderFactory",
      "providerFactory",
      "console.finance.read",
      "request.data.role",
      "request.data.actorRole",
      "request.data.capability"
    ]
  ) {
    assert.strictEqual(
      source.includes(
        forbidden
      ),
      false,
      `Operational order callables must not depend on ${forbidden}`
    );
  }

  assert.ok(
    source.includes(
      "listarPedidosOperacionaisV12"
    )
  );

  assert.ok(
    source.includes(
      "obterPedidoOperacionalV12"
    )
  );

  const mainSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "functions/main.js"
      ),
      "utf8"
    );

  for (
    const required
    of [
      "createAdminOrdersReadFunctions",
      "const adminOrdersReadFunctions =",
      "? createAdminOrdersReadFunctions({",
      "...adminOrdersReadFunctions,"
    ]
  ) {
    assert.ok(
      mainSource.includes(
        required
      ),
      `functions/main.js must contain ${required}`
    );
  }

  const compositionBlockMatch =
    mainSource.match(
      /const adminOrdersReadFunctions =[\s\S]*?: \{\};/
    );

  assert.ok(
    compositionBlockMatch,
    "Orders composition block must exist."
  );

  assert.ok(
    compositionBlockMatch[0].includes(
      "adminRuntimeAllowed"
    )
  );

  assert.strictEqual(
    compositionBlockMatch[0].includes(
      "webhookRuntimeAllowed"
    ),
    false
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_CAPABILITY=ops.orders.read"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLES=2/2"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_AUTH=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_AUTH_BEFORE_PAYLOAD=True"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_SUPPORT_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_FINANCE_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_PLATFORM_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_SUPER_ACCESS=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_CONTENT_ACCESS=BLOCKED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_ORG_ROLE_ESCALATION=BLOCKED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_CLIENT_CAPABILITY_INPUT=BLOCKED"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_LIST_FIELDS=4/4"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_DETAIL_FIELDS=1/1"
  );

  console.log(
    "MARCO8_ORDERS_CALLABLE_ERROR_MAPPING=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_MAIN_COMPOSITION=PASSED"
  );

  console.log(
    "MARCO8_ORDERS_PRODUCTION_EXPORT=BLOCKED"
  );

  console.log(
    "MARCO8_ORDERS_READ_CALLABLES=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);

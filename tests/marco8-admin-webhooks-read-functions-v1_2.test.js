"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  WEBHOOKS_READ_CAPABILITY,
  requireWebhooksReadActor,
  createListWebhooksHandler,
  createGetWebhookHandler
} = require("../functions/src/admin/admin-webhooks-read-functions");
const {
  AdminWebhooksReadError
} = require("../functions/src/admin/admin-webhooks-read-service");

function auth(role) {
  return { uid: `uid-${role}`, token: { [role]: true } };
}
function request(role, data = {}) {
  return { auth: auth(role), data };
}
async function expectHttpsError(factory, code) {
  try {
    await factory();
  } catch (error) {
    assert.strictEqual(error.code, code);
    return error;
  }
  assert.fail(`Expected HttpsError ${code}`);
}

async function main() {
  assert.strictEqual(WEBHOOKS_READ_CAPABILITY, "console.webhooks.read");

  for (const role of ["super_admin", "platform_admin", "finance_admin"]) {
    const actor = requireWebhooksReadActor({ auth: auth(role) });
    assert.strictEqual(actor.uid, `uid-${role}`);
  }

  for (const role of ["support_admin", "content_admin"]) {
    assert.throws(
      () => requireWebhooksReadActor({ auth: auth(role) }),
      error => error.code === "ADMIN_CAPABILITY_REQUIRED"
    );
  }

  const calls = [];
  const service = {
    async listWebhooks(input) {
      calls.push({ operation: "list", input });
      return { limit: input.limit || 20, items: [{ eventId: "event-1" }], nextCursor: null };
    },
    async getWebhook(input) {
      calls.push({ operation: "detail", input });
      return { eventId: input.eventId };
    }
  };

  const listHandler = createListWebhooksHandler({ service });
  const detailHandler = createGetWebhookHandler({ service });

  await expectHttpsError(
    () => listHandler({ data: { role: "super_admin" } }),
    "unauthenticated"
  );

  await expectHttpsError(
    () => listHandler(request("support_admin", { role: "super_admin" })),
    "permission-denied"
  );

  await expectHttpsError(
    () => listHandler(request("finance_admin", { role: "super_admin" })),
    "invalid-argument"
  );

  const listResult = await listHandler(request("finance_admin", {
    limit: 10,
    cursor: "cursor-1",
    status: "error",
    eventType: "PAYMENT_REFUNDED",
    orderId: "order-1"
  }));
  assert.strictEqual(listResult.ok, true);
  assert.deepStrictEqual(calls[0], {
    operation: "list",
    input: {
      limit: 10,
      cursor: "cursor-1",
      status: "error",
      eventType: "PAYMENT_REFUNDED",
      orderId: "order-1"
    }
  });

  const detailResult = await detailHandler(request("platform_admin", {
    eventId: "event-1"
  }));
  assert.deepStrictEqual(detailResult, {
    ok: true,
    webhook: { eventId: "event-1" }
  });
  assert.deepStrictEqual(calls[1], {
    operation: "detail",
    input: { eventId: "event-1" }
  });

  await expectHttpsError(
    () => detailHandler(request("super_admin", {
      eventId: "event-1",
      capability: "console.webhooks.reprocess"
    })),
    "invalid-argument"
  );

  const invalidService = {
    async listWebhooks() {
      throw new AdminWebhooksReadError("ADMIN_WEBHOOKS_CURSOR_INVALID", "cursor invalid");
    },
    async getWebhook() {
      throw new AdminWebhooksReadError("ADMIN_WEBHOOK_NOT_FOUND", "not found");
    }
  };

  await expectHttpsError(
    () => createListWebhooksHandler({ service: invalidService })(request("finance_admin")),
    "invalid-argument"
  );
  await expectHttpsError(
    () => createGetWebhookHandler({ service: invalidService })(request("finance_admin", { eventId: "missing" })),
    "not-found"
  );

  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "functions", "main.js"),
    "utf8"
  );
  assert.ok(mainSource.includes("createAdminWebhooksReadFunctions"));
  assert.ok(mainSource.includes("const adminWebhooksReadFunctions ="));
  assert.ok(mainSource.includes("adminRuntimeAllowed"));
  assert.ok(mainSource.includes("...adminWebhooksReadFunctions"));
  assert.strictEqual(
    mainSource.includes("createAdminWebhooksReadFunctions({\n        REGION,\n        db,\n        secrets:"),
    false
  );

  console.log("MARCO8_6B_WEBHOOK_CAPABILITY=console.webhooks.read");
  console.log("MARCO8_6B_WEBHOOK_READ_ROLES=3/3");
  console.log("MARCO8_6B_SUPPORT_ACCESS=BLOCKED");
  console.log("MARCO8_6B_CONTENT_ACCESS=BLOCKED");
  console.log("MARCO8_6B_AUTH_BEFORE_PAYLOAD=True");
  console.log("MARCO8_6B_CLIENT_AUTHORIZATION_ESCALATION=BLOCKED");
  console.log("MARCO8_6B_LIST_FIELDS=5/5");
  console.log("MARCO8_6B_DETAIL_FIELDS=1/1");
  console.log("MARCO8_6B_CALLABLES=2/2");
  console.log("MARCO8_6B_MAIN_COMPOSITION=PASSED");
  console.log("MARCO8_6B_PROVIDER_SECRET_BINDING=False");
  console.log("MARCO8_6B_ADMIN_WEBHOOKS_READ_FUNCTIONS=PASSED");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

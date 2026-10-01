"use strict";

const assert = require("assert");

const navigation =
  require(
    "../js/admin-shell-navigation-v1_2"
  );

const routeApi =
  require(
    "../js/admin-shell-route-api-v1_2"
  );

const registry =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

assert.strictEqual(
  registry.ROUTE_DEFINITIONS.length,
  14
);

assert.deepStrictEqual(
  registry.knownRoutes(),
  navigation.NAVIGATION_ITEMS
    .map(
      item =>
        item.route
    )
);

for (
  const item of
  navigation.NAVIGATION_ITEMS
) {
  const contract =
    registry
      .getRouteDefinition(
        item.route
      );

  assert.ok(
    contract,
    `Missing ${item.route}`
  );

  assert.strictEqual(
    contract.surface,
    item.section
  );

  assert.strictEqual(
    contract.readCapability,
    item.capability
  );

  assert.strictEqual(
    contract.integrated,
    false
  );

  assert.deepStrictEqual(
    contract.actions,
    []
  );
}

assert.deepStrictEqual(
  registry.integratedRoutes(),
  []
);

const webhooks =
  registry
    .getRouteDefinition(
      "webhooks"
    );

assert.strictEqual(
  webhooks.readFunction,
  "listarWebhooksOperacionaisV12"
);

assert.strictEqual(
  webhooks.detailFunction,
  "obterWebhookOperacionalV12"
);

assert.strictEqual(
  webhooks.supportsPagination,
  true
);

assert.deepStrictEqual(
  webhooks.filters,
  [
    "status",
    "eventType",
    "orderId"
  ]
);

const audit =
  registry
    .getRouteDefinition(
      "audit"
    );

assert.strictEqual(
  audit.readFunction,
  "listarAuditoriaOperacionalV12"
);

assert.deepStrictEqual(
  audit.filters,
  [
    "eventType",
    "actorUid",
    "targetType",
    "targetId",
    "organizationId"
  ]
);

for (
  const routeId of [
    "webhooks",
    "audit",
    "security",
    "configuration",
    "health"
  ]
) {
  const contract =
    registry
      .getRouteDefinition(
        routeId
      );

  assert.ok(
    routeApi
      .ROUTE_READ_FUNCTIONS
      .includes(
        contract.readFunction
      )
  );
}

assert.ok(
  routeApi
    .ROUTE_READ_FUNCTIONS
    .includes(
      webhooks.detailFunction
    )
);

assert.strictEqual(
  registry.getRouteDefinition(
    "unknown"
  ),
  null
);

console.log(
  "MARCO8_7B1_ROUTE_REGISTRY=14/14"
);

console.log(
  "MARCO8_7B1_ROUTE_CAPABILITIES=14/14"
);

console.log(
  "MARCO8_7B1_ROUTE_INTEGRATED=0/14"
);

console.log(
  "MARCO8_7B1_ROUTE_ACTIONS=0"
);

console.log(
  "MARCO8_7B1_WEBHOOK_FILTERS=3/3"
);

console.log(
  "MARCO8_7B1_AUDIT_FILTERS=5/5"
);

console.log(
  "MARCO8_7B1_REGISTRY_READ_FUNCTIONS_ALLOWLISTED=PASSED"
);

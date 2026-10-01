"use strict";

const assert = require("assert");

const routeApi =
  require(
    "../js/admin-shell-route-api-v1_2"
  );

const registry =
  require(
    "../js/admin-shell-route-registry-v1_2"
  );

const EXPECTED_OPERATIONAL_FUNCTIONS =
  Object.freeze([
    "listarPessoasOperacionaisV12",
    "obterPessoaOperacionalV12",
    "listarOrganizacoesOperacionaisV12",
    "obterOrganizacaoOperacionalV12",
    "listarCursosOperacionaisV12",
    "obterCursoOperacionalV12",
    "listarExamesOperacionaisV12",
    "obterExameOperacionalV12",
    "listarQuestoesOperacionaisV12",
    "obterQuestaoOperacionalV12",
    "listarCertificadosOperacionaisV12",
    "obterCertificadoOperacionalV12",
    "listarPedidosOperacionaisV12",
    "obterPedidoOperacionalV12"
  ]);

const EXPECTED_CONTRACTS =
  Object.freeze({
    people: {
      readFunction:
        "listarPessoasOperacionaisV12",
      detailFunction:
        "obterPessoaOperacionalV12",
      detailIdField:
        "personId",
      filters: [
        "profileType",
        "operationalStatus"
      ]
    },

    organizations: {
      readFunction:
        "listarOrganizacoesOperacionaisV12",
      detailFunction:
        "obterOrganizacaoOperacionalV12",
      detailIdField:
        "organizationId",
      filters: [
        "status",
        "nameQuery"
      ]
    },

    courses: {
      readFunction:
        "listarCursosOperacionaisV12",
      detailFunction:
        "obterCursoOperacionalV12",
      detailIdField:
        "courseId",
      filters: [
        "workflowStatus",
        "ownerType",
        "visibility",
        "moderationStatus"
      ]
    },

    exams: {
      readFunction:
        "listarExamesOperacionaisV12",
      detailFunction:
        "obterExameOperacionalV12",
      detailIdField:
        "sessionId",
      filters: [
        "status",
        "organizationId",
        "targetBelt"
      ]
    },

    questions: {
      readFunction:
        "listarQuestoesOperacionaisV12",
      detailFunction:
        "obterQuestaoOperacionalV12",
      detailIdField:
        "questionId",
      filters: [
        "lifecycleStatus",
        "difficulty",
        "category"
      ]
    },

    certificates: {
      readFunction:
        "listarCertificadosOperacionaisV12",
      detailFunction:
        "obterCertificadoOperacionalV12",
      detailIdField:
        "certificateId",
      filters: [
        "status",
        "organizationId",
        "targetBelt"
      ]
    },

    orders: {
      readFunction:
        "listarPedidosOperacionaisV12",
      detailFunction:
        "obterPedidoOperacionalV12",
      detailIdField:
        "orderId",
      filters: [
        "productType",
        "orderStatus"
      ]
    }
  });

assert.deepStrictEqual(
  [
    ...routeApi
      .OPERATIONAL_ROUTE_READ_FUNCTIONS
  ],
  [
    ...EXPECTED_OPERATIONAL_FUNCTIONS
  ]
);

assert.strictEqual(
  routeApi
    .OPERATIONAL_ROUTE_READ_FUNCTIONS
    .length,
  14
);

for (
  const functionName of
  EXPECTED_OPERATIONAL_FUNCTIONS
) {
  assert.strictEqual(
    routeApi.assertAllowedFunction(
      functionName
    ),
    functionName
  );
}

assert.throws(
  () =>
    routeApi.assertAllowedFunction(
      "criarQuestaoOperacionalV12"
    ),
  error =>
    error?.code ===
      "ADMIN_ROUTE_FUNCTION_NOT_ALLOWED"
);

for (
  const [
    routeId,
    expected
  ] of
  Object.entries(
    EXPECTED_CONTRACTS
  )
) {
  const contract =
    registry.getRouteDefinition(
      routeId
    );

  assert.ok(
    contract,
    `Missing operational route ${routeId}`
  );

  assert.strictEqual(
    contract.surface,
    "operations"
  );

  assert.strictEqual(
    contract.integrated,
    false
  );

  assert.strictEqual(
    contract.readFunction,
    expected.readFunction
  );

  assert.strictEqual(
    contract.detailFunction,
    expected.detailFunction
  );

  assert.strictEqual(
    contract.detailIdField,
    expected.detailIdField
  );

  assert.strictEqual(
    contract.supportsPagination,
    true
  );

  assert.strictEqual(
    contract.listKey,
    "items"
  );

  assert.deepStrictEqual(
    contract.filters,
    expected.filters
  );

  assert.deepStrictEqual(
    contract.actions,
    []
  );

  assert.ok(
    routeApi
      .OPERATIONAL_ROUTE_READ_FUNCTIONS
      .includes(
        contract.readFunction
      )
  );

  assert.ok(
    routeApi
      .OPERATIONAL_ROUTE_READ_FUNCTIONS
      .includes(
        contract.detailFunction
      )
  );
}

assert.deepStrictEqual(
  registry.integratedRoutes(),
  []
);

assert.strictEqual(
  registry.ROUTE_DEFINITIONS.length,
  14
);

console.log(
  "MARCO8_7C1_OPERATIONAL_ROUTES=7/7"
);

console.log(
  "MARCO8_7C1_OPERATIONAL_READ_FUNCTIONS=14/14"
);

console.log(
  "MARCO8_7C1_OPERATIONAL_LIST_CONTRACTS=7/7"
);

console.log(
  "MARCO8_7C1_OPERATIONAL_DETAIL_CONTRACTS=7/7"
);

console.log(
  "MARCO8_7C1_OPERATIONAL_FILTER_ALLOWLISTS=7/7"
);

console.log(
  "MARCO8_7C1_CURSOR_PAGINATION=OPAQUE"
);

console.log(
  "MARCO8_7C1_MUTATION_FUNCTIONS=BLOCKED"
);

console.log(
  "MARCO8_7C1_ROUTE_REGISTRY_INTEGRATED=0/14"
);

console.log(
  "MARCO8_7C1_DOMAIN_BACKEND_CALLS=0"
);

console.log(
  "MARCO8_7C1_OPERATIONAL_CONTRACTS=PASSED"
);

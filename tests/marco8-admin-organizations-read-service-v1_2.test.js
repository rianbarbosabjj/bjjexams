"use strict";

const assert =
  require("assert");

const {
  DEFAULT_ORGANIZATIONS_LIMIT,
  MAX_ORGANIZATIONS_LIMIT,
  ORGANIZATION_CURSOR_VERSION,
  ORGANIZATION_STATUS_FILTERS,
  AdminOrganizationsReadError,
  readOrganizationsLimit,
  normalizeOrganizationFilters,
  matchesOrganizationFilters,
  encodeOrganizationCursor,
  decodeOrganizationCursor,
  organizationMembershipCandidate,
  selectResponsibleMembership,
  buildResponsibleSummary,
  createAdminOrganizationsReadService
} = require(
  "../functions/src/admin/admin-organizations-read-service"
);

function document(
  id,
  value
) {
  return {
    id,

    data() {
      return {
        ...value
      };
    }
  };
}

function createFakeFirestore() {
  const organizations = [
    document(
      "org-a",
      {
        nome:
          "Academia Alfa",

        status:
          "ativa",

        criado_por_uid:
          "creator-old",

        criado_em: {
          seconds: 100
        }
      }
    ),

    document(
      "org-b",
      {
        nome_equipe:
          "Academia Beta",

        status:
          "ativa",

        criado_por_uid:
          "creator-b"
      }
    ),

    document(
      "org-c",
      {
        nome:
          "Academia Gamma",

        status:
          "suspensa"
      }
    )
  ];

  const memberships = [
    document(
      "org-a__manager-primary",
      {
        usuario_id:
          "manager-primary",

        organizacao_id:
          "org-a",

        papel:
          "gestor",

        status:
          "ativo",

        principal:
          true
      }
    ),

    document(
      "org-a__owner-secondary",
      {
        usuario_id:
          "owner-secondary",

        organizacao_id:
          "org-a",

        papel:
          "owner",

        status:
          "ativo",

        principal:
          false
      }
    ),

    document(
      "org-a__student",
      {
        usuario_id:
          "student-a",

        organizacao_id:
          "org-a",

        papel:
          "aluno",

        status:
          "ativo"
      }
    ),

    document(
      "org-b__instructor",
      {
        usuario_id:
          "instructor-b",

        organizacao_id:
          "org-b",

        papel:
          "professor",

        status:
          "ativo"
      }
    ),

    document(
      "org-c__manager-pending",
      {
        usuario_id:
          "manager-c",

        organizacao_id:
          "org-c",

        papel:
          "gestor",

        status:
          "pendente",

        principal:
          true
      }
    )
  ];

  const users = [
    document(
      "owner-secondary",
      {
        nome:
          "Owner Atual",

        email:
          "OWNER@EXAMPLE.COM",

        cpf:
          "must-not-pass"
      }
    ),

    document(
      "manager-primary",
      {
        nome:
          "Gestor Principal",

        email:
          "GESTOR@EXAMPLE.COM"
      }
    ),

    document(
      "creator-old",
      {
        nome:
          "Criador Antigo",

        email:
          "CREATOR@EXAMPLE.COM"
      }
    )
  ];

  const events = [];

  function organizationQuery() {
    let after = null;
    let maximum = null;

    const query = {
      orderBy(field) {
        events.push({
          type:
            "organizations-orderBy",

          field
        });

        return query;
      },

      startAfter(value) {
        after =
          value;

        events.push({
          type:
            "organizations-startAfter",

          value
        });

        return query;
      },

      limit(value) {
        maximum =
          value;

        events.push({
          type:
            "organizations-limit",

          value
        });

        return query;
      },

      async get() {
        let selected =
          [...organizations];

        if (after) {
          selected =
            selected.filter(
              item =>
                item.id >
                after
            );
        }

        if (
          Number.isInteger(
            maximum
          )
        ) {
          selected =
            selected.slice(
              0,
              maximum
            );
        }

        return {
          docs:
            selected
        };
      }
    };

    return query;
  }

  function membershipsQuery() {
    let operation = null;
    let value = null;

    const query = {
      where(
        field,
        receivedOperation,
        receivedValue
      ) {
        assert.strictEqual(
          field,
          "organizacao_id"
        );

        operation =
          receivedOperation;

        value =
          receivedValue;

        events.push({
          type:
            "memberships-where",

          operation,
          value
        });

        return query;
      },

      async get() {
        let selected =
          memberships;

        if (
          operation === "in"
        ) {
          const ids =
            new Set(
              value
            );

          selected =
            memberships.filter(
              item =>
                ids.has(
                  item
                    .data()
                    .organizacao_id
                )
            );
        }
        else if (
          operation === "=="
        ) {
          selected =
            memberships.filter(
              item =>
                item
                  .data()
                  .organizacao_id ===
                value
            );
        }
        else {
          throw new Error(
            `Unexpected membership operation: ${operation}`
          );
        }

        return {
          docs:
            selected
        };
      }
    };

    return query;
  }

  function usersQuery() {
    let operation = null;
    let value = null;

    const query = {
      where(
        field,
        receivedOperation,
        receivedValue
      ) {
        assert.strictEqual(
          field,
          "__name__"
        );

        operation =
          receivedOperation;

        value =
          receivedValue;

        events.push({
          type:
            "users-where",

          operation,
          value
        });

        return query;
      },

      async get() {
        assert.strictEqual(
          operation,
          "in"
        );

        const ids =
          new Set(
            value
          );

        return {
          docs:
            users.filter(
              item =>
                ids.has(
                  item.id
                )
            )
        };
      }
    };

    return query;
  }

  return {
    events,

    collection(name) {
      if (
        name ===
        "organizacoes"
      ) {
        return organizationQuery();
      }

      if (
        name ===
        "vinculos_organizacao"
      ) {
        return membershipsQuery();
      }

      if (
        name ===
        "usuarios"
      ) {
        return usersQuery();
      }

      throw new Error(
        `Unexpected collection ${name}`
      );
    },

    doc(path) {
      let match =
        /^organizacoes\/([^/]+)$/
          .exec(path);

      if (match) {
        const id =
          match[1];

        return {
          async get() {
            const found =
              organizations.find(
                item =>
                  item.id ===
                  id
              );

            return found
              ? {
                  exists: true,
                  id,
                  data:
                    found.data
                }
              : {
                  exists: false,

                  data() {
                    return undefined;
                  }
                };
          }
        };
      }

      match =
        /^usuarios\/([^/]+)$/
          .exec(path);

      if (match) {
        const id =
          match[1];

        return {
          async get() {
            const found =
              users.find(
                item =>
                  item.id ===
                  id
              );

            return found
              ? {
                  exists: true,
                  id,
                  data:
                    found.data
                }
              : {
                  exists: false,

                  data() {
                    return undefined;
                  }
                };
          }
        };
      }

      throw new Error(
        `Unexpected document ${path}`
      );
    }
  };
}

async function expectServiceError(
  operation,
  expectedCode
) {
  let received = null;

  try {
    await operation();
  }
  catch (error) {
    received =
      error;
  }

  assert.ok(
    received,
    `Expected ${expectedCode}`
  );

  assert.ok(
    received instanceof
      AdminOrganizationsReadError
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );
}

async function main() {
  assert.strictEqual(
    DEFAULT_ORGANIZATIONS_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_ORGANIZATIONS_LIMIT,
    25
  );

  assert.strictEqual(
    ORGANIZATION_CURSOR_VERSION,
    1
  );

  assert.deepStrictEqual(
    ORGANIZATION_STATUS_FILTERS,
    [
      "active",
      "pending",
      "suspended",
      "inactive",
      "unknown"
    ]
  );

  assert.strictEqual(
    readOrganizationsLimit(),
    20
  );

  assert.strictEqual(
    readOrganizationsLimit(25),
    25
  );

  assert.throws(
    () =>
      readOrganizationsLimit(26),
    error =>
      error instanceof
        AdminOrganizationsReadError &&
      error.code ===
        "ADMIN_ORGANIZATIONS_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeOrganizationFilters({
      status:
        " ACTIVE ",

      nameQuery:
        " ALFA "
    }),
    {
      status:
        "active",

      nameQuery:
        "alfa"
    }
  );

  assert.throws(
    () =>
      normalizeOrganizationFilters({
        status:
          "deleted"
      }),
    error =>
      error instanceof
        AdminOrganizationsReadError &&
      error.code ===
        "ADMIN_ORGANIZATIONS_FILTER_INVALID"
  );

  assert.strictEqual(
    matchesOrganizationFilters(
      {
        name:
          "Academia Alfa",

        status:
          "active"
      },
      {
        nameQuery:
          "alfa",

        status:
          "active"
      }
    ),
    true
  );

  const cursor =
    encodeOrganizationCursor(
      "org-b"
    );

  assert.strictEqual(
    decodeOrganizationCursor(
      cursor
    ),
    "org-b"
  );

  assert.throws(
    () =>
      decodeOrganizationCursor(
        "invalid"
      ),
    error =>
      error instanceof
        AdminOrganizationsReadError &&
      error.code ===
        "ADMIN_ORGANIZATIONS_CURSOR_INVALID"
  );

  const manager =
    organizationMembershipCandidate(
      {
        usuario_id:
          "manager-1",

        organizacao_id:
          "org-a",

        papel:
          "gestor",

        status:
          "ativo",

        principal:
          true
      },
      "org-a"
    );

  assert.deepStrictEqual(
    manager,
    {
      personId:
        "manager-1",

      role:
        "manager",

      isPrimary:
        true
    }
  );

  assert.strictEqual(
    organizationMembershipCandidate(
      {
        usuario_id:
          "manager-1",

        organizacao_id:
          "org-a",

        papel:
          "gestor",

        status:
          "pendente"
      },
      "org-a"
    ),
    null
  );

  const selectedResponsible =
    selectResponsibleMembership(
      [
        {
          usuario_id:
            "manager-primary",

          organizacao_id:
            "org-a",

          papel:
            "gestor",

          status:
            "ativo",

          principal:
            true
        },

        {
          usuario_id:
            "owner-secondary",

          organizacao_id:
            "org-a",

          papel:
            "owner",

          status:
            "ativo",

          principal:
            false
        }
      ],
      "org-a"
    );

  assert.deepStrictEqual(
    selectedResponsible,
    {
      personId:
        "owner-secondary",

      role:
        "owner",

      isPrimary:
        false
    }
  );

  const responsibleSummary =
    buildResponsibleSummary(
      selectedResponsible,
      {
        nome:
          "Owner Atual",

        email:
          "OWNER@EXAMPLE.COM",

        cpf:
          "must-not-pass"
      }
    );

  assert.deepStrictEqual(
    responsibleSummary,
    {
      personId:
        "owner-secondary",

      displayName:
        "Owner Atual",

      email:
        "OWNER@EXAMPLE.COM",

      role:
        "owner"
    }
  );

  assert.strictEqual(
    JSON.stringify(
      responsibleSummary
    ).includes(
      "cpf"
    ),
    false
  );

  const fake =
    createFakeFirestore();

  const service =
    createAdminOrganizationsReadService({
      db:
        fake,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listOrganizations({
      limit: 2
    });

  assert.strictEqual(
    firstPage.limit,
    2
  );

  assert.deepStrictEqual(
    firstPage.items.map(
      item =>
        item.organizationId
    ),
    [
      "org-a",
      "org-b"
    ]
  );

  assert.strictEqual(
    firstPage.items[0].name,
    "Academia Alfa"
  );

  assert.strictEqual(
    firstPage.items[0].status,
    "active"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .membershipCounts
      .total,
    3
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .responsibleSummary
      .personId,
    "owner-secondary"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .responsibleSummary
      .displayName,
    "Owner Atual"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .responsibleSummary
      .email,
    "owner@example.com"
  );

  assert.strictEqual(
    firstPage
      .items[1]
      .responsibleSummary,
    null
  );

  assert.strictEqual(
    decodeOrganizationCursor(
      firstPage.nextCursor
    ),
    "org-b"
  );

  const secondPage =
    await service.listOrganizations({
      limit: 2,
      cursor:
        firstPage.nextCursor
    });

  assert.strictEqual(
    secondPage.items.length,
    1
  );

  assert.strictEqual(
    secondPage.items[0].organizationId,
    "org-c"
  );

  assert.strictEqual(
    secondPage.items[0].status,
    "suspended"
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const nameFilter =
    await service.listOrganizations({
      limit: 3,
      nameQuery:
        "beta"
    });

  assert.deepStrictEqual(
    nameFilter.items.map(
      item =>
        item.organizationId
    ),
    [
      "org-b"
    ]
  );

  const sparsePage =
    await service.listOrganizations({
      limit: 2,
      status:
        "suspended"
    });

  assert.strictEqual(
    sparsePage.items.length,
    0
  );

  assert.strictEqual(
    decodeOrganizationCursor(
      sparsePage.nextCursor
    ),
    "org-b"
  );

  const sparseNext =
    await service.listOrganizations({
      limit: 2,
      cursor:
        sparsePage.nextCursor,
      status:
        "suspended"
    });

  assert.deepStrictEqual(
    sparseNext.items.map(
      item =>
        item.organizationId
    ),
    [
      "org-c"
    ]
  );

  const detail =
    await service.getOrganization({
      organizationId:
        "org-a"
    });

  assert.strictEqual(
    detail
      .organization
      .organizationId,
    "org-a"
  );

  assert.strictEqual(
    detail
      .organization
      .responsibleSummary
      .role,
    "owner"
  );

  assert.strictEqual(
    detail
      .organization
      .responsibleSummary
      .personId,
    "owner-secondary"
  );

  const serialized =
    JSON.stringify({
      firstPage,
      detail
    });

  for (
    const forbidden of [
      "criado_por_uid",
      "cpf",
      "asaas_wallet_id",
      "webhook_token",
      "senha",
      "password"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Organization read leaked ${forbidden}`
    );
  }

  await expectServiceError(
    () =>
      service.getOrganization({
        organizationId:
          "missing"
      }),
    "ADMIN_ORGANIZATION_NOT_FOUND"
  );

  await expectServiceError(
    () =>
      service.getOrganization({
        organizationId:
          "bad/id"
      }),
    "ADMIN_ORGANIZATION_IDENTIFIER_INVALID"
  );

  await expectServiceError(
    () =>
      service.listOrganizations({
        limit: 100
      }),
    "ADMIN_ORGANIZATIONS_LIMIT_INVALID"
  );

  await expectServiceError(
    () =>
      service.listOrganizations({
        status:
          "deleted"
      }),
    "ADMIN_ORGANIZATIONS_FILTER_INVALID"
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "organizations-orderBy" &&
        event.field ===
          "__name__"
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "organizations-limit" &&
        event.value === 3
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "memberships-where" &&
        event.operation ===
          "in"
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "users-where" &&
        event.operation ===
          "in"
    )
  );

  assert.throws(
    () =>
      createAdminOrganizationsReadService({
        db: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_ORGANIZATIONS_DEFAULT_LIMIT=20"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_MAX_LIMIT=25"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_CURSOR_VERSION=1"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_FILTER_ALLOWLIST=2/2"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_RESPONSIBLE_SOURCE=active_owner_or_manager_membership"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_CREATOR_FALLBACK=False"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_RESPONSIBLE_PRIORITY=owner_then_manager"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_LIST_PAGINATION=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_FILTER_SCAN_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_DETAIL=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ORGANIZATIONS_READ_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

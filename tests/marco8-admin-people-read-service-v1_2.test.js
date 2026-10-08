"use strict";

const assert =
  require("assert");

const {
  DEFAULT_PEOPLE_LIMIT,
  MAX_PEOPLE_LIMIT,
  PERSON_CURSOR_VERSION,
  PEOPLE_PROFILE_FILTERS,
  PEOPLE_STATUS_FILTERS,
  AdminPeopleReadError,
  readPeopleLimit,
  normalizePeopleFilters,
  matchesPeopleFilters,
  encodePersonCursor,
  decodePersonCursor,
  createAdminPeopleReadService
} = require(
  "../functions/src/admin/admin-people-read-service"
);

function createDocument(
  id,
  data
) {
  return {
    id,

    data() {
      return {
        ...data
      };
    }
  };
}

function createFakeFirestore() {
  const users =
    [
      createDocument(
        "person-a",
        {
          nome:
            "Ana",

          email:
            "ANA@EXAMPLE.COM",

          tipo_usuario:
            "aluno",

          status_conta:
            "ativo",

          cpf:
            "must-not-pass"
        }
      ),

      createDocument(
        "person-b",
        {
          nome:
            "Bruno",

          email:
            "BRUNO@EXAMPLE.COM",

          tipo_usuario:
            "professor",

          status_conta:
            "ativo",

          telefone:
            "must-not-pass"
        }
      ),

      createDocument(
        "person-c",
        {
          nome:
            "Carla",

          email:
            "CARLA@EXAMPLE.COM",

          tipo_usuario:
            "aluno",

          status_conta:
            "suspenso",

          asaas_wallet_id:
            "must-not-pass"
        }
      )
    ];

  const memberships =
    [
      createDocument(
        "org-a__person-a",
        {
          usuario_id:
            "person-a",

          organizacao_id:
            "org-a",

          papel:
            "aluno",

          status:
            "ativo",

          principal:
            true
        }
      ),

      createDocument(
        "org-b__person-a",
        {
          usuario_id:
            "person-a",

          organizacao_id:
            "org-b",

          papel:
            "aluno",

          status:
            "pendente"
        }
      ),

      createDocument(
        "org-a__person-b",
        {
          usuario_id:
            "person-b",

          organizacao_id:
            "org-a",

          papel:
            "professor",

          status:
            "ativo",

          pode_aplicar_exames:
            true
        }
      )
    ];

  const events = [];

  function usersQuery() {
    let after = null;
    let maximum = null;

    const query = {
      orderBy(field) {
        events.push({
          type:
            "users-orderBy",

          field
        });

        return query;
      },

      startAfter(value) {
        after =
          value;

        events.push({
          type:
            "users-startAfter",

          value
        });

        return query;
      },

      limit(value) {
        maximum =
          value;

        events.push({
          type:
            "users-limit",

          value
        });

        return query;
      },

      async get() {
        let selected =
          [...users];

        if (after) {
          selected =
            selected.filter(
              document =>
                document.id >
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

  function membershipQuery() {
    let field = null;
    let operation = null;
    let value = null;

    const query = {
      where(
        receivedField,
        receivedOperation,
        receivedValue
      ) {
        field =
          receivedField;

        operation =
          receivedOperation;

        value =
          receivedValue;

        events.push({
          type:
            "membership-where",

          field,
          operation,
          value
        });

        return query;
      },

      async get() {
        assert.strictEqual(
          field,
          "usuario_id"
        );

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
              document =>
                ids.has(
                  document
                    .data()
                    .usuario_id
                )
            );
        }
        else if (
          operation === "=="
        ) {
          selected =
            memberships.filter(
              document =>
                document
                  .data()
                  .usuario_id ===
                value
            );
        }
        else {
          throw new Error(
            `Unexpected membership operation ${operation}`
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

  return {
    events,

    collection(name) {
      if (
        name === "usuarios"
      ) {
        return usersQuery();
      }

      if (
        name ===
        "vinculos_organizacao"
      ) {
        return membershipQuery();
      }

      throw new Error(
        `Unexpected collection ${name}`
      );
    },

    doc(path) {
      const match =
        /^usuarios\/([^/]+)$/
          .exec(path);

      if (!match) {
        throw new Error(
          `Unexpected document ${path}`
        );
      }

      const personId =
        match[1];

      return {
        async get() {
          const document =
            users.find(
              candidate =>
                candidate.id ===
                personId
            );

          if (!document) {
            return {
              exists: false,

              data() {
                return undefined;
              }
            };
          }

          return {
            exists: true,

            id:
              document.id,

            data:
              document.data
          };
        }
      };
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
      AdminPeopleReadError
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );
}

async function main() {
  assert.strictEqual(
    DEFAULT_PEOPLE_LIMIT,
    20
  );

  assert.strictEqual(
    MAX_PEOPLE_LIMIT,
    25
  );

  assert.strictEqual(
    PERSON_CURSOR_VERSION,
    1
  );

  assert.deepStrictEqual(
    PEOPLE_PROFILE_FILTERS,
    [
      "student",
      "instructor"
    ]
  );

  assert.deepStrictEqual(
    PEOPLE_STATUS_FILTERS,
    [
      "active",
      "pending",
      "suspended",
      "inactive",
      "unknown"
    ]
  );

  assert.deepStrictEqual(
    normalizePeopleFilters({
      profileType:
        " STUDENT ",

      operationalStatus:
        " ACTIVE "
    }),
    {
      profileType:
        "student",

      operationalStatus:
        "active"
    }
  );

  assert.deepStrictEqual(
    normalizePeopleFilters({}),
    {
      profileType:
        null,

      operationalStatus:
        null
    }
  );

  assert.strictEqual(
    matchesPeopleFilters(
      {
        profileType:
          "student",

        operationalStatus:
          "active"
      },
      {
        profileType:
          "student",

        operationalStatus:
          "active"
      }
    ),
    true
  );

  assert.strictEqual(
    matchesPeopleFilters(
      {
        profileType:
          "instructor",

        operationalStatus:
          "active"
      },
      {
        profileType:
          "student",

        operationalStatus:
          null
      }
    ),
    false
  );

  assert.throws(
    () =>
      normalizePeopleFilters({
        profileType:
          "owner"
      }),
    error =>
      error instanceof
        AdminPeopleReadError &&
      error.code ===
        "ADMIN_PEOPLE_FILTER_INVALID"
  );

  assert.throws(
    () =>
      normalizePeopleFilters({
        operationalStatus:
          "deleted"
      }),
    error =>
      error instanceof
        AdminPeopleReadError &&
      error.code ===
        "ADMIN_PEOPLE_FILTER_INVALID"
  );

  assert.strictEqual(
    readPeopleLimit(),
    20
  );

  assert.strictEqual(
    readPeopleLimit(1),
    1
  );

  assert.strictEqual(
    readPeopleLimit(25),
    25
  );

  assert.throws(
    () =>
      readPeopleLimit(0),
    error =>
      error instanceof
        AdminPeopleReadError &&
      error.code ===
        "ADMIN_PEOPLE_LIMIT_INVALID"
  );

  assert.throws(
    () =>
      readPeopleLimit(26),
    error =>
      error instanceof
        AdminPeopleReadError &&
      error.code ===
        "ADMIN_PEOPLE_LIMIT_INVALID"
  );

  const cursor =
    encodePersonCursor(
      "person-b"
    );

  assert.strictEqual(
    typeof cursor,
    "string"
  );

  assert.ok(
    cursor.length > 0
  );

  assert.strictEqual(
    decodePersonCursor(
      cursor
    ),
    "person-b"
  );

  assert.strictEqual(
    decodePersonCursor(null),
    null
  );

  assert.throws(
    () =>
      decodePersonCursor(
        "invalid!!!"
      ),
    error =>
      error instanceof
        AdminPeopleReadError &&
      error.code ===
        "ADMIN_PEOPLE_CURSOR_INVALID"
  );

  const fake =
    createFakeFirestore();

  const service =
    createAdminPeopleReadService({
      db:
        fake,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listPeople({
      limit: 2
    });

  assert.strictEqual(
    firstPage.limit,
    2
  );

  assert.strictEqual(
    firstPage.items.length,
    2
  );

  assert.deepStrictEqual(
    firstPage.items.map(
      person =>
        person.personId
    ),
    [
      "person-a",
      "person-b"
    ]
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .displayName,
    "Ana"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .email,
    "ana@example.com"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .profileType,
    "student"
  );

  assert.strictEqual(
    firstPage
      .items[0]
      .memberships
      .length,
    2
  );

  assert.strictEqual(
    firstPage
      .items[1]
      .profileType,
    "instructor"
  );

  assert.strictEqual(
    firstPage
      .items[1]
      .memberships[0]
      .canApplyOfficialExam,
    true
  );

  assert.strictEqual(
    typeof firstPage.nextCursor,
    "string"
  );

  assert.strictEqual(
    decodePersonCursor(
      firstPage.nextCursor
    ),
    "person-b"
  );

  const secondPage =
    await service.listPeople({
      limit: 2,
      cursor:
        firstPage.nextCursor
    });

  assert.strictEqual(
    secondPage.items.length,
    1
  );

  assert.strictEqual(
    secondPage
      .items[0]
      .personId,
    "person-c"
  );

  assert.strictEqual(
    secondPage
      .items[0]
      .operationalStatus,
    "suspended"
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const filteredStudents =
    await service.listPeople({
      limit: 3,

      profileType:
        "student",

      operationalStatus:
        "active"
    });

  assert.deepStrictEqual(
    filteredStudents.items.map(
      personItem =>
        personItem.personId
    ),
    [
      "person-a"
    ]
  );

  assert.strictEqual(
    filteredStudents.nextCursor,
    null
  );

  const sparseFilteredPage =
    await service.listPeople({
      limit: 2,

      operationalStatus:
        "suspended"
    });

  assert.strictEqual(
    sparseFilteredPage.items.length,
    0
  );

  assert.strictEqual(
    decodePersonCursor(
      sparseFilteredPage.nextCursor
    ),
    "person-b"
  );

  const sparseFilteredNextPage =
    await service.listPeople({
      limit: 2,

      cursor:
        sparseFilteredPage.nextCursor,

      operationalStatus:
        "suspended"
    });

  assert.deepStrictEqual(
    sparseFilteredNextPage.items.map(
      personItem =>
        personItem.personId
    ),
    [
      "person-c"
    ]
  );

  assert.strictEqual(
    sparseFilteredNextPage.nextCursor,
    null
  );

  await expectServiceError(
    () =>
      service.listPeople({
        profileType:
          "owner"
      }),
    "ADMIN_PEOPLE_FILTER_INVALID"
  );

  await expectServiceError(
    () =>
      service.listPeople({
        operationalStatus:
          "deleted"
      }),
    "ADMIN_PEOPLE_FILTER_INVALID"
  );

  const person =
    await service.getPerson({
      personId:
        "person-b"
    });

  assert.strictEqual(
    person.person.personId,
    "person-b"
  );

  assert.strictEqual(
    person
      .person
      .displayName,
    "Bruno"
  );

  assert.strictEqual(
    person
      .person
      .memberships
      .length,
    1
  );

  assert.strictEqual(
    person
      .person
      .memberships[0]
      .role,
    "instructor"
  );

  for (
    const payload of [
      firstPage,
      secondPage,
      person
    ]
  ) {
    const serialized =
      JSON.stringify(
        payload
      );

    for (
      const forbidden of [
        "cpf",
        "telefone",
        "asaas_wallet_id",
        "senha",
        "password",
        "secret"
      ]
    ) {
      assert.strictEqual(
        serialized.includes(
          forbidden
        ),
        false,
        `Read service leaked ${forbidden}`
      );
    }
  }

  await expectServiceError(
    () =>
      service.getPerson({
        personId:
          "missing"
      }),
    "ADMIN_PERSON_NOT_FOUND"
  );

  await expectServiceError(
    () =>
      service.getPerson({
        personId:
          "bad/id"
      }),
    "ADMIN_PEOPLE_IDENTIFIER_INVALID"
  );

  await expectServiceError(
    () =>
      service.listPeople({
        limit: 100
      }),
    "ADMIN_PEOPLE_LIMIT_INVALID"
  );

  await expectServiceError(
    () =>
      service.listPeople({
        cursor:
          "not-a-valid-cursor"
      }),
    "ADMIN_PEOPLE_CURSOR_INVALID"
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "users-orderBy" &&
        event.field ===
          "__name__"
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "users-limit" &&
        event.value === 3
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "users-startAfter" &&
        event.value ===
          "person-b"
    )
  );

  assert.ok(
    fake.events.some(
      event =>
        event.type ===
          "membership-where" &&
        event.operation ===
          "in" &&
        Array.isArray(
          event.value
        ) &&
        event.value.length === 2
    )
  );

  assert.throws(
    () =>
      createAdminPeopleReadService({
        db: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_PEOPLE_DEFAULT_LIMIT=20"
  );

  console.log(
    "MARCO8_PEOPLE_MAX_LIMIT=25"
  );

  console.log(
    "MARCO8_PEOPLE_CURSOR_VERSION=1"
  );

  console.log(
    "MARCO8_PEOPLE_CURSOR_VALIDATION=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_LIST_PAGINATION=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_FILTER_ALLOWLIST=2/2"
  );

  console.log(
    "MARCO8_PEOPLE_FILTER_SCAN_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_DETAIL=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_MEMBERSHIP_BATCH=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_PEOPLE_CANONICAL_COLLECTION=usuarios"
  );

  console.log(
    "MARCO8_PEOPLE_READ_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

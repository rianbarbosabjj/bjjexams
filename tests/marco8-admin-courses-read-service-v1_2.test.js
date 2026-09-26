"use strict";

const assert =
  require("assert");

const {
  buildCourseEnrollmentSummaryFromCounts
} = require(
  "../functions/src/admin/admin-course-models"
);

const {
  DEFAULT_COURSES_LIMIT,
  MAX_COURSES_LIMIT,
  COURSE_CURSOR_VERSION,
  COURSE_MODERATION_FILTERS,
  AdminCoursesReadError,
  readCoursesLimit,
  normalizeCourseFilters,
  matchesCourseFilters,
  encodeCourseCursor,
  decodeCourseCursor,
  ownerDescriptor,
  ownerDisplayName,
  readAggregateCount,
  createAdminCoursesReadService
} = require(
  "../functions/src/admin/admin-courses-read-service"
);

function clone(
  value
) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

function createFakeFirestore(
  initial = {}
) {
  const courses =
    new Map(
      Object.entries(
        initial.courses ||
        {}
      )
    );

  const users =
    new Map(
      Object.entries(
        initial.users ||
        {}
      )
    );

  const organizations =
    new Map(
      Object.entries(
        initial.organizations ||
        {}
      )
    );

  const enrollments =
    Array.isArray(
      initial.enrollments
    )
      ? initial.enrollments
          .map(clone)
      : [];

  const events = [];

  function snapshotForPath(
    path
  ) {
    const [
      collection,
      id
    ] =
      path.split("/");

    let source = null;

    if (
      collection ===
      "courses"
    ) {
      source =
        courses;
    }
    else if (
      collection ===
      "usuarios"
    ) {
      source =
        users;
    }
    else if (
      collection ===
      "organizacoes"
    ) {
      source =
        organizations;
    }

    const exists =
      Boolean(
        source &&
        source.has(id)
      );

    return {
      id,
      ref: {
        path
      },
      exists,

      data() {
        return exists
          ? clone(
              source.get(id)
            )
          : undefined;
      }
    };
  }

  function courseDocument(
    id
  ) {
    return {
      id,
      exists:
        true,

      data() {
        return clone(
          courses.get(id)
        );
      }
    };
  }

  function makeCourseQuery(
    state = {}
  ) {
    return {
      orderBy(field) {
        events.push({
          type:
            "courses-orderBy",
          field
        });

        return makeCourseQuery({
          ...state,
          ordered:
            true
        });
      },

      startAfter(id) {
        events.push({
          type:
            "courses-startAfter",
          id
        });

        return makeCourseQuery({
          ...state,
          afterId:
            id
        });
      },

      limit(value) {
        events.push({
          type:
            "courses-limit",
          value
        });

        return makeCourseQuery({
          ...state,
          limit:
            value
        });
      },

      async get() {
        let ids =
          Array.from(
            courses.keys()
          )
            .sort(
              (
                left,
                right
              ) =>
                left.localeCompare(
                  right
                )
            );

        if (state.afterId) {
          ids =
            ids.filter(
              id =>
                id.localeCompare(
                  state.afterId
                ) > 0
            );
        }

        if (
          Number.isInteger(
            state.limit
          )
        ) {
          ids =
            ids.slice(
              0,
              state.limit
            );
        }

        events.push({
          type:
            "courses-get",

          ids: [
            ...ids
          ]
        });

        return {
          docs:
            ids.map(
              courseDocument
            )
        };
      }
    };
  }

  function matchesEnrollmentFilters(
    enrollment,
    filters
  ) {
    return filters.every(
      filter =>
        filter.op ===
          "==" &&
        enrollment[
          filter.field
        ] ===
          filter.value
    );
  }

  function makeEnrollmentQuery(
    filters = []
  ) {
    return {
      where(
        field,
        op,
        value
      ) {
        return makeEnrollmentQuery([
          ...filters,
          {
            field,
            op,
            value
          }
        ]);
      },

      count() {
        return {
          async get() {
            const count =
              enrollments
                .filter(
                  enrollment =>
                    matchesEnrollmentFilters(
                      enrollment,
                      filters
                    )
                )
                .length;

            events.push({
              type:
                "aggregate-count",

              filters:
                clone(
                  filters
                ),

              count
            });

            return {
              data() {
                return {
                  count
                };
              }
            };
          }
        };
      }
    };
  }

  const db = {
    events,

    collection(name) {
      if (
        name ===
        "courses"
      ) {
        return makeCourseQuery();
      }

      if (
        name ===
        "enrollments"
      ) {
        return makeEnrollmentQuery();
      }

      throw new Error(
        `Unexpected collection: ${name}`
      );
    },

    doc(path) {
      return {
        path,
        id:
          path
            .split("/")
            .pop(),

        async get() {
          events.push({
            type:
              "doc-get",
            path
          });

          return snapshotForPath(
            path
          );
        }
      };
    },

    async getAll(
      ...refs
    ) {
      events.push({
        type:
          "getAll",

        paths:
          refs.map(
            ref =>
              ref.path
          )
      });

      return refs.map(
        ref =>
          snapshotForPath(
            ref.path
          )
      );
    }
  };

  return db;
}

async function expectError(
  operation,
  ErrorType,
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
      ErrorType
  );

  assert.strictEqual(
    received.code,
    expectedCode
  );

  return received;
}

async function main() {
  assert.strictEqual(
    DEFAULT_COURSES_LIMIT,
    10
  );

  assert.strictEqual(
    MAX_COURSES_LIMIT,
    10
  );

  assert.strictEqual(
    COURSE_CURSOR_VERSION,
    1
  );

  assert.deepStrictEqual(
    COURSE_MODERATION_FILTERS,
    [
      "processing",
      "approved",
      "needs_changes",
      "manual_review",
      "blocked"
    ]
  );

  assert.strictEqual(
    readCoursesLimit(),
    10
  );

  assert.strictEqual(
    readCoursesLimit(3),
    3
  );

  assert.throws(
    () =>
      readCoursesLimit(11),
    error =>
      error instanceof
        AdminCoursesReadError &&
      error.code ===
        "ADMIN_COURSES_LIMIT_INVALID"
  );

  assert.deepStrictEqual(
    normalizeCourseFilters({
      workflowStatus:
        " PUBLISHED ",

      ownerType:
        "USER",

      visibility:
        "private",

      moderationStatus:
        "PROCESSING"
    }),
    {
      workflowStatus:
        "published",

      ownerType:
        "user",

      visibility:
        "private",

      moderationStatus:
        "processing"
    }
  );

  assert.throws(
    () =>
      normalizeCourseFilters({
        workflowStatus:
          "deleted"
      }),
    error =>
      error instanceof
        AdminCoursesReadError &&
      error.code ===
        "ADMIN_COURSES_FILTER_INVALID"
  );

  assert.strictEqual(
    matchesCourseFilters(
      {
        ownerType:
          "user",

        visibility:
          "private",

        status:
          "review",

        moderationPending: {
          state:
            "processing"
        }
      },
      {
        ownerType:
          "user",

        visibility:
          "private",

        workflowStatus:
          "review",

        moderationStatus:
          "processing"
      }
    ),
    true
  );

  const cursor =
    encodeCourseCursor(
      "course-b"
    );

  assert.strictEqual(
    decodeCourseCursor(
      cursor
    ),
    "course-b"
  );

  assert.throws(
    () =>
      decodeCourseCursor(
        Buffer
          .from(
            JSON.stringify({
              v: 99,
              lastCourseId:
                "course-b"
            }),
            "utf8"
          )
          .toString(
            "base64url"
          )
      ),
    error =>
      error instanceof
        AdminCoursesReadError &&
      error.code ===
        "ADMIN_COURSES_CURSOR_INVALID"
  );

  assert.deepStrictEqual(
    ownerDescriptor({
      ownerType:
        "user",

      ownerId:
        "user-1"
    }),
    {
      ownerType:
        "user",

      ownerId:
        "user-1",

      key:
        "user:user-1",

      path:
        "usuarios/user-1"
    }
  );

  assert.deepStrictEqual(
    ownerDescriptor({
      ownerType:
        "organization",

      ownerId:
        "org-1"
    }),
    {
      ownerType:
        "organization",

      ownerId:
        "org-1",

      key:
        "organization:org-1",

      path:
        "organizacoes/org-1"
    }
  );

  assert.strictEqual(
    ownerDescriptor({
      ownerType:
        "platform"
    }),
    null
  );

  assert.strictEqual(
    ownerDisplayName(
      "user",
      {
        displayName:
          "Instrutor Um",

        email:
          "private@example.com"
      }
    ),
    "Instrutor Um"
  );

  assert.strictEqual(
    ownerDisplayName(
      "organization",
      {
        name:
          "Academia Um",

        asaas_wallet_id:
          "secret"
      }
    ),
    "Academia Um"
  );

  assert.strictEqual(
    readAggregateCount(
      {
        data() {
          return {
            count: 7
          };
        }
      },
      "total"
    ),
    7
  );

  assert.throws(
    () =>
      readAggregateCount(
        {
          data() {
            return {
              count: -1
            };
          }
        },
        "total"
      ),
    error =>
      error instanceof
        AdminCoursesReadError &&
      error.code ===
        "ADMIN_COURSES_AGGREGATE_INVALID"
  );

  assert.deepStrictEqual(
    buildCourseEnrollmentSummaryFromCounts({
      total:
        10000,

      active:
        7000,

      completed:
        2000,

      cancelled:
        500,

      refunded:
        300,

      chargeback:
        100
    }),
    {
      total:
        10000,

      active:
        7000,

      completed:
        2000,

      cancelled:
        500,

      refunded:
        300,

      chargeback:
        100
    }
  );

  const db =
    createFakeFirestore({
      courses: {
        "course-a": {
          title:
            "Curso Plataforma",

          ownerType:
            "platform",

          ownerId:
            null,

          visibility:
            "platform",

          status:
            "published",

          moderation: {
            status:
              "approved",

            summary:
              "private moderation detail"
          },

          priceCents:
            9900
        },

        "course-b": {
          title:
            "Curso Instrutor",

          ownerType:
            "user",

          ownerId:
            "user-1",

          visibility:
            "private",

          status:
            "review",

          moderation: {
            status:
              "approved"
          },

          moderationPending: {
            state:
              "processing",

            submissionId:
              "private-submission"
          }
        },

        "course-c": {
          title:
            "Curso Academia",

          ownerType:
            "organization",

          ownerId:
            "org-1",

          organizationId:
            "org-1",

          visibility:
            "organization",

          status:
            "suspended",

          moderation: {
            status:
              "needs_changes"
          }
        },

        "course-d": {
          title:
            "Curso Sem Perfil",

          ownerType:
            "user",

          ownerId:
            "user-missing",

          visibility:
            "platform",

          status:
            "draft"
        }
      },

      users: {
        "user-1": {
          displayName:
            "Instrutor Um",

          email:
            "private@example.com",

          cpf:
            "00000000000"
        }
      },

      organizations: {
        "org-1": {
          name:
            "Academia Um",

          asaas_wallet_id:
            "wallet-secret"
        }
      },

      enrollments: [
        {
          courseId:
            "course-a",

          status:
            "active"
        },
        {
          courseId:
            "course-a",

          status:
            "completed"
        },
        {
          courseId:
            "course-b",

          status:
            "active"
        },
        {
          courseId:
            "course-b",

          status:
            "refunded"
        },
        {
          courseId:
            "course-b",

          status:
            "chargeback"
        },
        {
          courseId:
            "course-b",

          status:
            "legacy-invalid"
        },
        {
          courseId:
            "course-c",

          status:
            "cancelled"
        }
      ]
    });

  const service =
    createAdminCoursesReadService({
      db,

      documentIdField:
        "__name__"
    });

  const firstPage =
    await service.listCourses({
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

  assert.strictEqual(
    firstPage.items[0]
      .courseId,
    "course-a"
  );

  assert.strictEqual(
    firstPage.items[1]
      .courseId,
    "course-b"
  );

  assert.strictEqual(
    firstPage.items[0]
      .ownerSummary,
    null
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .ownerSummary,
    {
      ownerId:
        "user-1",

      displayName:
        "Instrutor Um"
    }
  );

  assert.strictEqual(
    firstPage.items[1]
      .moderationStatus,
    "processing"
  );

  assert.deepStrictEqual(
    firstPage.items[0]
      .enrollmentSummary,
    {
      total:
        2,

      active:
        1,

      completed:
        1,

      cancelled:
        0,

      refunded:
        0,

      chargeback:
        0
    }
  );

  assert.deepStrictEqual(
    firstPage.items[1]
      .enrollmentSummary,
    {
      total:
        4,

      active:
        1,

      completed:
        0,

      cancelled:
        0,

      refunded:
        1,

      chargeback:
        1
    }
  );

  assert.ok(
    firstPage.nextCursor
  );

  const firstPageCountEvents =
    db.events.filter(
      event =>
        event.type ===
        "aggregate-count"
    );

  assert.strictEqual(
    firstPageCountEvents.length,
    12
  );

  const firstPageOwnerBatch =
    db.events.find(
      event =>
        event.type ===
        "getAll"
    );

  assert.deepStrictEqual(
    firstPageOwnerBatch.paths,
    [
      "usuarios/user-1"
    ]
  );

  const secondPage =
    await service.listCourses({
      limit: 2,

      cursor:
        firstPage.nextCursor
    });

  assert.strictEqual(
    secondPage.items.length,
    2
  );

  assert.strictEqual(
    secondPage.items[0]
      .courseId,
    "course-c"
  );

  assert.deepStrictEqual(
    secondPage.items[0]
      .ownerSummary,
    {
      ownerId:
        "org-1",

      displayName:
        "Academia Um"
    }
  );

  assert.strictEqual(
    secondPage.items[1]
      .courseId,
    "course-d"
  );

  assert.deepStrictEqual(
    secondPage.items[1]
      .ownerSummary,
    {
      ownerId:
        "user-missing",

      displayName:
        null
    }
  );

  assert.strictEqual(
    secondPage.nextCursor,
    null
  );

  const publishedPage =
    await service.listCourses({
      limit: 2,

      workflowStatus:
        "published"
    });

  assert.strictEqual(
    publishedPage.items.length,
    1
  );

  assert.strictEqual(
    publishedPage.items[0]
      .courseId,
    "course-a"
  );

  assert.ok(
    publishedPage.nextCursor
  );

  const processingPage =
    await service.listCourses({
      limit: 2,

      moderationStatus:
        "processing"
    });

  assert.strictEqual(
    processingPage.items.length,
    1
  );

  assert.strictEqual(
    processingPage.items[0]
      .courseId,
    "course-b"
  );

  const detail =
    await service.getCourse({
      courseId:
        "course-c"
    });

  assert.strictEqual(
    detail.course.courseId,
    "course-c"
  );

  assert.strictEqual(
    detail.course.ownerType,
    "organization"
  );

  assert.deepStrictEqual(
    detail.course.ownerSummary,
    {
      ownerId:
        "org-1",

      displayName:
        "Academia Um"
    }
  );

  assert.deepStrictEqual(
    detail.course.enrollmentSummary,
    {
      total:
        1,

      active:
        0,

      completed:
        0,

      cancelled:
        1,

      refunded:
        0,

      chargeback:
        0
    }
  );

  await expectError(
    () =>
      service.getCourse({
        courseId:
          "missing-course"
      }),
    AdminCoursesReadError,
    "ADMIN_COURSE_NOT_FOUND"
  );

  await expectError(
    () =>
      service.getCourse({
        courseId:
          "bad/id"
      }),
    AdminCoursesReadError,
    "ADMIN_COURSES_IDENTIFIER_INVALID"
  );

  await expectError(
    () =>
      service.listCourses({
        limit: 11
      }),
    AdminCoursesReadError,
    "ADMIN_COURSES_LIMIT_INVALID"
  );

  await expectError(
    () =>
      service.listCourses({
        moderationStatus:
          "provider-private-state"
      }),
    AdminCoursesReadError,
    "ADMIN_COURSES_FILTER_INVALID"
  );

  const serialized =
    JSON.stringify({
      firstPage,
      secondPage,
      detail
    });

  for (
    const forbidden
    of [
      "private@example.com",
      "00000000000",
      "wallet-secret",
      "private moderation detail",
      "private-submission",
      "priceCents"
    ]
  ) {
    assert.strictEqual(
      serialized.includes(
        forbidden
      ),
      false,
      `Course read service leaked ${forbidden}`
    );
  }

  const writeEvents =
    db.events.filter(
      event =>
        [
          "set",
          "create",
          "update",
          "delete",
          "transaction"
        ].includes(
          event.type
        )
    );

  assert.strictEqual(
    writeEvents.length,
    0
  );

  assert.throws(
    () =>
      createAdminCoursesReadService({
        db: {}
      }),
    TypeError
  );

  console.log(
    "MARCO8_COURSES_DEFAULT_LIMIT=10"
  );

  console.log(
    "MARCO8_COURSES_MAX_LIMIT=10"
  );

  console.log(
    "MARCO8_COURSES_CURSOR_VERSION=1"
  );

  console.log(
    "MARCO8_COURSES_COLLECTION=courses"
  );

  console.log(
    "MARCO8_COURSES_OWNER_USER_COLLECTION=usuarios"
  );

  console.log(
    "MARCO8_COURSES_OWNER_ORGANIZATION_COLLECTION=organizacoes"
  );

  console.log(
    "MARCO8_COURSES_ENROLLMENT_COLLECTION=enrollments"
  );

  console.log(
    "MARCO8_COURSES_ENROLLMENT_AGGREGATION=count"
  );

  console.log(
    "MARCO8_COURSES_AGGREGATE_QUERIES_PER_ITEM=6"
  );

  console.log(
    "MARCO8_COURSES_FILTERS=4/4"
  );

  console.log(
    "MARCO8_COURSES_RAW_SCAN_CURSOR=PASSED"
  );

  console.log(
    "MARCO8_COURSES_OWNER_BATCH=PASSED"
  );

  console.log(
    "MARCO8_COURSES_LIST=PASSED"
  );

  console.log(
    "MARCO8_COURSES_DETAIL=PASSED"
  );

  console.log(
    "MARCO8_COURSES_SANITIZATION=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_COURSES_READ_SERVICE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

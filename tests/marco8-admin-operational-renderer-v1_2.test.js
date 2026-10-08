"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rendererApi =
  require(
    "../js/admin-shell-operational-renderer-v1_2"
  );

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function source(
  relativePath
) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

function element(
  tagName
) {
  return {
    tagName:
      String(
        tagName || ""
      ).toUpperCase(),

    textContent: "",
    type: "",
    className: "",
    disabled: false,
    attributes: {},
    children: [],
    listeners: {},

    setAttribute(
      name,
      value
    ) {
      this.attributes[name] =
        String(value);
    },

    addEventListener(
      name,
      handler
    ) {
      this.listeners[name] =
        handler;
    },

    appendChild(
      child
    ) {
      this.children.push(
        child
      );

      return child;
    },

    replaceChildren(
      ...children
    ) {
      this.children =
        children;
    }
  };
}

function documentStub() {
  return {
    createElement(
      tagName
    ) {
      return element(
        tagName
      );
    }
  };
}

function walk(
  node,
  predicate,
  output = []
) {
  if (
    node &&
    predicate(node)
  ) {
    output.push(
      node
    );
  }

  for (
    const child of
    node?.children || []
  ) {
    walk(
      child,
      predicate,
      output
    );
  }

  return output;
}

async function main() {
  assert.deepStrictEqual(
    rendererApi
      .OPERATIONAL_ROUTE_IDS,
    [
      "people",
      "organizations",
      "courses",
      "exams",
      "questions",
      "certificates",
      "orders"
    ]
  );

  assert.strictEqual(
    rendererApi
      .OPERATIONAL_ROUTE_IDS
      .length,
    7
  );

  const expectedIds = {
    people:
      "personId",
    organizations:
      "organizationId",
    courses:
      "courseId",
    exams:
      "sessionId",
    questions:
      "questionId",
    certificates:
      "certificateId",
    orders:
      "orderId"
  };

  const expectedDetailKeys = {
    people:
      "person",
    organizations:
      "organization",
    courses:
      "course",
    exams:
      "exam",
    questions:
      null,
    certificates:
      null,
    orders:
      null
  };

  for (
    const routeId of
    rendererApi
      .OPERATIONAL_ROUTE_IDS
  ) {
    const presentation =
      rendererApi
        .getPresentation(
          routeId
        );

    assert.ok(
      presentation
    );

    assert.strictEqual(
      presentation.routeId,
      routeId
    );

    assert.strictEqual(
      presentation.entityIdField,
      expectedIds[
        routeId
      ]
    );

    assert.strictEqual(
      presentation.detailResultKey,
      expectedDetailKeys[
        routeId
      ]
    );

    assert.ok(
      presentation.listFields
        .length >= 4
    );

    assert.ok(
      presentation.detailFields
        .length >= 8
    );
  }

  assert.strictEqual(
    rendererApi
      .getPresentation(
        "finance"
      ),
    null
  );

  const malicious =
    '<img src=x onerror="alert(1)">';

  const peopleList =
    rendererApi
      .buildListViewModel(
        "people",
        {
          items: [
            {
              personId:
                "person-1",
              displayName:
                malicious,
              email:
                "user@example.com",
              profileType:
                "student",
              operationalStatus:
                "active",
              memberships: [
                {
                  organizationId:
                    "org-1"
                }
              ]
            }
          ],
          nextCursor:
            "opaque.secret.cursor"
        }
      );

  assert.strictEqual(
    peopleList
      .rows[0]
      .entityId,
    "person-1"
  );

  assert.strictEqual(
    peopleList
      .rows[0]
      .cells[0]
      .value,
    malicious
  );

  assert.strictEqual(
    peopleList.hasNextPage,
    true
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        peopleList,
        "nextCursor"
      ),
    false
  );

  const wrappedPerson =
    rendererApi
      .buildDetailViewModel(
        "people",
        {
          person: {
            personId:
              "person-1",
            displayName:
              "Pessoa",
            email:
              "user@example.com",
            profileType:
              "student",
            operationalStatus:
              "active",
            memberships: [],
            createdAt:
              "2026-10-01T12:00:00.000Z",
            updatedAt:
              "2026-10-01T13:00:00.000Z"
          }
        }
      );

  assert.strictEqual(
    wrappedPerson.entityId,
    "person-1"
  );

  const rawCertificate =
    rendererApi
      .buildDetailViewModel(
        "certificates",
        {
          certificateId:
            "cert-1",
          status:
            "valid",
          studentName:
            "Aluno",
          organizationName:
            "Academia",
          targetBelt:
            "blue",
          scoreBps:
            8500,
          correctCount:
            17,
          totalQuestions:
            20,
          issuedAt:
            "2026-10-01T12:00:00.000Z",
          revokedAt:
            null
        }
      );

  assert.strictEqual(
    rawCertificate.entityId,
    "cert-1"
  );

  const rawOrder =
    rendererApi
      .buildDetailViewModel(
        "orders",
        {
          orderId:
            "order-1",
          productType:
            "course",
          productSummary: {
            productId:
              "course-1",
            label:
              "Curso"
          },
          buyerSummary: {
            userId:
              "user-1",
            displayName:
              "Comprador",
            email:
              "buyer@example.com"
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
          reversalStatus:
            null,
          reconciliationStatus: {
            required:
              false
          },
          createdAt:
            "2026-10-01T12:00:00.000Z"
        }
      );

  assert.strictEqual(
    rawOrder.entityId,
    "order-1"
  );

  const calls = [];

  const routeRuntime = {
    loadDetail(
      routeId,
      entityId
    ) {
      calls.push({
        type: "detail",
        routeId,
        entityId
      });

      return Promise.resolve();
    },

    loadNextPage(
      routeId
    ) {
      calls.push({
        type: "next",
        routeId
      });

      return Promise.resolve();
    },

    restoreList(
      routeId
    ) {
      calls.push({
        type: "back",
        routeId
      });

      return true;
    }
  };

  const document =
    documentStub();

  const renderer =
    rendererApi
      .createOperationalRenderer({
        document,
        routeRuntime
      });

  const listContainer =
    element(
      "section"
    );

  assert.strictEqual(
    renderer.render(
      listContainer,
      {
        state:
          "route-ready",
        routeId:
          "people",
        mode:
          "list",
        data: {
          items: [
            {
              personId:
                "person-1",
              displayName:
                malicious,
              email:
                "user@example.com",
              profileType:
                "student",
              operationalStatus:
                "active",
              memberships: []
            }
          ],
          nextCursor:
            "opaque.secret.cursor"
        }
      }
    ),
    true
  );

  const buttons =
    walk(
      listContainer,
      node =>
        node.tagName ===
          "BUTTON"
    );

  assert.strictEqual(
    buttons.length,
    2
  );

  assert.strictEqual(
    buttons[0].type,
    "button"
  );

  assert.ok(
    buttons[0]
      .attributes[
        "aria-label"
      ]
  );

  const cells =
    walk(
      listContainer,
      node =>
        node.tagName ===
          "TD"
    );

  assert.strictEqual(
    cells[0].textContent,
    malicious
  );

  assert.strictEqual(
    source(
      "js/admin-shell-operational-renderer-v1_2.js"
    ).includes(
      ".innerHTML"
    ),
    false
  );

  assert.strictEqual(
    source(
      "js/admin-shell-operational-renderer-v1_2.js"
    ).includes(
      "JSON.stringify"
    ),
    false
  );

  buttons[0]
    .listeners
    .click();

  buttons[1]
    .listeners
    .click();

  assert.deepStrictEqual(
    calls.slice(
      0,
      2
    ),
    [
      {
        type:
          "detail",
        routeId:
          "people",
        entityId:
          "person-1"
      },
      {
        type:
          "next",
        routeId:
          "people"
      }
    ]
  );

  const detailContainer =
    element(
      "section"
    );

  assert.strictEqual(
    renderer.render(
      detailContainer,
      {
        state:
          "route-ready",
        routeId:
          "people",
        mode:
          "detail",
        data: {
          person: {
            personId:
              "person-1",
            displayName:
              "Pessoa",
            email:
              "user@example.com",
            profileType:
              "student",
            operationalStatus:
              "active",
            memberships: [],
            createdAt:
              "2026-10-01T12:00:00.000Z",
            updatedAt:
              "2026-10-01T13:00:00.000Z"
          }
        }
      }
    ),
    true
  );

  const backButtons =
    walk(
      detailContainer,
      node =>
        node.tagName ===
          "BUTTON"
    );

  assert.strictEqual(
    backButtons.length,
    1
  );

  backButtons[0]
    .listeners
    .click();

  assert.strictEqual(
    calls.at(-1).type,
    "back"
  );

  const tableRegions =
    walk(
      listContainer,
      node =>
        node
          .className ===
        "operational-table-region"
    );

  assert.strictEqual(
    tableRegions.length,
    1
  );

  assert.strictEqual(
    tableRegions[0]
      .attributes
      .tabindex,
    "0"
  );

  assert.ok(
    tableRegions[0]
      .attributes[
        "aria-label"
      ]
  );

  console.log(
    "MARCO8_7C3A_PRESENTATIONS=7/7"
  );

  console.log(
    "MARCO8_7C3A_ENTITY_IDS=7/7"
  );

  console.log(
    "MARCO8_7C3A_DETAIL_RESULT_SHAPES=7/7"
  );

  console.log(
    "MARCO8_7C3A_LIST_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7C3A_DETAIL_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7C3A_OPAQUE_CURSOR_NOT_EXPOSED=PASSED"
  );

  console.log(
    "MARCO8_7C3A_DETAIL_ACTION=PASSED"
  );

  console.log(
    "MARCO8_7C3A_NEXT_PAGE_ACTION=PASSED"
  );

  console.log(
    "MARCO8_7C3A_RESTORE_LIST_ACTION=PASSED"
  );

  console.log(
    "MARCO8_7C3A_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7C3A_BASIC_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7C3A_OPERATIONAL_RENDERER=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

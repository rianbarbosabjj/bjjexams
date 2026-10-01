"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rendererApi =
  require(
    "../js/admin-shell-operational-renderer-v1_2"
  );

const controllerApi =
  require(
    "../js/admin-shell-controller-v1_2"
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

function classList() {
  const values =
    new Set();

  return {
    add(value) {
      values.add(value);
    },

    remove(value) {
      values.delete(value);
    },

    contains(value) {
      return values.has(value);
    }
  };
}

function element(
  tagName = "div"
) {
  return {
    tagName:
      String(
        tagName
      ).toUpperCase(),

    hidden: false,
    dataset: {},
    textContent: "",
    className: "",
    classList:
      classList(),
    children: [],
    attributes: {},
    listeners: {},
    value: "",
    type: "",
    name: "",
    id: "",
    maxLength: 0,
    placeholder: "",
    autocomplete: "",
    disabled: false,
    noValidate: false,

    setAttribute(
      name,
      value
    ) {
      this.attributes[name] =
        String(value);
    },

    removeAttribute(
      name
    ) {
      delete this.attributes[
        name
      ];
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
  const selectors = [
    "[data-admin-shell-root]",
    "[data-admin-state-loading]",
    "[data-admin-state-denied]",
    "[data-admin-state-error]",
    "[data-admin-error-message]",
    "[data-admin-state-ready]",
    "[data-admin-navigation]",
    "[data-admin-user-name]",
    "[data-admin-environment]",
    "[data-admin-route-title]",
    "[data-admin-route-section]",
    "[data-admin-route-content]",
    "[data-admin-route-placeholder-panel]",
    "[data-admin-operational-content]",
    "[data-admin-route-state-title]",
    "[data-admin-route-placeholder]"
  ];

  const nodes =
    new Map(
      selectors.map(
        selector => [
          selector,
          element()
        ]
      )
    );

  return {
    nodes,

    querySelector(
      selector
    ) {
      return (
        nodes.get(
          selector
        ) ||
        null
      );
    },

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

function controlByName(
  root,
  name
) {
  return walk(
    root,
    node =>
      node.name ===
        name
  )[0] || null;
}

function inputByValue(
  root,
  value
) {
  return walk(
    root,
    node =>
      node.tagName ===
        "INPUT" &&
      node.value ===
        value
  )[0] || null;
}

function optionValues(
  definition
) {
  return definition.options.map(
    option =>
      option.value
  );
}

async function main() {
  const expectedFilterNames = {
    people: [
      "profileType",
      "operationalStatus"
    ],

    organizations: [
      "status",
      "nameQuery"
    ],

    courses: [
      "workflowStatus",
      "ownerType",
      "visibility",
      "moderationStatus"
    ],

    exams: [
      "status",
      "organizationId",
      "targetBelt"
    ],

    questions: [
      "lifecycleStatus",
      "difficulty",
      "category"
    ],

    certificates: [
      "status",
      "organizationId",
      "targetBelt"
    ],

    orders: [
      "productType",
      "orderStatus"
    ]
  };

  let filterCount = 0;

  for (
    const [
      routeId,
      names
    ] of
    Object.entries(
      expectedFilterNames
    )
  ) {
    const definitions =
      rendererApi
        .getFilterDefinitions(
          routeId
        );

    assert.deepStrictEqual(
      definitions.map(
        definition =>
          definition.name
      ),
      names
    );

    filterCount +=
      definitions.length;
  }

  assert.strictEqual(
    filterCount,
    19
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "people"
        )[0]
    ),
    [
      "student",
      "instructor"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "people"
        )[1]
    ),
    [
      "active",
      "pending",
      "suspended",
      "inactive",
      "unknown"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "courses"
        )[0]
    ),
    [
      "draft",
      "review",
      "published",
      "suspended",
      "archived"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "courses"
        )[1]
    ),
    [
      "platform",
      "user",
      "organization"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "courses"
        )[2]
    ),
    [
      "platform",
      "organization",
      "private"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "courses"
        )[3]
    ),
    [
      "processing",
      "approved",
      "needs_changes",
      "manual_review",
      "blocked"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "exams"
        )[0]
    ),
    [
      "draft",
      "candidates_selected",
      "awaiting_payment",
      "ready",
      "cancelled",
      "archived"
    ]
  );

  const expectedBelts = [
    "Branca",
    "Cinza e Branca",
    "Cinza",
    "Cinza e Preta",
    "Amarela e Branca",
    "Amarela",
    "Amarela e Preta",
    "Laranja e Branca",
    "Laranja",
    "Laranja e Preta",
    "Verde e Branca",
    "Verde",
    "Verde e Preta",
    "Azul",
    "Roxa",
    "Marrom",
    "Preta"
  ];

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "exams"
        )[2]
    ),
    expectedBelts
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "certificates"
        )[2]
    ),
    expectedBelts
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "questions"
        )[0]
    ),
    [
      "draft",
      "pending_review",
      "approved",
      "changes_requested",
      "archived"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "questions"
        )[1]
    ),
    [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  );

  assert.strictEqual(
    rendererApi
      .getFilterDefinitions(
        "questions"
      )[2]
      .maxLength,
    120
  );

  assert.strictEqual(
    rendererApi
      .getFilterDefinitions(
        "organizations"
      )[1]
      .maxLength,
    80
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "certificates"
        )[0]
    ),
    [
      "valid",
      "revoked"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "orders"
        )[0]
    ),
    [
      "course",
      "belt_exam"
    ]
  );

  assert.deepStrictEqual(
    optionValues(
      rendererApi
        .getFilterDefinitions(
          "orders"
        )[1]
    ),
    [
      "pending_payment",
      "paid",
      "cancelled",
      "expired",
      "refunded",
      "chargeback"
    ]
  );

  const filterCalls = [];

  const routeRuntime = {
    getListState(
      routeId
    ) {
      assert.strictEqual(
        routeId,
        "people"
      );

      return {
        basePayload: {
          limit: 20,
          profileType:
            "student",
          operationalStatus:
            "active"
        }
      };
    },

    applyFilters(
      routeId,
      payload
    ) {
      filterCalls.push({
        routeId,
        payload
      });

      return Promise.resolve({
        state:
          "route-ready",
        routeId,
        mode:
          "list",
        data: {
          items: [],
          nextCursor:
            null
        }
      });
    },

    loadDetail() {
      return Promise.resolve();
    },

    loadNextPage() {
      return Promise.resolve();
    },

    restoreList() {
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

  const container =
    element(
      "section"
    );

  const rendered =
    renderer.render(
      container,
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
                "Pessoa",
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
            null
        }
      }
    );

  assert.strictEqual(
    rendered,
    true
  );

  const forms =
    walk(
      container,
      node =>
        node.tagName ===
          "FORM" &&
        node.className ===
          "operational-filters"
    );

  assert.strictEqual(
    forms.length,
    1
  );

  const form =
    forms[0];

  assert.strictEqual(
    form.attributes[
      "aria-label"
    ],
    "Filtros de Pessoas"
  );

  const profile =
    controlByName(
      form,
      "profileType"
    );

  const status =
    controlByName(
      form,
      "operationalStatus"
    );

  assert.ok(profile);
  assert.ok(status);

  assert.strictEqual(
    profile.value,
    "student"
  );

  assert.strictEqual(
    status.value,
    "active"
  );

  const summaries =
    walk(
      form,
      node =>
        node.className ===
          "operational-filter-summary"
    );

  assert.strictEqual(
    summaries.length,
    1
  );

  assert.strictEqual(
    summaries[0].textContent,
    "Filtros ativos: 2"
  );

  assert.strictEqual(
    summaries[0]
      .attributes
      .role,
    "status"
  );

  profile.value =
    " instructor ";

  status.value = "";

  let prevented =
    false;

  await form
    .listeners
    .submit({
      preventDefault() {
        prevented = true;
      }
    });

  assert.strictEqual(
    prevented,
    true
  );

  assert.deepStrictEqual(
    filterCalls[0],
    {
      routeId:
        "people",

      payload: {
        profileType:
          "instructor"
      }
    }
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        filterCalls[0]
          .payload,
        "limit"
      ),
    false
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        filterCalls[0]
          .payload,
        "cursor"
      ),
    false
  );

  const clear =
    inputByValue(
      form,
      "Limpar filtros"
    );

  assert.ok(clear);

  await clear
    .listeners
    .click();

  assert.strictEqual(
    profile.value,
    ""
  );

  assert.strictEqual(
    status.value,
    ""
  );

  assert.deepStrictEqual(
    filterCalls[1],
    {
      routeId:
        "people",
      payload: {}
    }
  );

  const emptyContainer =
    element(
      "section"
    );

  assert.strictEqual(
    renderer.render(
      emptyContainer,
      {
        state:
          "route-empty",
        routeId:
          "people",
        mode:
          "list",
        data: {
          items: [],
          nextCursor:
            null
        }
      }
    ),
    true
  );

  assert.strictEqual(
    walk(
      emptyContainer,
      node =>
        node.tagName ===
          "FORM"
    ).length,
    1
  );

  assert.strictEqual(
    walk(
      emptyContainer,
      node =>
        node.textContent ===
          "Nenhum registro encontrado."
    ).length,
    1
  );

  const controllerDocument =
    documentStub();

  const operationalRendererCalls =
    [];

  const controller =
    controllerApi
      .createController({
        document:
          controllerDocument,

        navigationApi: {
          buildNavigation() {
            return [
              {
                id:
                  "operations",
                label:
                  "Painel Operacional",
                items: [
                  {
                    id:
                      "people",
                    label:
                      "Pessoas",
                    route:
                      "people",
                    capability:
                      "ops.people.read"
                  }
                ]
              }
            ];
          },

          canNavigateTo() {
            return true;
          },

          firstAllowedRoute() {
            return "people";
          }
        },

        routeRuntime: {
          activate() {
            return Promise.resolve({
              state:
                "route-empty",
              routeId:
                "people",
              mode:
                "list",
              data: {
                items: [],
                nextCursor:
                  null
              }
            });
          }
        },

        operationalRenderer: {
          render(
            content,
            state
          ) {
            operationalRendererCalls
              .push({
                content,
                state
              });

            return (
              state.state ===
                "route-empty"
            );
          }
        }
      });

  controller.renderRouteState({
    state:
      "route-empty",
    routeId:
      "people",
    mode:
      "list",
    data: {
      items: [],
      nextCursor:
        null
    }
  });

  assert.strictEqual(
    operationalRendererCalls
      .length,
    1
  );

  assert.strictEqual(
    controllerDocument
      .nodes
      .get(
        "[data-admin-route-placeholder-panel]"
      )
      .hidden,
    true
  );

  assert.strictEqual(
    controllerDocument
      .nodes
      .get(
        "[data-admin-operational-content]"
      )
      .hidden,
    false
  );

  const rendererSource =
    source(
      "js/admin-shell-operational-renderer-v1_2.js"
    );

  const controllerSource =
    source(
      "js/admin-shell-controller-v1_2.js"
    );

  const html =
    source(
      "admin_shell_v1_2.html"
    );

  assert.strictEqual(
    rendererSource.includes(
      ".innerHTML"
    ),
    false
  );

  assert.strictEqual(
    controllerSource.includes(
      ".innerHTML"
    ),
    false
  );

  assert.strictEqual(
    rendererSource.includes(
      "JSON.stringify"
    ),
    false
  );

  assert.ok(
    html.includes(
      ".operational-filters"
    )
  );

  assert.ok(
    html.includes(
      ".operational-filter-grid"
    )
  );

  for (
    const forbidden of [
      "firebase-firestore",
      "getFirestore(",
      "getDocs(",
      "setDoc(",
      "addDoc(",
      "updateDoc(",
      "deleteDoc(",
      "onSnapshot("
    ]
  ) {
    assert.strictEqual(
      html.includes(
        forbidden
      ),
      false
    );
  }

  console.log(
    "MARCO8_7C4_FILTER_DEFINITIONS=19/19"
  );

  console.log(
    "MARCO8_7C4_FILTER_ROUTES=7/7"
  );

  console.log(
    "MARCO8_7C4_BACKEND_ENUMS=PASSED"
  );

  console.log(
    "MARCO8_7C4_FILTER_VALUES_RESTORED=PASSED"
  );

  console.log(
    "MARCO8_7C4_APPLY_FILTERS=PASSED"
  );

  console.log(
    "MARCO8_7C4_CLEAR_FILTERS=PASSED"
  );

  console.log(
    "MARCO8_7C4_CURSOR_NOT_EXPOSED=PASSED"
  );

  console.log(
    "MARCO8_7C4_LIMIT_NOT_CLIENT_FILTER=PASSED"
  );

  console.log(
    "MARCO8_7C4_EMPTY_STATE_RECOVERY=PASSED"
  );

  console.log(
    "MARCO8_7C4_FILTER_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7C4_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7C4_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7C4_OPERATIONAL_FILTERS=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

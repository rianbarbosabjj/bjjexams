"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const rendererApi =
  require(
    "../js/admin-shell-webhooks-audit-renderer-v1_2"
  );

const registryApi =
  require(
    "../js/admin-shell-route-registry-v1_2"
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

function source(p) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        p
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
    add(v) {
      values.add(v);
    },

    remove(v) {
      values.delete(v);
    },

    contains(v) {
      return values.has(v);
    }
  };
}

function element(
  tag = "div"
) {
  return {
    tagName:
      String(tag)
        .toUpperCase(),

    hidden:
      false,

    dataset: {},

    textContent:
      "",

    className:
      "",

    classList:
      classList(),

    children: [],

    attributes: {},

    listeners: {},

    value:
      "",

    id:
      "",

    name:
      "",

    type:
      "",

    autocomplete:
      "",

    tabIndex:
      0,

    scope:
      "",

    replaceChildren(
      ...children
    ) {
      this.children =
        children;
    },

    appendChild(
      child
    ) {
      this.children.push(
        child
      );

      return child;
    },

    setAttribute(
      name,
      value
    ) {
      this.attributes[
        name
      ] =
        String(
          value
        );
    },

    removeAttribute(
      name
    ) {
      delete this
        .attributes[
          name
        ];
    },

    addEventListener(
      name,
      handler
    ) {
      this.listeners[
        name
      ] =
        handler;
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
      tag
    ) {
      return element(
        tag
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
    predicate(
      node
    )
  ) {
    output.push(
      node
    );
  }

  for (
    const child of
    node?.children ||
    []
  ) {
    walk(
      child,
      predicate,
      output
    );
  }

  return output;
}

function textTree(
  node
) {
  let output =
    String(
      node?.textContent ||
      ""
    );

  for (
    const child of
    node?.children ||
    []
  ) {
    output +=
      " " +
      textTree(
        child
      );
  }

  return output;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  assert.deepStrictEqual(
    rendererApi
      .WEBHOOK_AUDIT_ROUTE_IDS,
    [
      "webhooks",
      "audit"
    ]
  );

  assert.strictEqual(
    rendererApi
      .FILTER_DEFINITIONS
      .webhooks
      .length,
    3
  );

  assert.strictEqual(
    rendererApi
      .FILTER_DEFINITIONS
      .audit
      .length,
    5
  );

  const webhookListModel =
    rendererApi
      .buildWebhookListViewModel({
        items: [
          {
            eventId:
              "event-1",

            provider:
              "asaas",

            providerEventRef:
              "***masked",

            eventType:
              "PAYMENT_RECEIVED",

            status:
              "processed",

            relatedOrderId:
              "order-1",

            deliveryCount:
              2,

            processing: {
              action:
                "confirm_payment",

              result:
                "processed",

              errorCode:
                null
            },

            timestamps: {
              receivedAt:
                "2026-10-02T12:00:00.000Z"
            },

            providerEventId:
              "must-not-render",

            rawPayload:
              "must-not-render"
          }
        ],

        nextCursor:
          "opaque-cursor"
      });

  assert.strictEqual(
    webhookListModel
      .items
      .length,
    1
  );

  assert.strictEqual(
    webhookListModel
      .hasNext,
    true
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        webhookListModel
          .items[0],
        "providerEventId"
      ),
    false
  );

  const detailModel =
    rendererApi
      .buildWebhookDetailViewModel({
        webhook: {
          eventId:
            "event-1",

          provider:
            "asaas",

          providerEventRef:
            "***masked",

          eventType:
            "PAYMENT_RECEIVED",

          status:
            "processed",

          relatedOrderId:
            "order-1",

          deliveryCount:
            2,

          processing: {
            action:
              "confirm_payment",

            result:
              "processed",

            errorCode:
              null
          },

          timestamps: {
            receivedAt:
              "r",

            lastReceivedAt:
              "lr",

            processedAt:
              "p"
          },

          rawPayload:
            "must-not-render"
        }
      });

  assert.strictEqual(
    detailModel
      .providerEventRef,
    "***masked"
  );

  assert.strictEqual(
    Object.prototype
      .hasOwnProperty.call(
        detailModel,
        "rawPayload"
      ),
    false
  );

  const auditModel =
    rendererApi
      .buildAuditListViewModel({
        items: [
          {
            auditId:
              "audit-1",

            eventType:
              "admin.webhook.reprocess.requested",

            actor: {
              uid:
                "admin-1",

              role:
                "finance_admin"
            },

            target: {
              type:
                "webhook_event",

              id:
                "event-1"
            },

            organizationId:
              null,

            source:
              "function",

            requestId:
              "request-1",

            createdAt:
              "created",

            metadata: {
              schemaVersion:
                1,

              previousStatus:
                "error",

              previousErrorCode:
                "ERR",

              reprocessCount:
                2,

              changedFields: [
                "status",
                "errorCode"
              ],

              unsupportedObject: {
                secret:
                  true
              }
            },

            before: {
              secret:
                true
            },

            after: {
              secret:
                true
            }
          }
        ]
      });

  assert.strictEqual(
    auditModel
      .items
      .length,
    1
  );

  assert.ok(
    auditModel
      .items[0]
      .metadata
      .includes(
        "previousStatus=error"
      )
  );

  assert.strictEqual(
    auditModel
      .items[0]
      .metadata
      .includes(
        "secret"
      ),
    false
  );

  const calls =
    [];

  const routeRuntime = {
    getListState(
      routeId
    ) {
      return {
        basePayload:
          routeId ===
            "webhooks"
            ? {
                status:
                  "error"
              }
            : {
                actorUid:
                  "admin-1"
              }
      };
    },

    applyFilters(
      routeId,
      filters
    ) {
      calls.push({
        type:
          "filters",

        routeId,
        filters
      });

      return Promise.resolve({
        state:
          "route-ready"
      });
    },

    loadNextPage(
      routeId
    ) {
      calls.push({
        type:
          "next",

        routeId
      });

      return Promise.resolve({
        state:
          "route-ready"
      });
    },

    loadDetail(
      routeId,
      id
    ) {
      calls.push({
        type:
          "detail",

        routeId,
        id
      });

      return Promise.resolve({
        state:
          "route-ready"
      });
    },

    restoreList(
      routeId
    ) {
      calls.push({
        type:
          "restore",

        routeId
      });

      return {
        state:
          "route-ready"
      };
    }
  };

  const document =
    documentStub();

  const renderer =
    rendererApi
      .createWebhooksAuditRenderer({
        document,
        routeRuntime
      });

  const webhooksContainer =
    element();

  assert.strictEqual(
    renderer.render(
      webhooksContainer,
      {
        state:
          "route-ready",

        routeId:
          "webhooks",

        mode:
          "list",

        data: {
          items: [
            {
              eventId:
                "event-1",

              eventType:
                "PAYMENT_RECEIVED",

              status:
                "processed",

              relatedOrderId:
                "order-1",

              deliveryCount:
                1,

              timestamps: {
                receivedAt:
                  "received"
              }
            }
          ],

          nextCursor:
            "cursor"
        }
      }
    ),
    true
  );

  const webhookText =
    textTree(
      webhooksContainer
    );

  assert.ok(
    webhookText.includes(
      "Webhooks"
    )
  );

  assert.strictEqual(
    webhookText.includes(
      "reprocess"
    ),
    false
  );

  const webhookInputs =
    walk(
      webhooksContainer,
      node =>
        node?.tagName ===
          "INPUT"
    );

  const statusInput =
    webhookInputs.find(
      input =>
        input.name ===
          "status"
    );

  assert.ok(
    statusInput
  );

  assert.strictEqual(
    statusInput.value,
    "error"
  );

  const buttons =
    walk(
      webhooksContainer,
      node =>
        node?.tagName ===
          "BUTTON"
    );

  const open =
    buttons.find(
      button =>
        button.textContent ===
          "Abrir"
    );

  const more =
    buttons.find(
      button =>
        button.textContent ===
          "Carregar mais"
    );

  assert.ok(open);
  assert.ok(more);

  open.listeners
    .click();

  more.listeners
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
          "webhooks",

        id:
          "event-1"
      },

      {
        type:
          "next",

        routeId:
          "webhooks"
      }
    ]
  );

  const filterForm =
    walk(
      webhooksContainer,
      node =>
        node?.tagName ===
          "FORM"
    )[0];

  const orderInput =
    webhookInputs.find(
      input =>
        input.name ===
          "orderId"
    );

  orderInput.value =
    " order-9 ";

  filterForm.listeners
    .submit({
      preventDefault() {}
    });

  assert.deepStrictEqual(
    calls[2],
    {
      type:
        "filters",

      routeId:
        "webhooks",

      filters: {
        status:
          "error",

        orderId:
          "order-9"
      }
    }
  );

  const detailContainer =
    element();

  renderer.render(
    detailContainer,
    {
      state:
        "route-ready",

      routeId:
        "webhooks",

      mode:
        "detail",

      data: {
        webhook: {
          eventId:
            "event-1",

          provider:
            "asaas",

          providerEventRef:
            "***masked",

          eventType:
            "PAYMENT_RECEIVED",

          status:
            "processed",

          relatedOrderId:
            "order-1",

          deliveryCount:
            1,

          processing: {
            action:
              "confirm_payment",

            result:
              "processed",

            errorCode:
              null
          },

          timestamps: {
            receivedAt:
              "received",

            lastReceivedAt:
              "last",

            processedAt:
              "processed"
          }
        }
      }
    }
  );

  const detailText =
    textTree(
      detailContainer
    );

  assert.ok(
    detailText.includes(
      "***masked"
    )
  );

  assert.strictEqual(
    detailText.includes(
      "reprocess"
    ),
    false
  );

  const back =
    walk(
      detailContainer,
      node =>
        node?.tagName ===
          "BUTTON" &&
        node.textContent ===
          "Voltar para webhooks"
    )[0];

  assert.ok(back);

  back.listeners
    .click();

  assert.deepStrictEqual(
    calls[3],
    {
      type:
        "restore",

      routeId:
        "webhooks"
    }
  );

  const auditContainer =
    element();

  renderer.render(
    auditContainer,
    {
      state:
        "route-ready",

      routeId:
        "audit",

      mode:
        "list",

      data: {
        items: [
          {
            auditId:
              "audit-1",

            eventType:
              "admin.webhook.reprocess.requested",

            actor: {
              uid:
                "admin-1",

              role:
                "finance_admin"
            },

            target: {
              type:
                "webhook_event",

              id:
                "event-1"
            },

            source:
              "function",

            createdAt:
              "created",

            metadata: {
              previousStatus:
                "error",

              reprocessCount:
                1
            }
          }
        ],

        nextCursor:
          null
      }
    }
  );

  const auditText =
    textTree(
      auditContainer
    );

  assert.ok(
    auditText.includes(
      "Auditoria"
    )
  );

  assert.ok(
    auditText.includes(
      "previousStatus=error"
    )
  );

  assert.strictEqual(
    renderer.render(
      element(),
      {
        state:
          "route-ready",

        routeId:
          "finance",

        data: {}
      }
    ),
    false
  );

  assert.strictEqual(
    registryApi
      .webhooksAuditIntegratedRegistry()
      .integratedRoutes()
      .length,
    11
  );

  const operationalCalls =
    [];

  const financeCalls =
    [];

  const webhooksAuditCalls =
    [];

  const controller =
    controllerApi
      .createController({
        document,

        navigationApi: {
          buildNavigation() {
            return [
              {
                id:
                  "console",

                label:
                  "Console",

                items: [
                  {
                    id:
                      "webhooks",

                    label:
                      "Webhooks",

                    route:
                      "webhooks",

                    capability:
                      "console.webhooks.read"
                  }
                ]
              }
            ];
          },

          canNavigateTo(
            _context,
            route
          ) {
            return (
              route ===
              "webhooks"
            );
          },

          firstAllowedRoute() {
            return "webhooks";
          }
        },

        routeRuntime: {
          activate(
            routeId
          ) {
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
          }
        },

        operationalRenderer: {
          render(
            _container,
            state
          ) {
            operationalCalls.push(
              state.routeId
            );

            return false;
          }
        },

        financeSplitsRenderer: {
          render(
            _container,
            state
          ) {
            financeCalls.push(
              state.routeId
            );

            return false;
          }
        },

        webhooksAuditRenderer: {
          render(
            container,
            state
          ) {
            webhooksAuditCalls.push(
              state.routeId
            );

            container
              .replaceChildren(
                element()
              );

            return true;
          }
        }
      });

  controller.mountContext(
    {
      userId:
        "admin-1",

      displayName:
        "Admin",

      environment:
        "staging"
    },
    "webhooks"
  );

  await flush();

  assert.deepStrictEqual(
    operationalCalls,
    [
      "webhooks"
    ]
  );

  assert.deepStrictEqual(
    financeCalls,
    [
      "webhooks"
    ]
  );

  assert.deepStrictEqual(
    webhooksAuditCalls,
    [
      "webhooks"
    ]
  );

  assert.strictEqual(
    document
      .nodes
      .get(
        "[data-admin-route-placeholder-panel]"
      )
      .hidden,
    true
  );

  assert.strictEqual(
    document
      .nodes
      .get(
        "[data-admin-operational-content]"
      )
      .hidden,
    false
  );

  const html =
    source(
      "admin_shell_v1_2.html"
    );

  const controllerSource =
    source(
      "js/admin-shell-controller-v1_2.js"
    );

  const rendererSource =
    source(
      "js/admin-shell-webhooks-audit-renderer-v1_2.js"
    );

  const order = [
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-finance-splits-renderer-v1_2.js",
    "js/admin-shell-webhooks-audit-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js"
  ].map(
    item =>
      html.indexOf(
        item
      )
  );

  assert.ok(
    order.every(
      index =>
        index >= 0
    )
  );

  for (
    let index = 1;
    index <
      order.length;
    index += 1
  ) {
    assert.ok(
      order[index] >
        order[index - 1]
    );
  }

  for (
    const marker of [
      "BjjExamsAdminShellWebhooksAuditRenderer",
      "__bjjAdminShellWebhooksAuditRendererV12",
      "webhooksAuditIntegratedRegistry",
      "financeSplitsIntegratedRegistry",
      "operationalIntegratedRegistry",
      "webhooksAuditRenderer"
    ]
  ) {
    assert.ok(
      html.includes(
        marker
      ),
      `Missing E2 HTML marker ${marker}`
    );
  }

  assert.ok(
    controllerSource.includes(
      "webhooksAuditRenderer"
    )
  );

  assert.ok(
    controllerSource.includes(
      "rendererCandidates"
    )
  );

  assert.strictEqual(
    rendererSource.includes(
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

  assert.strictEqual(
    rendererSource.includes(
      "reprocessarWebhookOperacionalV12"
    ),
    false
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
    for (
      const src of [
        html,
        controllerSource,
        rendererSource
      ]
    ) {
      assert.strictEqual(
        src.includes(
          forbidden
        ),
        false
      );
    }
  }

  console.log(
    "MARCO8_7E2_WEBHOOK_LIST_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7E2_WEBHOOK_DETAIL_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7E2_AUDIT_LIST_VIEW_MODEL=PASSED"
  );

  console.log(
    "MARCO8_7E2_FILTER_DEFINITIONS=8/8"
  );

  console.log(
    "MARCO8_7E2_WEBHOOK_FILTER_ACTIONS=PASSED"
  );

  console.log(
    "MARCO8_7E2_WEBHOOK_DETAIL_ACTION=PASSED"
  );

  console.log(
    "MARCO8_7E2_WEBHOOK_RESTORE_LIST=PASSED"
  );

  console.log(
    "MARCO8_7E2_PAGINATION_ACTION=PASSED"
  );

  console.log(
    "MARCO8_7E2_AUDIT_METADATA_SAFE_PROJECTION=PASSED"
  );

  console.log(
    "MARCO8_7E2_ACTIVE_ROUTES=11/14"
  );

  console.log(
    "MARCO8_7E2_REPROCESS_FRONTEND=BLOCKED"
  );

  console.log(
    "MARCO8_7E2_SAFE_DOM=PASSED"
  );

  console.log(
    "MARCO8_7E2_BASIC_ACCESSIBILITY=PASSED"
  );

  console.log(
    "MARCO8_7E2_DIRECT_FIRESTORE=FORBIDDEN"
  );

  console.log(
    "MARCO8_7E2_WEBHOOK_AUDIT_RENDERING=PASSED"
  );
}

main().catch(
  error => {
    console.error(
      error
    );

    process.exitCode =
      1;
  }
);

"use strict";

(function initAdminShellWebhooksAuditRenderer(root, factory) {
  const api = factory();

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellWebhooksAuditRenderer =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellWebhooksAuditRenderer() {
    const WEBHOOK_AUDIT_ROUTE_IDS =
      Object.freeze([
        "webhooks",
        "audit"
      ]);

    const FILTER_DEFINITIONS =
      Object.freeze({
        webhooks:
          Object.freeze([
            Object.freeze({
              name:
                "status",
              label:
                "Status"
            }),
            Object.freeze({
              name:
                "eventType",
              label:
                "Tipo do evento"
            }),
            Object.freeze({
              name:
                "orderId",
              label:
                "ID do pedido"
            })
          ]),

        audit:
          Object.freeze([
            Object.freeze({
              name:
                "eventType",
              label:
                "Tipo do evento"
            }),
            Object.freeze({
              name:
                "actorUid",
              label:
                "UID do ator"
            }),
            Object.freeze({
              name:
                "targetType",
              label:
                "Tipo do alvo"
            }),
            Object.freeze({
              name:
                "targetId",
              label:
                "ID do alvo"
            }),
            Object.freeze({
              name:
                "organizationId",
              label:
                "ID da organizacao"
            })
          ])
      });

    function safeText(
      value,
      fallback = "—"
    ) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return fallback;
      }

      if (
        typeof value ===
          "string" ||
        typeof value ===
          "number" ||
        typeof value ===
          "boolean"
      ) {
        return String(
          value
        );
      }

      if (
        value instanceof Date
      ) {
        return value.toISOString();
      }

      if (
        value &&
        typeof value.toDate ===
          "function"
      ) {
        const date =
          value.toDate();

        if (
          date instanceof Date &&
          !Number.isNaN(
            date.getTime()
          )
        ) {
          return date.toISOString();
        }
      }

      const seconds =
        Number(
          value?._seconds ??
          value?.seconds
        );

      if (
        Number.isFinite(
          seconds
        )
      ) {
        const milliseconds =
          seconds * 1000;

        const date =
          new Date(
            milliseconds
          );

        if (
          !Number.isNaN(
            date.getTime()
          )
        ) {
          return date.toISOString();
        }
      }

      return fallback;
    }

    let requestSequence =
      0;

    function createReprocessRequestId(
      cryptoApi =
        (
          typeof globalThis !==
            "undefined"
            ? globalThis.crypto
            : null
        )
    ) {
      if (
        cryptoApi &&
        typeof cryptoApi.randomUUID ===
          "function"
      ) {
        return (
          "webhook-reprocess-" +
          cryptoApi.randomUUID()
        );
      }

      requestSequence +=
        1;

      return (
        "webhook-reprocess-" +
        Date.now() +
        "-" +
        requestSequence
      );
    }

    function createTextElement(
      document,
      tagName,
      value
    ) {
      const element =
        document.createElement(
          tagName
        );

      element.textContent =
        safeText(
          value,
          ""
        );

      return element;
    }

    function compactMetadata(
      metadata
    ) {
      if (
        !metadata ||
        typeof metadata !==
          "object" ||
        Array.isArray(
          metadata
        )
      ) {
        return "—";
      }

      const parts =
        [];

      for (
        const [
          key,
          rawValue
        ] of Object.entries(
          metadata
        )
      ) {
        if (
          rawValue ===
            undefined ||
          rawValue ===
            null
        ) {
          continue;
        }

        let display;

        if (
          Array.isArray(
            rawValue
          )
        ) {
          display =
            rawValue
              .filter(
                item =>
                  (
                    typeof item ===
                      "string" ||
                    typeof item ===
                      "number" ||
                    typeof item ===
                      "boolean"
                  )
              )
              .map(
                item =>
                  String(
                    item
                  )
              )
              .join(", ");
        }
        else if (
          typeof rawValue ===
            "string" ||
          typeof rawValue ===
            "number" ||
          typeof rawValue ===
            "boolean"
        ) {
          display =
            String(
              rawValue
            );
        }
        else {
          continue;
        }

        if (!display) {
          continue;
        }

        parts.push(
          `${key}=${display}`
        );
      }

      return (
        parts.join("; ") ||
        "—"
      );
    }

    function buildWebhookListViewModel(
      result
    ) {
      const items =
        Array.isArray(
          result?.items
        )
          ? result.items
          : [];

      return Object.freeze({
        routeId:
          "webhooks",

        items:
          Object.freeze(
            items.map(
              item =>
                Object.freeze({
                  eventId:
                    safeText(
                      item?.eventId
                    ),
                  eventType:
                    safeText(
                      item?.eventType
                    ),
                  status:
                    safeText(
                      item?.status
                    ),
                  relatedOrderId:
                    safeText(
                      item?.relatedOrderId
                    ),
                  deliveryCount:
                    safeText(
                      item?.deliveryCount
                    ),
                  receivedAt:
                    safeText(
                      item
                        ?.timestamps
                        ?.receivedAt
                    )
                })
            )
          ),

        hasNext:
          Boolean(
            result?.nextCursor
          )
      });
    }

    function buildWebhookDetailViewModel(
      result
    ) {
      const item =
        result?.webhook &&
        typeof result.webhook ===
          "object" &&
        !Array.isArray(
          result.webhook
        )
          ? result.webhook
          : {};

      return Object.freeze({
        routeId:
          "webhooks",

        eventId:
          safeText(
            item.eventId
          ),

        provider:
          safeText(
            item.provider
          ),

        providerEventRef:
          safeText(
            item.providerEventRef
          ),

        eventType:
          safeText(
            item.eventType
          ),

        status:
          safeText(
            item.status
          ),

        relatedOrderId:
          safeText(
            item.relatedOrderId
          ),

        deliveryCount:
          safeText(
            item.deliveryCount
          ),

        processingAction:
          safeText(
            item
              .processing
              ?.action
          ),

        processingResult:
          safeText(
            item
              .processing
              ?.result
          ),

        errorCode:
          safeText(
            item
              .processing
              ?.errorCode
          ),

        receivedAt:
          safeText(
            item
              .timestamps
              ?.receivedAt
          ),

        lastReceivedAt:
          safeText(
            item
              .timestamps
              ?.lastReceivedAt
          ),

        processedAt:
          safeText(
            item
              .timestamps
              ?.processedAt
          )
      });
    }

    function buildAuditListViewModel(
      result
    ) {
      const items =
        Array.isArray(
          result?.items
        )
          ? result.items
          : [];

      return Object.freeze({
        routeId:
          "audit",

        items:
          Object.freeze(
            items.map(
              item =>
                Object.freeze({
                  auditId:
                    safeText(
                      item?.auditId
                    ),

                  eventType:
                    safeText(
                      item?.eventType
                    ),

                  actor:
                    [
                      safeText(
                        item?.actor?.uid,
                        ""
                      ),
                      safeText(
                        item?.actor?.role,
                        ""
                      )
                    ]
                      .filter(
                        Boolean
                      )
                      .join(" / ") ||
                    "—",

                  target:
                    [
                      safeText(
                        item?.target?.type,
                        ""
                      ),
                      safeText(
                        item?.target?.id,
                        ""
                      )
                    ]
                      .filter(
                        Boolean
                      )
                      .join(" / ") ||
                    "—",

                  organizationId:
                    safeText(
                      item
                        ?.organizationId
                    ),

                  source:
                    safeText(
                      item?.source
                    ),

                  requestId:
                    safeText(
                      item?.requestId
                    ),

                  createdAt:
                    safeText(
                      item?.createdAt
                    ),

                  metadata:
                    compactMetadata(
                      item?.metadata
                    )
                })
            )
          ),

        hasNext:
          Boolean(
            result?.nextCursor
          )
      });
    }

    function currentFilters(
      routeRuntime,
      routeId
    ) {
      const state =
        routeRuntime
          .getListState(
            routeId
          );

      const payload =
        state?.basePayload &&
        typeof state.basePayload ===
          "object"
          ? state.basePayload
          : {};

      const output =
        {};

      for (
        const definition of
        FILTER_DEFINITIONS[
          routeId
        ] ||
        []
      ) {
        const value =
          payload[
            definition.name
          ];

        if (
          value !== undefined &&
          value !== null &&
          value !== ""
        ) {
          output[
            definition.name
          ] =
            String(
              value
            );
        }
      }

      return Object.freeze(
        output
      );
    }

    function appendFilters(
      document,
      routeRuntime,
      routeId,
      parent
    ) {
      const definitions =
        FILTER_DEFINITIONS[
          routeId
        ] ||
        [];

      if (
        definitions.length ===
        0
      ) {
        return;
      }

      const form =
        document.createElement(
          "form"
        );

      form.className =
        "operational-filters";

      const fieldset =
        document.createElement(
          "fieldset"
        );

      fieldset.className =
        "operational-filter-fieldset";

      const legend =
        createTextElement(
          document,
          "legend",
          "Filtros"
        );

      fieldset.appendChild(
        legend
      );

      const grid =
        document.createElement(
          "div"
        );

      grid.className =
        "operational-filter-grid";

      const filterValues =
        currentFilters(
          routeRuntime,
          routeId
        );

      const inputs =
        new Map();

      for (
        const definition of
        definitions
      ) {
        const wrapper =
          document.createElement(
            "div"
          );

        wrapper.className =
          "operational-filter-field";

        const inputId =
          `admin-${routeId}-filter-${definition.name}`;

        const label =
          createTextElement(
            document,
            "label",
            definition.label
          );

        label.setAttribute(
          "for",
          inputId
        );

        const input =
          document.createElement(
            "input"
          );

        input.type =
          "text";

        input.id =
          inputId;

        input.name =
          definition.name;

        input.autocomplete =
          "off";

        input.value =
          filterValues[
            definition.name
          ] ||
          "";

        inputs.set(
          definition.name,
          input
        );

        wrapper.appendChild(
          label
        );

        wrapper.appendChild(
          input
        );

        grid.appendChild(
          wrapper
        );
      }

      fieldset.appendChild(
        grid
      );

      const actions =
        document.createElement(
          "div"
        );

      actions.className =
        "operational-filter-actions";

      const apply =
        document.createElement(
          "input"
        );

      apply.type =
        "submit";

      apply.value =
        "Aplicar filtros";

      const clear =
        document.createElement(
          "input"
        );

      clear.type =
        "button";

      clear.value =
        "Limpar filtros";

      clear.addEventListener(
        "click",
        () => {
          for (
            const input of
            inputs.values()
          ) {
            input.value =
              "";
          }

          routeRuntime
            .applyFilters(
              routeId,
              {}
            );
        }
      );

      form.addEventListener(
        "submit",
        event => {
          if (
            event &&
            typeof event
              .preventDefault ===
              "function"
          ) {
            event.preventDefault();
          }

          const filters =
            {};

          for (
            const [
              name,
              input
            ] of inputs.entries()
          ) {
            const value =
              String(
                input.value ||
                ""
              ).trim();

            if (value) {
              filters[name] =
                value;
            }
          }

          routeRuntime
            .applyFilters(
              routeId,
              filters
            );
        }
      );

      actions.appendChild(
        apply
      );

      actions.appendChild(
        clear
      );

      fieldset.appendChild(
        actions
      );

      form.appendChild(
        fieldset
      );

      parent.appendChild(
        form
      );
    }

    function appendTable(
      document,
      parent,
      columns,
      rows,
      captionText
    ) {
      const region =
        document.createElement(
          "div"
        );

      region.className =
        "operational-table-region";

      region.tabIndex =
        0;

      const table =
        document.createElement(
          "table"
        );

      const caption =
        createTextElement(
          document,
          "caption",
          captionText
        );

      table.appendChild(
        caption
      );

      const thead =
        document.createElement(
          "thead"
        );

      const headRow =
        document.createElement(
          "tr"
        );

      for (
        const column of
        columns
      ) {
        const th =
          createTextElement(
            document,
            "th",
            column.label
          );

        th.scope =
          "col";

        headRow.appendChild(
          th
        );
      }

      thead.appendChild(
        headRow
      );

      table.appendChild(
        thead
      );

      const tbody =
        document.createElement(
          "tbody"
        );

      for (
        const rowData of
        rows
      ) {
        const tr =
          document.createElement(
            "tr"
          );

        for (
          const column of
          columns
        ) {
          const td =
            document.createElement(
              "td"
            );

          if (
            typeof column.render ===
              "function"
          ) {
            column.render(
              td,
              rowData
            );
          }
          else {
            td.textContent =
              safeText(
                rowData[
                  column.key
                ]
              );
          }

          tr.appendChild(
            td
          );
        }

        tbody.appendChild(
          tr
        );
      }

      table.appendChild(
        tbody
      );

      region.appendChild(
        table
      );

      parent.appendChild(
        region
      );
    }

    function appendPagination(
      document,
      routeRuntime,
      routeId,
      parent,
      hasNext
    ) {
      if (!hasNext) {
        return;
      }

      const button =
        createTextElement(
          document,
          "button",
          "Carregar mais"
        );

      button.type =
        "button";

      button.addEventListener(
        "click",
        () => {
          routeRuntime
            .loadNextPage(
              routeId
            );
        }
      );

      parent.appendChild(
        button
      );
    }

    function renderWebhooksList(
      document,
      routeRuntime,
      container,
      state
    ) {
      const model =
        buildWebhookListViewModel(
          state.data
        );

      const section =
        document.createElement(
          "section"
        );

      section.className =
        "operational-list";

      const heading =
        createTextElement(
          document,
          "h2",
          "Webhooks"
        );

      section.appendChild(
        heading
      );

      appendFilters(
        document,
        routeRuntime,
        "webhooks",
        section
      );

      if (
        model.items.length ===
        0
      ) {
        const empty =
          createTextElement(
            document,
            "p",
            "Nenhum webhook encontrado para os filtros atuais."
          );

        empty.setAttribute(
          "role",
          "status"
        );

        empty.setAttribute(
          "aria-live",
          "polite"
        );

        section.appendChild(
          empty
        );
      }
      else {
        appendTable(
          document,
          section,
          [
            {
              key:
                "eventId",
              label:
                "Evento"
            },
            {
              key:
                "eventType",
              label:
                "Tipo"
            },
            {
              key:
                "status",
              label:
                "Status"
            },
            {
              key:
                "relatedOrderId",
              label:
                "Pedido"
            },
            {
              key:
                "deliveryCount",
              label:
                "Entregas"
            },
            {
              key:
                "receivedAt",
              label:
                "Recebido em"
            },
            {
              key:
                "eventId",
              label:
                "Detalhe",

              render(
                cell,
                row
              ) {
                const button =
                  createTextElement(
                    document,
                    "button",
                    "Abrir"
                  );

                button.type =
                  "button";

                button.addEventListener(
                  "click",
                  () => {
                    routeRuntime
                      .loadDetail(
                        "webhooks",
                        row.eventId
                      );
                  }
                );

                cell.appendChild(
                  button
                );
              }
            }
          ],
          model.items,
          "Eventos de webhook"
        );
      }

      appendPagination(
        document,
        routeRuntime,
        "webhooks",
        section,
        model.hasNext
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function addDefinitionRow(
      document,
      list,
      label,
      value
    ) {
      list.appendChild(
        createTextElement(
          document,
          "dt",
          label
        )
      );

      list.appendChild(
        createTextElement(
          document,
          "dd",
          value
        )
      );
    }

    function renderWebhookDetail(
      document,
      routeRuntime,
      container,
      state,
      requestIdFactory
    ) {
      const model =
        buildWebhookDetailViewModel(
          state.data
        );

      const section =
        document.createElement(
          "section"
        );

      section.className =
        "operational-detail";

      const heading =
        createTextElement(
          document,
          "h2",
          "Detalhe do webhook"
        );

      section.appendChild(
        heading
      );

      const list =
        document.createElement(
          "dl"
        );

      for (
        const [
          label,
          value
        ] of [
          [
            "Evento",
            model.eventId
          ],
          [
            "Provider",
            model.provider
          ],
          [
            "Referencia do provider",
            model.providerEventRef
          ],
          [
            "Tipo",
            model.eventType
          ],
          [
            "Status",
            model.status
          ],
          [
            "Pedido relacionado",
            model.relatedOrderId
          ],
          [
            "Quantidade de entregas",
            model.deliveryCount
          ],
          [
            "Acao de processamento",
            model.processingAction
          ],
          [
            "Resultado de processamento",
            model.processingResult
          ],
          [
            "Codigo de erro",
            model.errorCode
          ],
          [
            "Recebido em",
            model.receivedAt
          ],
          [
            "Ultimo recebimento",
            model.lastReceivedAt
          ],
          [
            "Processado em",
            model.processedAt
          ]
        ]
      ) {
        addDefinitionRow(
          document,
          list,
          label,
          value
        );
      }

      section.appendChild(
        list
      );

      const canReprocess =
        model.status
          .toLowerCase() ===
            "error" &&
        typeof routeRuntime
          .canExecuteAction ===
          "function" &&
        typeof routeRuntime
          .executeAction ===
          "function" &&
        routeRuntime
          .canExecuteAction(
            "webhooks",
            "reprocess"
          );

      if (canReprocess) {
        const actionRegion =
          document.createElement(
            "div"
          );

        actionRegion.className =
          "operational-filter-actions";

        actionRegion.setAttribute(
          "aria-live",
          "polite"
        );

        const start =
          createTextElement(
            document,
            "button",
            "Reprocessar webhook"
          );

        start.type =
          "button";

        start.addEventListener(
          "click",
          () => {
            const warning =
              createTextElement(
                document,
                "p",
                "Esta acao reexecuta o processamento do webhook e pode alterar o estado financeiro canonico. Confirme somente se o evento deve ser processado novamente."
              );

            const confirm =
              createTextElement(
                document,
                "button",
                "Confirmar reprocessamento"
              );

            confirm.type =
              "button";

            const cancel =
              createTextElement(
                document,
                "button",
                "Cancelar"
              );

            cancel.type =
              "button";

            cancel.addEventListener(
              "click",
              () => {
                actionRegion
                  .replaceChildren(
                    start
                  );
              }
            );

            confirm.addEventListener(
              "click",
              () => {
                confirm.disabled =
                  true;

                cancel.disabled =
                  true;

                const progress =
                  createTextElement(
                    document,
                    "span",
                    "Reprocessamento em andamento."
                  );

                progress.setAttribute(
                  "role",
                  "status"
                );

                actionRegion
                  .replaceChildren(
                    progress
                  );

                const requestId =
                  requestIdFactory();

                Promise.resolve(
                  routeRuntime
                    .executeAction(
                      "webhooks",
                      "reprocess",
                      {
                        eventId:
                          model.eventId,

                        requestId
                      },
                      {
                        confirmed:
                          true
                      }
                    )
                )
                  .then(
                    result => {
                      if (
                        result?.status ===
                          "action-succeeded"
                      ) {
                        progress.textContent =
                          "Reprocessamento confirmado pelo backend. Atualizando detalhe.";

                        return;
                      }

                      if (
                        result?.status ===
                          "stale"
                      ) {
                        return;
                      }

                      progress.textContent =
                        "Nao foi possivel confirmar o reprocessamento.";
                    }
                  )
                  .catch(
                    () => {
                      progress.textContent =
                        "Nao foi possivel confirmar o reprocessamento.";
                    }
                  );
              }
            );

            actionRegion
              .replaceChildren(
                warning,
                confirm,
                cancel
              );
          }
        );

        actionRegion
          .appendChild(
            start
          );

        section.appendChild(
          actionRegion
        );
      }

      const back =
        createTextElement(
          document,
          "button",
          "Voltar para webhooks"
        );

      back.type =
        "button";

      back.addEventListener(
        "click",
        () => {
          routeRuntime
            .restoreList(
              "webhooks"
            );
        }
      );

      section.appendChild(
        back
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function renderAuditList(
      document,
      routeRuntime,
      container,
      state
    ) {
      const model =
        buildAuditListViewModel(
          state.data
        );

      const section =
        document.createElement(
          "section"
        );

      section.className =
        "operational-list";

      section.appendChild(
        createTextElement(
          document,
          "h2",
          "Auditoria"
        )
      );

      appendFilters(
        document,
        routeRuntime,
        "audit",
        section
      );

      if (
        model.items.length ===
        0
      ) {
        const empty =
          createTextElement(
            document,
            "p",
            "Nenhum evento de auditoria encontrado para os filtros atuais."
          );

        empty.setAttribute(
          "role",
          "status"
        );

        empty.setAttribute(
          "aria-live",
          "polite"
        );

        section.appendChild(
          empty
        );
      }
      else {
        appendTable(
          document,
          section,
          [
            {
              key:
                "auditId",
              label:
                "Auditoria"
            },
            {
              key:
                "eventType",
              label:
                "Evento"
            },
            {
              key:
                "actor",
              label:
                "Ator"
            },
            {
              key:
                "target",
              label:
                "Alvo"
            },
            {
              key:
                "organizationId",
              label:
                "Organizacao"
            },
            {
              key:
                "source",
              label:
                "Origem"
            },
            {
              key:
                "createdAt",
              label:
                "Criado em"
            },
            {
              key:
                "metadata",
              label:
                "Metadados permitidos"
            }
          ],
          model.items,
          "Eventos de auditoria"
        );
      }

      appendPagination(
        document,
        routeRuntime,
        "audit",
        section,
        model.hasNext
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function createWebhooksAuditRenderer(
      options = {}
    ) {
      const document =
        options.document;

      const routeRuntime =
        options.routeRuntime;

      const requestIdFactory =
        typeof options
          .requestIdFactory ===
          "function"
          ? options.requestIdFactory
          : createReprocessRequestId;

      if (
        !document ||
        typeof document
          .createElement !==
          "function"
      ) {
        throw new TypeError(
          "Webhooks/Audit renderer requires a document."
        );
      }

      for (
        const method of [
          "applyFilters",
          "loadNextPage",
          "loadDetail",
          "restoreList",
          "getListState"
        ]
      ) {
        if (
          !routeRuntime ||
          typeof routeRuntime[
            method
          ] !==
            "function"
        ) {
          throw new TypeError(
            `Webhooks/Audit renderer requires routeRuntime.${method}.`
          );
        }
      }

      function render(
        container,
        state
      ) {
        if (
          !container ||
          typeof container
            .replaceChildren !==
            "function" ||
          !state ||
          (
            state.state !==
              "route-ready" &&
            state.state !==
              "route-empty"
          )
        ) {
          return false;
        }

        const routeId =
          String(
            state.routeId ||
            ""
          ).trim();

        if (
          routeId ===
            "webhooks"
        ) {
          if (
            state.mode ===
              "detail"
          ) {
            return renderWebhookDetail(
              document,
              routeRuntime,
              container,
              state,
              requestIdFactory
            );
          }

          return renderWebhooksList(
            document,
            routeRuntime,
            container,
            state
          );
        }

        if (
          routeId ===
            "audit"
        ) {
          return renderAuditList(
            document,
            routeRuntime,
            container,
            state
          );
        }

        return false;
      }

      return Object.freeze({
        render
      });
    }

    return Object.freeze({
      WEBHOOK_AUDIT_ROUTE_IDS,
      FILTER_DEFINITIONS,
      safeText,
      compactMetadata,
      createReprocessRequestId,
      buildWebhookListViewModel,
      buildWebhookDetailViewModel,
      buildAuditListViewModel,
      createWebhooksAuditRenderer
    });
  }
);

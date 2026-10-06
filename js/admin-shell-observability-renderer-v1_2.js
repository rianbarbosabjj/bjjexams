"use strict";

(function initAdminShellObservabilityRenderer(root, factory) {
  const api = factory();

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellObservabilityRenderer =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellObservabilityRenderer() {
    const OBSERVABILITY_ROUTE_IDS =
      Object.freeze([
        "security",
        "configuration",
        "health"
      ]);

    function scalar(
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
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return String(value);
      }

      return fallback;
    }

    function yesNo(
      value
    ) {
      if (value === true) {
        return "Sim";
      }

      if (value === false) {
        return "Nao";
      }

      return "—";
    }

    function statusLabel(
      value
    ) {
      const normalized =
        String(value || "")
          .trim()
          .toLowerCase();

      if (
        normalized ===
        "unsupported"
      ) {
        return "Nao suportado";
      }

      if (
        normalized ===
        "unavailable"
      ) {
        return "Indisponivel";
      }

      if (
        normalized ===
        "not_measured"
      ) {
        return "Nao medido";
      }

      if (
        normalized ===
        "available"
      ) {
        return "Disponivel";
      }

      if (
        normalized ===
        "derived"
      ) {
        return "Derivado";
      }

      if (
        normalized ===
        "enabled"
      ) {
        return "Habilitado";
      }

      return scalar(
        value
      );
    }

    function safeView(
      result
    ) {
      return (
        result?.view &&
        typeof result.view ===
          "object" &&
        !Array.isArray(
          result.view
        )
          ? result.view
          : {}
      );
    }

    function createTextElement(
      document,
      tagName,
      value
    ) {
      const node =
        document.createElement(
          tagName
        );

      node.textContent =
        scalar(
          value,
          ""
        );

      return node;
    }

    function appendRow(
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

    function buildSecurityViewModel(
      result
    ) {
      const view =
        safeView(
          result
        );

      return Object.freeze({
        routeId:
          "security",

        environmentAdmin:
          scalar(
            view
              ?.environment
              ?.admin
          ),

        environmentFinancial:
          scalar(
            view
              ?.environment
              ?.financial
          ),

        region:
          scalar(
            view?.region
          ),

        nodeMajor:
          scalar(
            view
              ?.runtime
              ?.nodeMajor
          ),

        revision:
          scalar(
            view
              ?.runtime
              ?.revision
          ),

        adminRuntimeAllowed:
          yesNo(
            view
              ?.gates
              ?.adminRuntimeAllowed
          ),

        providerEnvironmentAllowed:
          yesNo(
            view
              ?.gates
              ?.providerEnvironmentAllowed
          ),

        asaasApiKeyConfigured:
          yesNo(
            view
              ?.bindings
              ?.asaasApiKeyConfigured
          ),

        asaasWebhookTokenConfigured:
          yesNo(
            view
              ?.bindings
              ?.asaasWebhookTokenConfigured
          ),

        productionAdminExportBlocked:
          yesNo(
            view
              ?.protections
              ?.productionAdminExportBlocked
          ),

        directBrowserAdminCollectionsBlocked:
          yesNo(
            view
              ?.protections
              ?.directBrowserAdminCollectionsBlocked
          ),

        secretValuesExposed:
          yesNo(
            view
              ?.protections
              ?.secretValuesExposed
          ),

        providerHealthPing:
          yesNo(
            view
              ?.protections
              ?.providerHealthPing
          ),

        alertsStatus:
          statusLabel(
            view
              ?.alerts
              ?.status
          )
      });
    }

    function buildConfigurationViewModel(
      result
    ) {
      const view =
        safeView(
          result
        );

      return Object.freeze({
        routeId:
          "configuration",

        contractVersion:
          scalar(
            view?.contractVersion
          ),

        region:
          scalar(
            view?.region
          ),

        environmentAdmin:
          scalar(
            view
              ?.environment
              ?.admin
          ),

        environmentFinancial:
          scalar(
            view
              ?.environment
              ?.financial
          ),

        providerName:
          scalar(
            view
              ?.provider
              ?.name
          ),

        providerAllowedByEnvironment:
          yesNo(
            view
              ?.provider
              ?.allowedByEnvironment
          ),

        providerExternalHealth:
          statusLabel(
            view
              ?.provider
              ?.externalHealth
          ),

        webhookDefaultLimit:
          scalar(
            view
              ?.limits
              ?.webhooks
              ?.defaultLimit
          ),

        webhookMaxLimit:
          scalar(
            view
              ?.limits
              ?.webhooks
              ?.maxLimit
          ),

        webhookMaxScanDocs:
          scalar(
            view
              ?.limits
              ?.webhooks
              ?.maxScanDocs
          ),

        auditDefaultLimit:
          scalar(
            view
              ?.limits
              ?.audit
              ?.defaultLimit
          ),

        auditMaxLimit:
          scalar(
            view
              ?.limits
              ?.audit
              ?.maxLimit
          ),

        auditMaxScanDocs:
          scalar(
            view
              ?.limits
              ?.audit
              ?.maxScanDocs
          ),

        auditMetadataMaxJsonBytes:
          scalar(
            view
              ?.limits
              ?.audit
              ?.metadataMaxJsonBytes
          ),

        configReadOnly:
          yesNo(
            view
              ?.features
              ?.configReadOnly
          ),

        configMutationEnabled:
          yesNo(
            view
              ?.features
              ?.configMutationEnabled
          ),

        providerHealthPing:
          yesNo(
            view
              ?.features
              ?.providerHealthPing
          ),

        productionAdminExport:
          yesNo(
            view
              ?.features
              ?.productionAdminExport
          )
      });
    }

    function buildHealthViewModel(
      result
    ) {
      const view =
        safeView(
          result
        );

      const webhookCounts =
        view
          ?.webhooks
          ?.counts &&
        typeof view
          .webhooks
          .counts ===
          "object" &&
        !Array.isArray(
          view.webhooks.counts
        )
          ? view.webhooks.counts
          : null;

      const reconciliationCounts =
        view
          ?.reconciliation
          ?.counts &&
        typeof view
          .reconciliation
          .counts ===
          "object" &&
        !Array.isArray(
          view.reconciliation.counts
        )
          ? view.reconciliation.counts
          : null;

      return Object.freeze({
        routeId:
          "health",

        environmentAdmin:
          scalar(
            view
              ?.environment
              ?.admin
          ),

        environmentFinancial:
          scalar(
            view
              ?.environment
              ?.financial
          ),

        firestoreReachable:
          yesNo(
            view
              ?.firestore
              ?.reachable
          ),

        queryMode:
          scalar(
            view
              ?.firestore
              ?.queryMode
          ),

        nodeMajor:
          scalar(
            view
              ?.runtime
              ?.nodeMajor
          ),

        revision:
          scalar(
            view
              ?.runtime
              ?.revision
          ),

        adminRuntimeAllowed:
          yesNo(
            view
              ?.functions
              ?.adminRuntimeAllowed
          ),

        securityFunction:
          statusLabel(
            view
              ?.functions
              ?.security
          ),

        configFunction:
          statusLabel(
            view
              ?.functions
              ?.config
          ),

        healthFunction:
          statusLabel(
            view
              ?.functions
              ?.health
          ),

        providerName:
          scalar(
            view
              ?.provider
              ?.name
          ),

        providerAllowedByEnvironment:
          yesNo(
            view
              ?.provider
              ?.allowedByEnvironment
          ),

        providerExternalHealth:
          statusLabel(
            view
              ?.provider
              ?.externalHealth
          ),

        webhooksStatus:
          statusLabel(
            view
              ?.webhooks
              ?.status
          ),

        webhookCounts:
          webhookCounts
            ? Object.freeze({
                total:
                  scalar(
                    webhookCounts.total
                  ),

                received:
                  scalar(
                    webhookCounts.received
                  ),

                processing:
                  scalar(
                    webhookCounts.processing
                  ),

                processed:
                  scalar(
                    webhookCounts.processed
                  ),

                ignored:
                  scalar(
                    webhookCounts.ignored
                  ),

                error:
                  scalar(
                    webhookCounts.error
                  )
              })
            : null,

        reconciliationStatus:
          statusLabel(
            view
              ?.reconciliation
              ?.status
          ),

        reconciliationCounts:
          reconciliationCounts
            ? Object.freeze({
                executing:
                  scalar(
                    reconciliationCounts
                      .executing
                  ),

                awaitingWebhook:
                  scalar(
                    reconciliationCounts
                      .awaitingWebhook
                  ),

                providerRejected:
                  scalar(
                    reconciliationCounts
                      .providerRejected
                  ),

                needsReconciliation:
                  scalar(
                    reconciliationCounts
                      .needsReconciliation
                  )
              })
            : null,

        incidentsStatus:
          statusLabel(
            view
              ?.incidents
              ?.status
          ),

        incidentsTotal:
          scalar(
            view
              ?.incidents
              ?.total
          ),

        webhookErrors:
          scalar(
            view
              ?.incidents
              ?.webhookErrors
          ),

        reconciliationRequired:
          scalar(
            view
              ?.incidents
              ?.reconciliationRequired
          )
      });
    }

    function createPanel(
      document,
      title,
      note,
      titleId
    ) {
      const section =
        document.createElement(
          "section"
        );

      section.className =
        "finance-console-panel";

      section.setAttribute(
        "aria-labelledby",
        titleId
      );

      const heading =
        createTextElement(
          document,
          "h2",
          title
        );

      heading.id =
        titleId;

      section.appendChild(
        heading
      );

      const description =
        createTextElement(
          document,
          "p",
          note
        );

      description.className =
        "finance-console-note";

      section.appendChild(
        description
      );

      return section;
    }

    function createSummary(
      document
    ) {
      const list =
        document.createElement(
          "dl"
        );

      list.className =
        "finance-console-summary";

      return list;
    }

    function renderSecurity(
      document,
      container,
      state
    ) {
      const model =
        buildSecurityViewModel(
          state.data
        );

      const section =
        createPanel(
          document,
          "Seguranca",
          "Visao operacional somente leitura. Valores de secrets nao sao expostos nesta superficie.",
          "security-console-title"
        );

      const summary =
        createSummary(
          document
        );

      appendRow(
        document,
        summary,
        "Ambiente administrativo",
        model.environmentAdmin
      );

      appendRow(
        document,
        summary,
        "Ambiente financeiro",
        model.environmentFinancial
      );

      appendRow(
        document,
        summary,
        "Regiao",
        model.region
      );

      appendRow(
        document,
        summary,
        "Node major",
        model.nodeMajor
      );

      appendRow(
        document,
        summary,
        "Revisao",
        model.revision
      );

      appendRow(
        document,
        summary,
        "Runtime administrativo permitido",
        model.adminRuntimeAllowed
      );

      appendRow(
        document,
        summary,
        "Ambiente do provider permitido",
        model.providerEnvironmentAllowed
      );

      appendRow(
        document,
        summary,
        "API key Asaas configurada",
        model.asaasApiKeyConfigured
      );

      appendRow(
        document,
        summary,
        "Token de webhook Asaas configurado",
        model.asaasWebhookTokenConfigured
      );

      appendRow(
        document,
        summary,
        "Export administrativo de producao bloqueado",
        model.productionAdminExportBlocked
      );

      appendRow(
        document,
        summary,
        "Colecoes administrativas diretas no browser bloqueadas",
        model.directBrowserAdminCollectionsBlocked
      );

      appendRow(
        document,
        summary,
        "Valores de secrets expostos",
        model.secretValuesExposed
      );

      appendRow(
        document,
        summary,
        "Provider health ping",
        model.providerHealthPing
      );

      appendRow(
        document,
        summary,
        "Alertas",
        model.alertsStatus
      );

      section.appendChild(
        summary
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function renderConfiguration(
      document,
      container,
      state
    ) {
      const model =
        buildConfigurationViewModel(
          state.data
        );

      const section =
        createPanel(
          document,
          "Configuracao",
          "Contrato operacional somente leitura. Esta tela nao possui mutation generica de configuracao.",
          "configuration-console-title"
        );

      const summary =
        createSummary(
          document
        );

      const rows = [
        [
          "Versao do contrato",
          model.contractVersion
        ],
        [
          "Regiao",
          model.region
        ],
        [
          "Ambiente administrativo",
          model.environmentAdmin
        ],
        [
          "Ambiente financeiro",
          model.environmentFinancial
        ],
        [
          "Provider",
          model.providerName
        ],
        [
          "Provider permitido pelo ambiente",
          model.providerAllowedByEnvironment
        ],
        [
          "Saude externa do provider",
          model.providerExternalHealth
        ],
        [
          "Webhook default limit",
          model.webhookDefaultLimit
        ],
        [
          "Webhook max limit",
          model.webhookMaxLimit
        ],
        [
          "Webhook max scan docs",
          model.webhookMaxScanDocs
        ],
        [
          "Audit default limit",
          model.auditDefaultLimit
        ],
        [
          "Audit max limit",
          model.auditMaxLimit
        ],
        [
          "Audit max scan docs",
          model.auditMaxScanDocs
        ],
        [
          "Audit metadata max JSON bytes",
          model.auditMetadataMaxJsonBytes
        ],
        [
          "Configuracao somente leitura",
          model.configReadOnly
        ],
        [
          "Mutation de configuracao habilitada",
          model.configMutationEnabled
        ],
        [
          "Provider health ping",
          model.providerHealthPing
        ],
        [
          "Export administrativo de producao",
          model.productionAdminExport
        ]
      ];

      for (
        const [
          label,
          value
        ] of rows
      ) {
        appendRow(
          document,
          summary,
          label,
          value
        );
      }

      section.appendChild(
        summary
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function renderHealth(
      document,
      container,
      state
    ) {
      const model =
        buildHealthViewModel(
          state.data
        );

      const section =
        createPanel(
          document,
          "Saude operacional",
          "Leituras de saude usam somente contagens agregadas. O provider externo nao recebe ping nesta superficie.",
          "health-console-title"
        );

      const summary =
        createSummary(
          document
        );

      const baseRows = [
        [
          "Ambiente administrativo",
          model.environmentAdmin
        ],
        [
          "Ambiente financeiro",
          model.environmentFinancial
        ],
        [
          "Firestore acessivel",
          model.firestoreReachable
        ],
        [
          "Modo de consulta",
          model.queryMode
        ],
        [
          "Node major",
          model.nodeMajor
        ],
        [
          "Revisao",
          model.revision
        ],
        [
          "Runtime administrativo permitido",
          model.adminRuntimeAllowed
        ],
        [
          "Funcao Security",
          model.securityFunction
        ],
        [
          "Funcao Config",
          model.configFunction
        ],
        [
          "Funcao Health",
          model.healthFunction
        ],
        [
          "Provider",
          model.providerName
        ],
        [
          "Provider permitido pelo ambiente",
          model.providerAllowedByEnvironment
        ],
        [
          "Saude externa do provider",
          model.providerExternalHealth
        ],
        [
          "Webhooks",
          model.webhooksStatus
        ]
      ];

      for (
        const [
          label,
          value
        ] of baseRows
      ) {
        appendRow(
          document,
          summary,
          label,
          value
        );
      }

      if (
        model.webhookCounts
      ) {
        for (
          const [
            label,
            value
          ] of [
            [
              "Webhooks total",
              model
                .webhookCounts
                .total
            ],
            [
              "Webhooks received",
              model
                .webhookCounts
                .received
            ],
            [
              "Webhooks processing",
              model
                .webhookCounts
                .processing
            ],
            [
              "Webhooks processed",
              model
                .webhookCounts
                .processed
            ],
            [
              "Webhooks ignored",
              model
                .webhookCounts
                .ignored
            ],
            [
              "Webhooks error",
              model
                .webhookCounts
                .error
            ]
          ]
        ) {
          appendRow(
            document,
            summary,
            label,
            value
          );
        }
      }

      appendRow(
        document,
        summary,
        "Reconciliacao",
        model.reconciliationStatus
      );

      if (
        model.reconciliationCounts
      ) {
        for (
          const [
            label,
            value
          ] of [
            [
              "Reversoes executando",
              model
                .reconciliationCounts
                .executing
            ],
            [
              "Reversoes aguardando webhook",
              model
                .reconciliationCounts
                .awaitingWebhook
            ],
            [
              "Reversoes rejeitadas pelo provider",
              model
                .reconciliationCounts
                .providerRejected
            ],
            [
              "Reversoes requerendo reconciliacao",
              model
                .reconciliationCounts
                .needsReconciliation
            ]
          ]
        ) {
          appendRow(
            document,
            summary,
            label,
            value
          );
        }
      }

      appendRow(
        document,
        summary,
        "Incidentes",
        model.incidentsStatus
      );

      appendRow(
        document,
        summary,
        "Incidentes totais",
        model.incidentsTotal
      );

      appendRow(
        document,
        summary,
        "Erros de webhook",
        model.webhookErrors
      );

      appendRow(
        document,
        summary,
        "Reconciliacoes requeridas",
        model.reconciliationRequired
      );

      section.appendChild(
        summary
      );

      container.replaceChildren(
        section
      );

      return true;
    }

    function createObservabilityRenderer(
      options = {}
    ) {
      const document =
        options.document;

      if (
        !document ||
        typeof document.createElement !==
          "function"
      ) {
        throw new TypeError(
          "Observability renderer requires a document."
        );
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
          "security"
        ) {
          return renderSecurity(
            document,
            container,
            state
          );
        }

        if (
          routeId ===
          "configuration"
        ) {
          return renderConfiguration(
            document,
            container,
            state
          );
        }

        if (
          routeId ===
          "health"
        ) {
          return renderHealth(
            document,
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
      OBSERVABILITY_ROUTE_IDS,
      statusLabel,
      buildSecurityViewModel,
      buildConfigurationViewModel,
      buildHealthViewModel,
      createObservabilityRenderer
    });
  }
);

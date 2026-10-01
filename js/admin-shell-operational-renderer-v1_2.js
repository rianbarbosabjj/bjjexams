"use strict";

(function initAdminShellOperationalRenderer(root, factory) {
  const api = factory();

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellOperationalRenderer =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellOperationalRenderer() {
    function field(
      path,
      label,
      kind = "text"
    ) {
      return Object.freeze({
        path,
        label,
        kind
      });
    }

    function presentation(
      value
    ) {
      return Object.freeze({
        routeId:
          value.routeId,

        title:
          value.title,

        singular:
          value.singular,

        entityIdField:
          value.entityIdField,

        detailResultKey:
          value.detailResultKey || null,

        listFields:
          Object.freeze([
            ...value.listFields
          ]),

        detailFields:
          Object.freeze([
            ...value.detailFields
          ])
      });
    }

    const OPERATIONAL_PRESENTATIONS =
      Object.freeze({
        people:
          presentation({
            routeId: "people",
            title: "Pessoas",
            singular: "Pessoa",
            entityIdField: "personId",
            detailResultKey: "person",

            listFields: [
              field(
                "displayName",
                "Nome"
              ),
              field(
                "email",
                "E-mail"
              ),
              field(
                "profileType",
                "Perfil"
              ),
              field(
                "operationalStatus",
                "Status"
              ),
              field(
                "memberships",
                "Vinculos",
                "array-count"
              )
            ],

            detailFields: [
              field(
                "personId",
                "ID"
              ),
              field(
                "displayName",
                "Nome"
              ),
              field(
                "email",
                "E-mail"
              ),
              field(
                "profileType",
                "Perfil"
              ),
              field(
                "operationalStatus",
                "Status"
              ),
              field(
                "memberships",
                "Vinculos",
                "array-count"
              ),
              field(
                "createdAt",
                "Criado em",
                "date"
              ),
              field(
                "updatedAt",
                "Atualizado em",
                "date"
              )
            ]
          }),

        organizations:
          presentation({
            routeId: "organizations",
            title: "Organizacoes",
            singular: "Organizacao",
            entityIdField: "organizationId",
            detailResultKey: "organization",

            listFields: [
              field(
                "name",
                "Nome"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "membershipCounts.total",
                "Vinculos",
                "number"
              ),
              field(
                "responsibleSummary.displayName",
                "Responsavel"
              )
            ],

            detailFields: [
              field(
                "organizationId",
                "ID"
              ),
              field(
                "name",
                "Nome"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "membershipCounts.total",
                "Vinculos totais",
                "number"
              ),
              field(
                "membershipCounts.active",
                "Vinculos ativos",
                "number"
              ),
              field(
                "membershipCounts.owners",
                "Owners",
                "number"
              ),
              field(
                "membershipCounts.managers",
                "Gestores",
                "number"
              ),
              field(
                "membershipCounts.instructors",
                "Instrutores",
                "number"
              ),
              field(
                "membershipCounts.students",
                "Alunos",
                "number"
              ),
              field(
                "responsibleSummary.displayName",
                "Responsavel"
              ),
              field(
                "responsibleSummary.email",
                "E-mail do responsavel"
              ),
              field(
                "responsibleSummary.role",
                "Papel do responsavel"
              ),
              field(
                "createdAt",
                "Criado em",
                "date"
              ),
              field(
                "updatedAt",
                "Atualizado em",
                "date"
              )
            ]
          }),

        courses:
          presentation({
            routeId: "courses",
            title: "Cursos",
            singular: "Curso",
            entityIdField: "courseId",
            detailResultKey: "course",

            listFields: [
              field(
                "title",
                "Titulo"
              ),
              field(
                "ownerType",
                "Tipo de proprietario"
              ),
              field(
                "ownerSummary.displayName",
                "Proprietario"
              ),
              field(
                "visibility",
                "Visibilidade"
              ),
              field(
                "workflowStatus",
                "Status"
              ),
              field(
                "moderationStatus",
                "Moderacao"
              ),
              field(
                "enrollmentSummary.total",
                "Matriculas",
                "number"
              )
            ],

            detailFields: [
              field(
                "courseId",
                "ID"
              ),
              field(
                "title",
                "Titulo"
              ),
              field(
                "ownerType",
                "Tipo de proprietario"
              ),
              field(
                "ownerSummary.ownerId",
                "ID do proprietario"
              ),
              field(
                "ownerSummary.displayName",
                "Proprietario"
              ),
              field(
                "visibility",
                "Visibilidade"
              ),
              field(
                "workflowStatus",
                "Status"
              ),
              field(
                "moderationStatus",
                "Moderacao"
              ),
              field(
                "enrollmentSummary.total",
                "Matriculas totais",
                "number"
              ),
              field(
                "enrollmentSummary.active",
                "Matriculas ativas",
                "number"
              ),
              field(
                "enrollmentSummary.completed",
                "Concluidas",
                "number"
              ),
              field(
                "enrollmentSummary.cancelled",
                "Canceladas",
                "number"
              ),
              field(
                "enrollmentSummary.refunded",
                "Reembolsadas",
                "number"
              ),
              field(
                "enrollmentSummary.chargeback",
                "Chargebacks",
                "number"
              )
            ]
          }),

        exams:
          presentation({
            routeId: "exams",
            title: "Provas",
            singular: "Prova",
            entityIdField: "sessionId",
            detailResultKey: "exam",

            listFields: [
              field(
                "organizationSummary.name",
                "Organizacao"
              ),
              field(
                "targetBelt",
                "Faixa"
              ),
              field(
                "scheduledAt",
                "Agendada para",
                "date"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "registrationCounts.total",
                "Inscricoes",
                "number"
              ),
              field(
                "resultCounts.total",
                "Resultados",
                "number"
              ),
              field(
                "certificateCounts.total",
                "Certificados",
                "number"
              )
            ],

            detailFields: [
              field(
                "sessionId",
                "ID"
              ),
              field(
                "organizationSummary.organizationId",
                "ID da organizacao"
              ),
              field(
                "organizationSummary.name",
                "Organizacao"
              ),
              field(
                "targetBelt",
                "Faixa"
              ),
              field(
                "scheduledAt",
                "Agendada para",
                "date"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "registrationCounts.total",
                "Inscricoes",
                "number"
              ),
              field(
                "attemptCounts.total",
                "Tentativas",
                "number"
              ),
              field(
                "resultCounts.total",
                "Resultados",
                "number"
              ),
              field(
                "certificateCounts.total",
                "Certificados",
                "number"
              )
            ]
          }),

        questions:
          presentation({
            routeId: "questions",
            title: "Questoes",
            singular: "Questao",
            entityIdField: "questionId",
            detailResultKey: null,

            listFields: [
              field(
                "statement",
                "Enunciado"
              ),
              field(
                "difficulty",
                "Dificuldade",
                "number"
              ),
              field(
                "category",
                "Categoria"
              ),
              field(
                "lifecycleStatus",
                "Status"
              ),
              field(
                "authorSummary.displayName",
                "Autor"
              ),
              field(
                "updatedAt",
                "Atualizada em",
                "date"
              )
            ],

            detailFields: [
              field(
                "questionId",
                "ID"
              ),
              field(
                "statement",
                "Enunciado"
              ),
              field(
                "difficulty",
                "Dificuldade",
                "number"
              ),
              field(
                "category",
                "Categoria"
              ),
              field(
                "lifecycleStatus",
                "Status"
              ),
              field(
                "authorSummary.authorId",
                "ID do autor"
              ),
              field(
                "authorSummary.displayName",
                "Autor"
              ),
              field(
                "createdAt",
                "Criada em",
                "date"
              ),
              field(
                "updatedAt",
                "Atualizada em",
                "date"
              )
            ]
          }),

        certificates:
          presentation({
            routeId: "certificates",
            title: "Certificados",
            singular: "Certificado",
            entityIdField: "certificateId",
            detailResultKey: null,

            listFields: [
              field(
                "studentName",
                "Aluno"
              ),
              field(
                "organizationName",
                "Organizacao"
              ),
              field(
                "targetBelt",
                "Faixa"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "scoreBps",
                "Pontuacao (bps)",
                "number"
              ),
              field(
                "issuedAt",
                "Emitido em",
                "date"
              )
            ],

            detailFields: [
              field(
                "certificateId",
                "ID"
              ),
              field(
                "status",
                "Status"
              ),
              field(
                "studentName",
                "Aluno"
              ),
              field(
                "organizationName",
                "Organizacao"
              ),
              field(
                "targetBelt",
                "Faixa"
              ),
              field(
                "scoreBps",
                "Pontuacao (bps)",
                "number"
              ),
              field(
                "correctCount",
                "Acertos",
                "number"
              ),
              field(
                "totalQuestions",
                "Total de questoes",
                "number"
              ),
              field(
                "issuedAt",
                "Emitido em",
                "date"
              ),
              field(
                "revokedAt",
                "Revogado em",
                "date"
              )
            ]
          }),

        orders:
          presentation({
            routeId: "orders",
            title: "Pedidos",
            singular: "Pedido",
            entityIdField: "orderId",
            detailResultKey: null,

            listFields: [
              field(
                "productSummary.label",
                "Produto"
              ),
              field(
                "buyerSummary.displayName",
                "Comprador"
              ),
              field(
                "paymentStatus.orderStatus",
                "Pedido"
              ),
              field(
                "fulfillmentStatus.status",
                "Entrega"
              ),
              field(
                "reversalStatus.status",
                "Reversao"
              ),
              field(
                "reconciliationStatus.required",
                "Reconciliacao",
                "boolean"
              ),
              field(
                "createdAt",
                "Criado em",
                "date"
              )
            ],

            detailFields: [
              field(
                "orderId",
                "ID"
              ),
              field(
                "productType",
                "Tipo de produto"
              ),
              field(
                "productSummary.productId",
                "ID do produto"
              ),
              field(
                "productSummary.label",
                "Produto"
              ),
              field(
                "buyerSummary.userId",
                "ID do comprador"
              ),
              field(
                "buyerSummary.displayName",
                "Comprador"
              ),
              field(
                "buyerSummary.email",
                "E-mail do comprador"
              ),
              field(
                "paymentStatus.orderStatus",
                "Status do pedido"
              ),
              field(
                "paymentStatus.transactionStatus",
                "Status da transacao"
              ),
              field(
                "fulfillmentStatus.kind",
                "Tipo de entrega"
              ),
              field(
                "fulfillmentStatus.status",
                "Status da entrega"
              ),
              field(
                "reversalStatus.status",
                "Status da reversao"
              ),
              field(
                "reversalStatus.operation",
                "Operacao da reversao"
              ),
              field(
                "reconciliationStatus.required",
                "Reconciliacao necessaria",
                "boolean"
              ),
              field(
                "createdAt",
                "Criado em",
                "date"
              )
            ]
          })
      });

    const OPERATIONAL_ROUTE_IDS =
      Object.freeze(
        Object.keys(
          OPERATIONAL_PRESENTATIONS
        )
      );

    function getPresentation(
      routeId
    ) {
      const route =
        String(
          routeId || ""
        ).trim();

      return (
        OPERATIONAL_PRESENTATIONS[
          route
        ] ||
        null
      );
    }

    function readPath(
      source,
      path
    ) {
      const segments =
        String(path || "")
          .split(".")
          .filter(Boolean);

      let current =
        source;

      for (
        const segment of
        segments
      ) {
        if (
          !current ||
          typeof current !==
            "object" ||
          Array.isArray(current) ||
          !Object.prototype
            .hasOwnProperty.call(
              current,
              segment
            )
        ) {
          return null;
        }

        current =
          current[segment];
      }

      return (
        current === undefined
          ? null
          : current
      );
    }

    function formatValue(
      value,
      kind = "text"
    ) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return "—";
      }

      if (
        kind ===
        "array-count"
      ) {
        return Array.isArray(value)
          ? String(
              value.length
            )
          : "—";
      }

      if (
        kind ===
        "boolean"
      ) {
        return value === true
          ? "Sim"
          : value === false
            ? "Nao"
            : "—";
      }

      if (
        kind ===
        "number"
      ) {
        const numeric =
          Number(value);

        return Number.isFinite(
          numeric
        )
          ? String(numeric)
          : "—";
      }

      return String(value);
    }

    function mapFields(
      source,
      definitions
    ) {
      return Object.freeze(
        definitions.map(
          definition =>
            Object.freeze({
              label:
                definition.label,

              value:
                formatValue(
                  readPath(
                    source,
                    definition.path
                  ),
                  definition.kind
                )
            })
        )
      );
    }

    function buildListViewModel(
      routeId,
      result
    ) {
      const config =
        getPresentation(
          routeId
        );

      if (!config) {
        return null;
      }

      const items =
        Array.isArray(
          result?.items
        )
          ? result.items
          : [];

      const rows =
        items.map(
          item => {
            const entityId =
              readPath(
                item,
                config.entityIdField
              );

            return Object.freeze({
              entityId:
                entityId ===
                  null ||
                entityId ===
                  undefined
                  ? null
                  : String(
                      entityId
                    ),

              cells:
                mapFields(
                  item,
                  config.listFields
                )
            });
          }
        );

      const hasNextPage =
        typeof result
          ?.nextCursor ===
          "string" &&
        result.nextCursor.length >
          0;

      return Object.freeze({
        routeId:
          config.routeId,

        title:
          config.title,

        singular:
          config.singular,

        headers:
          Object.freeze(
            config.listFields
              .map(
                item =>
                  item.label
              )
          ),

        rows:
          Object.freeze(
            rows
          ),

        hasNextPage
      });
    }

    function extractDetailData(
      routeId,
      result
    ) {
      const config =
        getPresentation(
          routeId
        );

      if (!config) {
        return null;
      }

      if (
        config.detailResultKey
      ) {
        const candidate =
          result?.[
            config.detailResultKey
          ];

        return (
          candidate &&
          typeof candidate ===
            "object" &&
          !Array.isArray(
            candidate
          )
        )
          ? candidate
          : null;
      }

      return (
        result &&
        typeof result ===
          "object" &&
        !Array.isArray(result)
      )
        ? result
        : null;
    }

    function buildDetailViewModel(
      routeId,
      result
    ) {
      const config =
        getPresentation(
          routeId
        );

      if (!config) {
        return null;
      }

      const data =
        extractDetailData(
          routeId,
          result
        );

      if (!data) {
        return null;
      }

      const entityId =
        readPath(
          data,
          config.entityIdField
        );

      return Object.freeze({
        routeId:
          config.routeId,

        title:
          config.singular,

        entityId:
          entityId ===
            null ||
          entityId ===
            undefined
            ? null
            : String(
                entityId
              ),

        fields:
          mapFields(
            data,
            config.detailFields
          )
      });
    }

    function createTextElement(
      document,
      tagName,
      textValue
    ) {
      const element =
        document.createElement(
          tagName
        );

      element.textContent =
        String(
          textValue ?? ""
        );

      return element;
    }

    function button(
      document,
      label,
      handler,
      ariaLabel
    ) {
      const element =
        document.createElement(
          "button"
        );

      element.type =
        "button";

      element.textContent =
        label;

      if (ariaLabel) {
        element.setAttribute(
          "aria-label",
          ariaLabel
        );
      }

      element.addEventListener(
        "click",
        handler
      );

      return element;
    }

    function createOperationalRenderer(
      options = {}
    ) {
      const document =
        options.document;

      const routeRuntime =
        options.routeRuntime;

      if (
        !document ||
        typeof document
          .createElement !==
          "function"
      ) {
        throw new TypeError(
          "Operational renderer requires a document."
        );
      }

      if (
        !routeRuntime ||
        typeof routeRuntime
          .loadDetail !==
          "function" ||
        typeof routeRuntime
          .loadNextPage !==
          "function" ||
        typeof routeRuntime
          .restoreList !==
          "function"
      ) {
        throw new TypeError(
          "Operational renderer requires route interactions."
        );
      }

      function renderList(
        container,
        routeState
      ) {
        const viewModel =
          buildListViewModel(
            routeState.routeId,
            routeState.data
          );

        if (!viewModel) {
          return false;
        }

        const wrapper =
          document.createElement(
            "div"
          );

        wrapper.className =
          "operational-list";

        const heading =
          createTextElement(
            document,
            "h2",
            viewModel.title
          );

        wrapper.appendChild(
          heading
        );

        if (
          viewModel.rows.length ===
          0
        ) {
          wrapper.appendChild(
            createTextElement(
              document,
              "p",
              "Nenhum registro encontrado."
            )
          );

          container.replaceChildren(
            wrapper
          );

          return true;
        }

        const tableRegion =
          document.createElement(
            "div"
          );

        tableRegion.className =
          "operational-table-region";

        tableRegion.setAttribute(
          "tabindex",
          "0"
        );

        tableRegion.setAttribute(
          "aria-label",
          `Tabela de ${viewModel.title}`
        );

        const table =
          document.createElement(
            "table"
          );

        const caption =
          createTextElement(
            document,
            "caption",
            viewModel.title
          );

        table.appendChild(
          caption
        );

        const thead =
          document.createElement(
            "thead"
          );

        const headerRow =
          document.createElement(
            "tr"
          );

        for (
          const header of
          viewModel.headers
        ) {
          const th =
            createTextElement(
              document,
              "th",
              header
            );

          th.setAttribute(
            "scope",
            "col"
          );

          headerRow.appendChild(
            th
          );
        }

        const actionsHeader =
          createTextElement(
            document,
            "th",
            "Acoes"
          );

        actionsHeader.setAttribute(
          "scope",
          "col"
        );

        headerRow.appendChild(
          actionsHeader
        );

        thead.appendChild(
          headerRow
        );

        table.appendChild(
          thead
        );

        const tbody =
          document.createElement(
            "tbody"
          );

        for (
          const row of
          viewModel.rows
        ) {
          const tr =
            document.createElement(
              "tr"
            );

          for (
            const cell of
            row.cells
          ) {
            tr.appendChild(
              createTextElement(
                document,
                "td",
                cell.value
              )
            );
          }

          const actions =
            document.createElement(
              "td"
            );

          const detailButton =
            button(
              document,
              "Ver detalhes",
              () => {
                if (
                  row.entityId
                ) {
                  return routeRuntime
                    .loadDetail(
                      viewModel.routeId,
                      row.entityId
                    );
                }

                return null;
              },
              row.entityId
                ? `Ver detalhes de ${viewModel.singular} ${row.entityId}`
                : `Ver detalhes de ${viewModel.singular}`
            );

          detailButton.disabled =
            !row.entityId;

          actions.appendChild(
            detailButton
          );

          tr.appendChild(
            actions
          );

          tbody.appendChild(
            tr
          );
        }

        table.appendChild(
          tbody
        );

        tableRegion.appendChild(
          table
        );

        wrapper.appendChild(
          tableRegion
        );

        if (
          viewModel.hasNextPage
        ) {
          wrapper.appendChild(
            button(
              document,
              "Carregar mais",
              () =>
                routeRuntime
                  .loadNextPage(
                    viewModel.routeId
                  ),
              `Carregar mais ${viewModel.title}`
            )
          );
        }

        container.replaceChildren(
          wrapper
        );

        return true;
      }

      function renderDetail(
        container,
        routeState
      ) {
        const viewModel =
          buildDetailViewModel(
            routeState.routeId,
            routeState.data
          );

        if (!viewModel) {
          return false;
        }

        const wrapper =
          document.createElement(
            "div"
          );

        wrapper.className =
          "operational-detail";

        wrapper.appendChild(
          createTextElement(
            document,
            "h2",
            viewModel.title
          )
        );

        const details =
          document.createElement(
            "dl"
          );

        for (
          const item of
          viewModel.fields
        ) {
          details.appendChild(
            createTextElement(
              document,
              "dt",
              item.label
            )
          );

          details.appendChild(
            createTextElement(
              document,
              "dd",
              item.value
            )
          );
        }

        wrapper.appendChild(
          details
        );

        wrapper.appendChild(
          button(
            document,
            "Voltar para lista",
            () =>
              routeRuntime
                .restoreList(
                  viewModel.routeId
                ),
            `Voltar para ${getPresentation(viewModel.routeId)?.title || "lista"}`
          )
        );

        container.replaceChildren(
          wrapper
        );

        return true;
      }

      function render(
        container,
        routeState
      ) {
        if (
          !container ||
          typeof container
            .replaceChildren !==
            "function" ||
          !routeState ||
          routeState.state !==
            "route-ready"
        ) {
          return false;
        }

        if (
          routeState.mode ===
          "list"
        ) {
          return renderList(
            container,
            routeState
          );
        }

        if (
          routeState.mode ===
          "detail"
        ) {
          return renderDetail(
            container,
            routeState
          );
        }

        return false;
      }

      return Object.freeze({
        render,
        renderList,
        renderDetail
      });
    }

    return Object.freeze({
      OPERATIONAL_ROUTE_IDS,
      OPERATIONAL_PRESENTATIONS,
      getPresentation,
      readPath,
      formatValue,
      buildListViewModel,
      extractDetailData,
      buildDetailViewModel,
      createOperationalRenderer
    });
  }
);

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

    function filterOption(
      value,
      label
    ) {
      return Object.freeze({
        value:
          String(value),

        label:
          String(label)
      });
    }

    function filterDefinition(
      value
    ) {
      return Object.freeze({
        name:
          value.name,

        label:
          value.label,

        kind:
          value.kind || "text",

        maxLength:
          Number.isSafeInteger(
            value.maxLength
          )
            ? value.maxLength
            : null,

        placeholder:
          value.placeholder || "",

        options:
          Object.freeze([
            ...(value.options || [])
          ])
      });
    }

    const STATUS_OPTIONS =
      Object.freeze([
        filterOption(
          "active",
          "Ativo"
        ),
        filterOption(
          "pending",
          "Pendente"
        ),
        filterOption(
          "suspended",
          "Suspenso"
        ),
        filterOption(
          "inactive",
          "Inativo"
        ),
        filterOption(
          "unknown",
          "Desconhecido"
        )
      ]);

    const BELT_OPTIONS =
      Object.freeze([
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
      ].map(
        belt =>
          filterOption(
            belt,
            belt
          )
      ));

    const OPERATIONAL_FILTER_DEFINITIONS =
      Object.freeze({
        people:
          Object.freeze([
            filterDefinition({
              name:
                "profileType",

              label:
                "Perfil",

              kind:
                "select",

              options: [
                filterOption(
                  "student",
                  "Aluno"
                ),
                filterOption(
                  "instructor",
                  "Instrutor"
                )
              ]
            }),

            filterDefinition({
              name:
                "operationalStatus",

              label:
                "Status",

              kind:
                "select",

              options:
                STATUS_OPTIONS
            })
          ]),

        organizations:
          Object.freeze([
            filterDefinition({
              name:
                "status",

              label:
                "Status",

              kind:
                "select",

              options:
                STATUS_OPTIONS
            }),

            filterDefinition({
              name:
                "nameQuery",

              label:
                "Nome",

              kind:
                "text",

              maxLength:
                80,

              placeholder:
                "Buscar por nome"
            })
          ]),

        courses:
          Object.freeze([
            filterDefinition({
              name:
                "workflowStatus",

              label:
                "Status",

              kind:
                "select",

              options: [
                filterOption(
                  "draft",
                  "Rascunho"
                ),
                filterOption(
                  "review",
                  "Em revisao"
                ),
                filterOption(
                  "published",
                  "Publicado"
                ),
                filterOption(
                  "suspended",
                  "Suspenso"
                ),
                filterOption(
                  "archived",
                  "Arquivado"
                )
              ]
            }),

            filterDefinition({
              name:
                "ownerType",

              label:
                "Tipo de proprietario",

              kind:
                "select",

              options: [
                filterOption(
                  "platform",
                  "Plataforma"
                ),
                filterOption(
                  "user",
                  "Usuario"
                ),
                filterOption(
                  "organization",
                  "Organizacao"
                )
              ]
            }),

            filterDefinition({
              name:
                "visibility",

              label:
                "Visibilidade",

              kind:
                "select",

              options: [
                filterOption(
                  "platform",
                  "Plataforma"
                ),
                filterOption(
                  "organization",
                  "Organizacao"
                ),
                filterOption(
                  "private",
                  "Privado"
                )
              ]
            }),

            filterDefinition({
              name:
                "moderationStatus",

              label:
                "Moderacao",

              kind:
                "select",

              options: [
                filterOption(
                  "processing",
                  "Processando"
                ),
                filterOption(
                  "approved",
                  "Aprovado"
                ),
                filterOption(
                  "needs_changes",
                  "Requer ajustes"
                ),
                filterOption(
                  "manual_review",
                  "Revisao manual"
                ),
                filterOption(
                  "blocked",
                  "Bloqueado"
                )
              ]
            })
          ]),

        exams:
          Object.freeze([
            filterDefinition({
              name:
                "status",

              label:
                "Status",

              kind:
                "select",

              options: [
                filterOption(
                  "draft",
                  "Rascunho"
                ),
                filterOption(
                  "candidates_selected",
                  "Candidatos selecionados"
                ),
                filterOption(
                  "awaiting_payment",
                  "Aguardando pagamento"
                ),
                filterOption(
                  "ready",
                  "Pronta"
                ),
                filterOption(
                  "cancelled",
                  "Cancelada"
                ),
                filterOption(
                  "archived",
                  "Arquivada"
                )
              ]
            }),

            filterDefinition({
              name:
                "organizationId",

              label:
                "ID da organizacao",

              kind:
                "text",

              maxLength:
                128,

              placeholder:
                "organizationId"
            }),

            filterDefinition({
              name:
                "targetBelt",

              label:
                "Faixa",

              kind:
                "select",

              options:
                BELT_OPTIONS
            })
          ]),

        questions:
          Object.freeze([
            filterDefinition({
              name:
                "lifecycleStatus",

              label:
                "Status",

              kind:
                "select",

              options: [
                filterOption(
                  "draft",
                  "Rascunho"
                ),
                filterOption(
                  "pending_review",
                  "Pendente de revisao"
                ),
                filterOption(
                  "approved",
                  "Aprovada"
                ),
                filterOption(
                  "changes_requested",
                  "Ajustes solicitados"
                ),
                filterOption(
                  "archived",
                  "Arquivada"
                )
              ]
            }),

            filterDefinition({
              name:
                "difficulty",

              label:
                "Dificuldade",

              kind:
                "select",

              options: [
                1,
                2,
                3,
                4,
                5
              ].map(
                value =>
                  filterOption(
                    String(value),
                    String(value)
                  )
              )
            }),

            filterDefinition({
              name:
                "category",

              label:
                "Categoria",

              kind:
                "text",

              maxLength:
                120,

              placeholder:
                "Categoria"
            })
          ]),

        certificates:
          Object.freeze([
            filterDefinition({
              name:
                "status",

              label:
                "Status",

              kind:
                "select",

              options: [
                filterOption(
                  "valid",
                  "Valido"
                ),
                filterOption(
                  "revoked",
                  "Revogado"
                )
              ]
            }),

            filterDefinition({
              name:
                "organizationId",

              label:
                "ID da organizacao",

              kind:
                "text",

              maxLength:
                128,

              placeholder:
                "organizationId"
            }),

            filterDefinition({
              name:
                "targetBelt",

              label:
                "Faixa",

              kind:
                "select",

              options:
                BELT_OPTIONS
            })
          ]),

        orders:
          Object.freeze([
            filterDefinition({
              name:
                "productType",

              label:
                "Tipo de produto",

              kind:
                "select",

              options: [
                filterOption(
                  "course",
                  "Curso"
                ),
                filterOption(
                  "belt_exam",
                  "Exame de faixa"
                )
              ]
            }),

            filterDefinition({
              name:
                "orderStatus",

              label:
                "Status do pedido",

              kind:
                "select",

              options: [
                filterOption(
                  "pending_payment",
                  "Aguardando pagamento"
                ),
                filterOption(
                  "paid",
                  "Pago"
                ),
                filterOption(
                  "cancelled",
                  "Cancelado"
                ),
                filterOption(
                  "expired",
                  "Expirado"
                ),
                filterOption(
                  "refunded",
                  "Reembolsado"
                ),
                filterOption(
                  "chargeback",
                  "Chargeback"
                )
              ]
            })
          ])
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

    function getFilterDefinitions(
      routeId
    ) {
      const route =
        String(
          routeId || ""
        ).trim();

      return (
        OPERATIONAL_FILTER_DEFINITIONS[
          route
        ] ||
        Object.freeze([])
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

      function currentFilterValues(
        routeId,
        definitions
      ) {
        const listState =
          typeof routeRuntime
            .getListState ===
            "function"
            ? routeRuntime
                .getListState(
                  routeId
                )
            : null;

        const basePayload =
          listState &&
          typeof listState
            .basePayload ===
            "object" &&
          !Array.isArray(
            listState.basePayload
          )
            ? listState
                .basePayload
            : {};

        const values = {};

        for (
          const definition of
          definitions
        ) {
          if (
            Object.prototype
              .hasOwnProperty.call(
                basePayload,
                definition.name
              ) &&
            basePayload[
              definition.name
            ] !==
              undefined &&
            basePayload[
              definition.name
            ] !==
              null
          ) {
            values[
              definition.name
            ] =
              String(
                basePayload[
                  definition.name
                ]
              );
          }
        }

        return Object.freeze(
          values
        );
      }

      function filterPayload(
        definitions,
        controls
      ) {
        const payload = {};

        for (
          const definition of
          definitions
        ) {
          const control =
            controls.get(
              definition.name
            );

          if (!control) {
            continue;
          }

          const normalized =
            String(
              control.value || ""
            ).trim();

          if (!normalized) {
            continue;
          }

          payload[
            definition.name
          ] =
            normalized;
        }

        return Object.freeze(
          payload
        );
      }

      function createFilterControl(
        definition,
        currentValue,
        routeId
      ) {
        const group =
          document.createElement(
            "div"
          );

        group.className =
          "operational-filter-field";

        const label =
          document.createElement(
            "label"
          );

        const controlId =
          `operational-filter-${routeId}-${definition.name}`;

        label.htmlFor =
          controlId;

        label.textContent =
          definition.label;

        let control;

        if (
          definition.kind ===
          "select"
        ) {
          control =
            document.createElement(
              "select"
            );

          const emptyOption =
            document.createElement(
              "option"
            );

          emptyOption.value = "";
          emptyOption.textContent =
            "Todos";

          control.appendChild(
            emptyOption
          );

          for (
            const item of
            definition.options
          ) {
            const option =
              document.createElement(
                "option"
              );

            option.value =
              item.value;

            option.textContent =
              item.label;

            control.appendChild(
              option
            );
          }
        }
        else {
          control =
            document.createElement(
              "input"
            );

          control.type =
            "text";

          if (
            definition.maxLength
          ) {
            control.maxLength =
              definition.maxLength;
          }

          if (
            definition.placeholder
          ) {
            control.placeholder =
              definition.placeholder;
          }

          control.autocomplete =
            "off";
        }

        control.id =
          controlId;

        control.name =
          definition.name;

        control.value =
          currentValue || "";

        group.appendChild(
          label
        );

        group.appendChild(
          control
        );

        return Object.freeze({
          group,
          control
        });
      }

      function createFilterForm(
        routeId,
        title
      ) {
        const definitions =
          getFilterDefinitions(
            routeId
          );

        if (
          definitions.length ===
          0
        ) {
          return null;
        }

        const form =
          document.createElement(
            "form"
          );

        form.className =
          "operational-filters";

        form.noValidate = true;

        form.setAttribute(
          "aria-label",
          `Filtros de ${title}`
        );

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

        const current =
          currentFilterValues(
            routeId,
            definitions
          );

        const controls =
          new Map();

        for (
          const definition of
          definitions
        ) {
          const created =
            createFilterControl(
              definition,
              current[
                definition.name
              ] || "",
              routeId
            );

          controls.set(
            definition.name,
            created.control
          );

          grid.appendChild(
            created.group
          );
        }

        fieldset.appendChild(
          grid
        );

        form.appendChild(
          fieldset
        );

        const actions =
          document.createElement(
            "div"
          );

        actions.className =
          "operational-filter-actions";

        const canApply =
          typeof routeRuntime
            .applyFilters ===
            "function";

        const apply =
          document.createElement(
            "input"
          );

        apply.type =
          "submit";

        apply.value =
          "Aplicar filtros";

        apply.disabled =
          !canApply;

        apply.setAttribute(
          "aria-label",
          `Aplicar filtros de ${title}`
        );

        const clear =
          document.createElement(
            "input"
          );

        clear.type =
          "button";

        clear.value =
          "Limpar filtros";

        clear.disabled =
          !canApply;

        clear.setAttribute(
          "aria-label",
          `Limpar filtros de ${title}`
        );

        actions.appendChild(
          apply
        );

        actions.appendChild(
          clear
        );

        const activeCount =
          definitions.filter(
            definition =>
              Object.prototype
                .hasOwnProperty.call(
                  current,
                  definition.name
                ) &&
              String(
                current[
                  definition.name
                ] || ""
              ).trim()
          ).length;

        const summary =
          createTextElement(
            document,
            "p",
            `Filtros ativos: ${activeCount}`
          );

        summary.className =
          "operational-filter-summary";

        summary.setAttribute(
          "role",
          "status"
        );

        summary.setAttribute(
          "aria-live",
          "polite"
        );

        form.appendChild(
          actions
        );

        form.appendChild(
          summary
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

            if (!canApply) {
              return false;
            }

            return routeRuntime
              .applyFilters(
                routeId,
                filterPayload(
                  definitions,
                  controls
                )
              );
          }
        );

        clear.addEventListener(
          "click",
          () => {
            for (
              const control of
              controls.values()
            ) {
              control.value = "";
            }

            if (!canApply) {
              return false;
            }

            return routeRuntime
              .applyFilters(
                routeId,
                {}
              );
          }
        );

        return form;
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

        const filterForm =
          createFilterForm(
            viewModel.routeId,
            viewModel.title
          );

        if (filterForm) {
          wrapper.appendChild(
            filterForm
          );
        }

        if (
          viewModel.rows.length ===
          0
        ) {
          const emptyMessage =
            createTextElement(
              document,
              "p",
              "Nenhum registro encontrado."
            );

          emptyMessage.setAttribute(
            "role",
            "status"
          );

          wrapper.appendChild(
            emptyMessage
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
          (
            routeState.state !==
              "route-ready" &&
            routeState.state !==
              "route-empty"
          )
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
      OPERATIONAL_FILTER_DEFINITIONS,
      getPresentation,
      getFilterDefinitions,
      readPath,
      formatValue,
      buildListViewModel,
      extractDetailData,
      buildDetailViewModel,
      createOperationalRenderer
    });
  }
);

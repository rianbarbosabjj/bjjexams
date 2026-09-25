# Marco 8 - RBAC e contratos administrativos

## 1. Objetivo

Este documento transforma o inventario do Gate 8.0B em contrato
arquitetural para o Painel Operacional e o Console.

O Marco 8 deve reutilizar as fontes autoritativas ja existentes e nao
criar um segundo sistema de identidade, papeis ou permissoes.

## 2. Papeis globais canonicos

Fonte:

`functions/src/auth/global-claims.js`

Papeis globais existentes:

- `super_admin`
- `platform_admin`
- `finance_admin`
- `content_admin`
- `support_admin`

Regras:

- `super_admin` possui autoridade global superior;
- role desconhecida falha fechada;
- o frontend nao e fonte autoritativa de role;
- o cliente nao pode enviar uma role e obter permissao por ela;
- claims devem ser resolvidas no backend.

## 3. Papeis organizacionais canonicos

Fonte:

`functions/src/auth/organization-membership.js`

Papeis:

- `owner`
- `manager`
- `instructor`
- `student`

Statuses:

- `pending`
- `active`
- `rejected`
- `suspended`
- `ended`

Regras:

- somente membership ativo pode autorizar operacao organizacional;
- `owner` e `manager` podem administrar a organizacao;
- `instructor` nao e administrador global;
- `student` nao possui autoridade administrativa;
- role organizacional nao pode promover usuario a role global.

## 4. Separacao de autoridade

Papeis globais e papeis organizacionais sao autoridades diferentes.

Exemplos:

- `owner` nao vira `platform_admin`;
- `manager` nao recebe Console global;
- `instructor` nao recebe `ops.read`;
- `student` nao recebe capacidade administrativa;
- `super_admin` nao precisa de membership para provar autoridade global.

## 5. Capabilities do Painel Operacional

- `ops.read`
- `ops.people.read`
- `ops.people.manage`
- `ops.organizations.read`
- `ops.organizations.manage`
- `ops.courses.read`
- `ops.courses.manage`
- `ops.exams.read`
- `ops.exams.manage`
- `ops.questions.read`
- `ops.questions.manage`
- `ops.certificates.read`
- `ops.certificates.manage`
- `ops.orders.read`

## 6. Capabilities do Console

- `console.read`
- `console.finance.read`
- `console.finance.manage`
- `console.splits.read`
- `console.splits.manage`
- `console.webhooks.read`
- `console.webhooks.reprocess`
- `console.audit.read`
- `console.security.read`
- `console.config.read`
- `console.config.manage`
- `console.health.read`

## 7. Matriz inicial

### super_admin

Possui todas as capabilities do Marco 8.

Continua sujeito a:

- validacao de input;
- invariantes financeiras;
- invariantes academicas;
- auditoria;
- idempotencia.

### platform_admin

Pode:

- `ops.read`
- `ops.people.read`
- `ops.people.manage`
- `ops.organizations.read`
- `ops.organizations.manage`
- `ops.courses.read`
- `ops.courses.manage`
- `ops.exams.read`
- `ops.exams.manage`
- `ops.questions.read`
- `ops.questions.manage`
- `ops.certificates.read`
- `ops.certificates.manage`
- `ops.orders.read`
- `console.read`
- `console.finance.read`
- `console.splits.read`
- `console.webhooks.read`
- `console.audit.read`
- `console.security.read`
- `console.config.read`
- `console.config.manage`
- `console.health.read`

Nao recebe mutations financeiras sensiveis por padrao.

### finance_admin

Pode:

- `ops.read`
- `ops.orders.read`
- `console.read`
- `console.finance.read`
- `console.finance.manage`
- `console.splits.read`
- `console.splits.manage`
- `console.webhooks.read`
- `console.webhooks.reprocess`
- `console.audit.read`
- `console.health.read`

Nao administra pessoas, organizacoes ou conteudo.

### content_admin

Pode:

- `ops.read`
- `ops.courses.read`
- `ops.courses.manage`
- `ops.exams.read`
- `ops.exams.manage`
- `ops.questions.read`
- `ops.questions.manage`
- `ops.certificates.read`

Nao recebe acesso financeiro.

### support_admin

Perfil predominantemente read-only.

Pode:

- `ops.read`
- `ops.people.read`
- `ops.organizations.read`
- `ops.courses.read`
- `ops.exams.read`
- `ops.questions.read`
- `ops.certificates.read`
- `ops.orders.read`
- `console.audit.read`
- `console.security.read`
- `console.health.read`

## 8. Bootstrap administrativo

Novo contrato proposto:

`obterContextoAdministrativoV12`

Responsabilidades:

- exigir Firebase Auth;
- ler somente claims autoritativas;
- resolver capabilities no backend;
- retornar contexto sanitizado;
- falhar fechado sem role global reconhecida.

Read model:

`AdminContextView`

Campos permitidos:

- `userId`
- `displayName`
- `globalRoles`
- `capabilities`
- `surfaceAccess`
- `environment`
- `schemaVersion`

Nunca retornar token, senha, secret ou claims brutas.

## 9. Read models

### OperationalPersonView

- `personId`
- `displayName`
- `email`
- `profileType`
- `operationalStatus`
- `memberships`
- `createdAt`
- `updatedAt`

### OperationalOrganizationView

- `organizationId`
- `name`
- `status`
- `membershipCounts`
- `responsibleSummary`
- `createdAt`
- `updatedAt`

### OperationalCourseView

- `courseId`
- `title`
- `ownerType`
- `ownerSummary`
- `visibility`
- `workflowStatus`
- `moderationStatus`
- `enrollmentSummary`

### OperationalExamView

- `sessionId`
- `organizationSummary`
- `targetBelt`
- `scheduledAt`
- `status`
- `registrationCounts`
- `attemptCounts`
- `resultCounts`
- `certificateCounts`

Nunca retornar answer key.

### OperationalQuestionView

- `questionId`
- `statement`
- `options`
- `difficulty`
- `category`
- `lifecycleStatus`
- `authorSummary`
- `createdAt`
- `updatedAt`

### OperationalCertificateView

- `certificateId`
- `status`
- `studentName`
- `organizationName`
- `targetBelt`
- `scoreBps`
- `correctAnswers`
- `totalQuestions`
- `issuedAt`
- `revokedAt`

### OperationalOrderView

- `orderId`
- `productType`
- `productSummary`
- `buyerSummary`
- `paymentStatus`
- `fulfillmentStatus`
- `reversalStatus`
- `reconciliationStatus`
- `createdAt`

### ConsoleWebhookEventView

- `eventId`
- `eventType`
- `processingStatus`
- `attemptCount`
- `orderId`
- `receivedAt`
- `processedAt`
- `lastErrorCode`

### ConsoleAuditEventView

- `eventType`
- `actorUid`
- `actorRole`
- `targetType`
- `targetId`
- `organizationId`
- `requestId`
- `createdAt`
- `metadata`

### ConsoleHealthView

- `environment`
- `version`
- `firestoreStatus`
- `functionsStatus`
- `webhookProcessingStatus`
- `reconciliationStatus`
- `updatedAt`

## 10. Contratos existentes a reutilizar

Cursos:

- `listarCursosAdministraveisV12`
- `criarCursoV12`
- `atualizarCursoV12`
- `alterarStatusCursoV12`
- `solicitarPublicacaoCursoV12`
- `listarExcecoesModeracaoV12`
- `registrarDecisaoModeracaoV12`

Exames:

- `criarSessaoExameFaixaV12`
- `selecionarAlunoExameFaixaV12`
- `listarSessoesExameFaixaV12`
- `obterSessaoExameFaixaV12`
- `iniciarExameOficialV12`
- `finalizarExameOficialV12`

Certificados:

- `revogarCertificadoExameV12`
- `validarCertificadoExamePublicoV12`

Financeiro:

- `obterConfiguracaoFinanceiraV12`
- `atualizarTaxaPadraoFinanceiraV12`
- `salvarRegraFinanceiraCursoV12`
- `listarOperacoesFinanceirasV12`
- `solicitarEstornoIntegralV12`

## 11. Novos contratos propostos

Pessoas:

- `listarPessoasOperacionaisV12`
- `obterPessoaOperacionalV12`
- `suspenderPessoaOperacionalV12`
- `reativarPessoaOperacionalV12`

Organizacoes:

- `listarOrganizacoesOperacionaisV12`
- `obterOrganizacaoOperacionalV12`
- `suspenderOrganizacaoOperacionalV12`
- `reativarOrganizacaoOperacionalV12`

Questoes:

- `listarQuestoesOperacionaisV12`
- `obterQuestaoOperacionalV12`
- `criarQuestaoOperacionalV12`
- `atualizarQuestaoOperacionalV12`
- `moderarQuestaoOperacionalV12`
- `arquivarQuestaoOperacionalV12`

Certificados:

- `listarCertificadosOperacionaisV12`
- `obterCertificadoOperacionalV12`

Pedidos:

- `listarPedidosOperacionaisV12`
- `obterPedidoOperacionalV12`

Webhooks:

- `listarEventosWebhookOperacionaisV12`
- `obterEventoWebhookOperacionalV12`
- `reprocessarEventoWebhookV12`

Auditoria:

- `listarEventosAuditoriaV12`
- `obterEventoAuditoriaV12`

Seguranca e saude:

- `obterResumoSegurancaV12`
- `obterSaudeSistemaV12`

## 12. Commands proibidos

Nao criar:

- `adminUpdateDocument`
- `adminDeleteDocument`
- `adminWriteFirestore`
- `writeAnyDocument`
- `updateAnything`
- `deleteAnything`

O cliente nunca pode fornecer:

- collection arbitraria;
- campo arbitrario de autorizacao;
- role arbitraria como prova de autoridade;
- capability arbitraria como prova de autoridade;
- secret;
- API key;
- webhook token.

## 13. P0 do inventario

Superficies prioritarias detectadas no Gate 8.0B:

- `login.html`
- `painel_admin.html`
- `painel_superadmin.html`

Regra:

1. nao adicionar novas mutations Firestore administrativas;
2. criar command server-side;
3. migrar a UI;
4. testar;
5. somente depois desativar o caminho legado.

## 14. Boundary financeiro

O Console nao cria ledger paralelo.

Nenhum command pode:

- editar ledger arbitrariamente;
- recalcular snapshot historico de split;
- transformar `belt_exam` em `creditos_professor`;
- duplicar fulfillment;
- confiar em provider status enviado pelo frontend.

## 15. Boundary academico

Nenhum command pode:

- expor answer key ao aluno;
- alterar resultado para forcar certificado;
- promover faixa automaticamente na emissao;
- criar certificado canonico na collection legada;
- alterar snapshot imutavel do certificado.

O Marco 7 continua autoritativo para `exam_certificates`.

## 16. Auditoria

Toda mutation administrativa nova deve registrar:

- `eventType`
- `actorUid`
- `actorRole`
- `targetType`
- `targetId`
- `organizationId`
- `requestId`
- `createdAt`
- metadata sanitizada

Ator e timestamp devem vir do backend.

## 17. Producao

Enquanto nao houver gate explicito:

- desenvolvimento local/emulator first;
- staging somente em gate controlado;
- producao permanece bloqueada;
- nenhum endpoint novo remove barreiras staging-only existentes;
- staging nao consulta producao para health checks.

## 18. Proximo gate

O Gate 8.1 deve implementar primeiro:

- policy resolver server-side;
- `obterContextoAdministrativoV12`;
- bootstrap fail-closed;
- shell separado entre Painel Operacional e Console.

Nenhuma mutation de dominio deve ser adicionada antes dessa fundacao.

# Marco 8 - Exames, Banco de Questoes e Certificados

## 1. Objetivo

Este documento fecha as decisoes arquiteturais do Gate 8.4 antes da
implementacao do Painel Operacional para:

- Exames;
- Banco de Questoes;
- Certificados.

As decisoes deste gate preservam os dominios academicos homologados nos
Marcos 5.7, 6 e 7.

Producao permanece bloqueada.

## 2. Fontes canonicas existentes

Exames oficiais continuam usando exclusivamente:

- `exam_templates`;
- `exam_sessions`;
- `exam_registrations`;
- `exam_attempts`;
- `exam_results`;
- `exam_certificates`.

Nenhuma dessas collections deve ser duplicada pelo Marco 8.

O fluxo academico existente permanece autoritativo para:

- selecao;
- pagamento;
- autorizacao;
- inicio;
- retomada;
- finalizacao;
- resultado;
- emissao de certificado;
- revogacao de certificado.

## 3. Painel Operacional de Exames

### 3.1 Necessidade

Os read models atuais de exames atendem aluno e instrutor e usam
membership organizacional.

O Painel Operacional precisa de leitura administrativa global,
autorizada por capability global.

### 3.2 Contratos

Novos contratos:

- `listarExamesOperacionaisV12`;
- `obterExameOperacionalV12`.

Capability:

- `ops.exams.read`.

Perfis com leitura conforme matriz global:

- `super_admin`;
- `platform_admin`;
- `content_admin`;
- `support_admin`.

`finance_admin` nao recebe `ops.exams.read`.

Role organizacional isolada nao concede acesso global.

### 3.3 OperationalExamView

Campos top-level:

- `sessionId`;
- `organizationSummary`;
- `targetBelt`;
- `scheduledAt`;
- `status`;
- `registrationCounts`;
- `attemptCounts`;
- `resultCounts`;
- `certificateCounts`.

Nunca retornar:

- answer key;
- `correctAnswer`;
- respostas do aluno;
- payload financeiro;
- providerPaymentId;
- secrets;
- tokens.

### 3.4 Contadores

Os summaries de contagem usam os statuses canonicos existentes.

`registrationCounts`:

- `total`;
- `selected`;
- `awaitingPayment`;
- `authorized`;
- `started`;
- `submitted`;
- `passed`;
- `failed`;
- `certified`;
- `cancelled`;
- `needsReconciliation`.

`attemptCounts`:

- `total`;
- `inProgress`;
- `submitted`;
- `invalidated`.

`resultCounts`:

- `total`;
- `passed`;
- `failed`.

`certificateCounts`:

- `total`;
- `valid`;
- `revoked`.

A listagem pode retornar somente `total` para cada summary quando isso
for necessario para controlar custo.

O detalhe pode expandir `byStatus`.

Nao escanear colecoes inteiras para gerar contadores.

Preferir aggregation queries server-side e paginacao pequena.

## 4. Banco de Questoes

### 4.1 Problema arquitetural

Atualmente nao existe uma collection canonica independente de Banco de
Questoes no dominio novo.

Existem:

1. legado `questoes`, usado como banco global editavel;
2. legado `questoes_exames`, ligado a `cursos_teoricos`;
3. snapshots imutaveis em
   `exam_templates/{templateId}/versions/{versionId}/questions/{snapshotId}`.

Snapshots de prova nao podem virar documentos editaveis do Banco de
Questoes.

## 5. Fonte autoritativa do Banco de Questoes

Nova collection canonica de autoria:

`exam_question_bank`

Essa collection e fonte de autoria e moderacao.

Ela nao substitui e nao duplica o snapshot imutavel de uma prova.

Documento base:

- `questionVersion`;
- `statement`;
- `options`;
- `correctAnswer`;
- `difficulty`;
- `category`;
- `media`;
- `lifecycleStatus`;
- `authorId`;
- `createdAt`;
- `updatedAt`;
- `revision`;
- `moderatedAt`;
- `moderatedBy`;
- `moderationReason`;
- `archivedAt`;
- `archivedBy`.

`correctAnswer` e dado privilegiado.

## 6. Lifecycle do Banco de Questoes

Statuses canonicos:

- `draft`;
- `pending_review`;
- `approved`;
- `changes_requested`;
- `archived`.

Transicoes:

- `draft` -> `draft`;
- `draft` -> `pending_review`;
- `draft` -> `archived`;

- `pending_review` -> `pending_review`;
- `pending_review` -> `approved`;
- `pending_review` -> `changes_requested`;
- `pending_review` -> `archived`;

- `changes_requested` -> `changes_requested`;
- `changes_requested` -> `pending_review`;
- `changes_requested` -> `archived`;

- edicao de conteudo de questao `approved` deve retirar a versao editada
  do estado aprovado e retornar para `pending_review`;

- `approved` -> `archived`;

- `archived` -> `archived`.

Nao existe delete fisico como operacao administrativa normal.

## 7. Views do Banco de Questoes

### 7.1 OperationalQuestionView

Read model sanitizado para `ops.questions.read`.

Campos:

- `questionId`;
- `statement`;
- `options`;
- `difficulty`;
- `category`;
- `lifecycleStatus`;
- `authorSummary`;
- `createdAt`;
- `updatedAt`.

Nunca inclui `correctAnswer`.

Isso permite que `support_admin` tenha leitura operacional sem receber
answer key.

### 7.2 OperationalQuestionAuthoringView

Read model exclusivo de `ops.questions.manage`.

Inclui os campos de `OperationalQuestionView` e:

- `correctAnswer`;
- `revision`;
- `moderationSummary`.

Esse e o unico read model administrativo que pode expor o gabarito do
Banco de Questoes.

Nao deve ser reutilizado pelo aluno, instrutor ou read-only support.

## 8. Contratos do Banco de Questoes

Leitura sanitizada:

- `listarQuestoesOperacionaisV12`;
- `obterQuestaoOperacionalV12`.

Leitura de autoria:

- `obterQuestaoEdicaoOperacionalV12`.

Mutations:

- `criarQuestaoOperacionalV12`;
- `atualizarQuestaoOperacionalV12`;
- `moderarQuestaoOperacionalV12`;
- `arquivarQuestaoOperacionalV12`;
- `importarQuestoesOperacionaisV12`.

Capabilities:

- leitura sanitizada: `ops.questions.read`;
- autoria e mutations: `ops.questions.manage`.

O cliente nunca fornece:

- actor role;
- capability como prova de autorizacao;
- collection;
- target arbitrario;
- audit actor;
- timestamp autoritativo.

## 9. Importacao em lote

`importarQuestoesOperacionaisV12` deve:

- possuir limite maximo de itens por chamada;
- validar todos os itens server-side;
- retornar erros por item de forma sanitizada;
- nao aceitar collection arbitraria;
- nao aceitar status `approved` enviado pelo cliente como bypass;
- registrar auditoria;
- evitar transacao Firestore acima dos limites da plataforma.

Importacao nao significa publicacao automatica.

## 10. Integracao Banco de Questoes -> template oficial

O Banco de Questoes e fonte de autoria.

A prova executavel continua baseada em snapshot imutavel.

Ao montar uma nova versao oficial a partir do banco, o backend deve:

1. receber IDs de questoes autorizados;
2. carregar documentos de `exam_question_bank`;
3. exigir `lifecycleStatus = approved`;
4. validar conteudo server-side;
5. copiar os dados para snapshots imutaveis da versao;
6. gravar `sourceQuestionId = questionId`;
7. manter `correctAnswer` somente no backend;
8. nunca alterar snapshots de versoes ja criadas.

Historicos existentes nao precisam receber backfill automatico.

## 11. Migracao do legado

### `questoes`

E a principal fonte legada candidata a migracao controlada para
`exam_question_bank`.

Mapeamento conceitual:

- `pergunta` -> `statement`;
- `alternativas` -> `options`;
- `resposta_correta` -> `correctAnswer`;
- `dificuldade` -> `difficulty`;
- `categoria` -> `category`;
- `criado_por_uid` -> `authorId`.

Status legado deve ser convertido explicitamente:

- `pendente` -> `pending_review`;
- `aprovada` -> `approved`;
- `reprovada` -> `changes_requested`.

Migracao nao ocorre automaticamente neste gate.

### `questoes_exames`

Nao e fonte canonica do novo Banco de Questoes.

Essa collection esta ligada ao legado `cursos_teoricos`.

Nao realizar migracao 1:1 para `exam_question_bank` sem analise de
deduplicacao e procedencia.

## 12. Certificados

Fonte exclusiva:

`exam_certificates`

Nao criar collection paralela.

Novos contratos read-only:

- `listarCertificadosOperacionaisV12`;
- `obterCertificadoOperacionalV12`.

Capability:

- `ops.certificates.read`.

Revogacao continua reutilizando:

- `revogarCertificadoExameV12`.

A verificacao publica continua reutilizando:

- `validarCertificadoExamePublicoV12`.

A emissao do aluno continua reutilizando:

- `emitirMeuCertificadoExameV12`.

Nenhuma nova logica de emissao sera criada pelo Marco 8.

## 13. OperationalCertificateView

Campos:

- `certificateId`;
- `status`;
- `studentName`;
- `organizationName`;
- `targetBelt`;
- `scoreBps`;
- `correctCount`;
- `totalQuestions`;
- `issuedAt`;
- `revokedAt`.

O nome canonico e `correctCount`.

Nao criar alias persistido `correctAnswers`.

## 14. Seguranca do answer key

`correctAnswer` pode existir somente em:

- `exam_question_bank`, acessivel por command/read model manage-only;
- snapshots server-side de versoes oficiais.

Nao pode aparecer em:

- `OperationalQuestionView`;
- `OperationalExamView`;
- read model de aluno;
- read model de support-only;
- resultado publico;
- certificado publico.

## 15. Auditoria

Toda mutation nova deve registrar no backend:

- ator;
- role resolvida;
- action/event type;
- target;
- requestId;
- timestamp;
- metadata sanitizada.

Nunca auditar:

- answer key;
- respostas integrais do aluno;
- token;
- secret;
- API key;
- CPF completo.

## 16. Runtime boundary

Todos os novos contratos deste gate permanecem:

- staging/demo-emulator only;
- indisponiveis em producao;
- sem secrets financeiros;
- sem dependencia de provider financeiro.

## 17. Sequencia de implementacao

### 8.4A

Arquitetura e contratos.

### 8.4B

Operational Exam read model e read service.

### 8.4C

Operational Exam callables.

### 8.4D

Fundacao canonica `exam_question_bank`.

### 8.4E

Question read models e commands.

### 8.4F

Operational Certificate reads.

### 8.4G

Integracao e regressao local.

### 8.4H

Staging controlado.

Nenhum passo deste documento autoriza deploy em producao.

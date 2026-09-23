# Marco 8 â€” Painel Operacional e Console

## 1. Objetivo

Consolidar as operaÃ§Ãµes administrativas do BJJ Exams v1.2 em duas superfÃ­cies claramente separadas.

### Painel Operacional

- Pessoas
- OrganizaÃ§Ãµes
- Cursos
- Exames
- Banco de QuestÃµes
- Certificados
- Pedidos

### Console

- Financeiro
- Splits
- Webhooks
- Auditoria
- SeguranÃ§a
- ConfiguraÃ§Ãµes
- SaÃºde

O Marco 8 nÃ£o deve apenas reorganizar telas existentes.

O objetivo arquitetural Ã© substituir operaÃ§Ãµes administrativas privilegiadas executadas diretamente pelo browser por contratos server-side autenticados, autorizados, sanitizados, observÃ¡veis e auditÃ¡veis.

---

## 2. PrincÃ­pios obrigatÃ³rios

### 2.1 Backend como autoridade

OperaÃ§Ãµes privilegiadas nÃ£o podem depender de escrita direta do browser em collections administrativas ou canÃ´nicas.

O frontend deve consumir:

- callables server-side;
- read models sanitizados;
- commands especÃ­ficos por caso de uso;
- respostas contendo apenas os dados necessÃ¡rios para a tela.

### 2.2 Deny by default

Toda nova superfÃ­cie administrativa deve:

- exigir autenticaÃ§Ã£o;
- validar papel e capacidade no backend;
- validar vÃ­nculo organizacional quando aplicÃ¡vel;
- falhar fechado quando a autorizaÃ§Ã£o nÃ£o puder ser comprovada;
- nÃ£o confiar em papel enviado pelo frontend;
- nÃ£o confiar em IDs internos fornecidos pelo cliente sem validaÃ§Ã£o.

### 2.3 SeparaÃ§Ã£o Painel Operacional x Console

O Painel Operacional atende a operaÃ§Ã£o cotidiana do produto.

O Console atende governanÃ§a, financeiro, seguranÃ§a, observabilidade e configuraÃ§Ã£o sistÃªmica.

Acesso ao Painel Operacional nÃ£o implica automaticamente acesso ao Console.

### 2.4 ReutilizaÃ§Ã£o dos domÃ­nios canÃ´nicos

Marco 8 deve reutilizar os domÃ­nios jÃ¡ homologados.

NÃ£o criar modelos paralelos para:

- cursos;
- orders;
- ledger;
- splits;
- exames;
- registrations;
- attempts;
- results;
- certificates;
- memberships;
- organizations.

### 2.5 Sem regressÃ£o dos Marcos anteriores

O Marco 8 nÃ£o pode alterar silenciosamente:

- workflow de cursos;
- entitlement;
- regras financeiras;
- snapshots de split;
- fulfillment;
- reversal;
- webhook idempotency;
- exames oficiais;
- resultados;
- certificados;
- barreiras staging-only.

### 2.6 ProduÃ§Ã£o continua bloqueada

Todo Marco 8 deve permanecer:

1. local/emulator primeiro;
2. staging somente apÃ³s gates explÃ­citos;
3. produÃ§Ã£o proibida;
4. sem secrets de produÃ§Ã£o;
5. sem ativaÃ§Ã£o implÃ­cita dos mÃ³dulos staging-only em produÃ§Ã£o.

---

## 3. Estado legado relevante

Existe interface administrativa anterior com funcionalidades como:

- gestÃ£o de alunos;
- gestÃ£o de professores;
- aprovaÃ§Ãµes;
- banco de questÃµes;
- montagem de exames;
- autorizaÃ§Ã£o de provas;
- ediÃ§Ã£o administrativa.

Parte dessa interface ainda executa operaÃ§Ãµes Firestore diretamente no browser.

Exemplos a inventariar:

- getDocs;
- addDoc;
- updateDoc;
- deleteDoc;
- setDoc;
- queries diretas;
- ediÃ§Ã£o de usuÃ¡rio;
- ediÃ§Ã£o de questÃ£o;
- exclusÃ£o fÃ­sica;
- aprovaÃ§Ã£o ou moderaÃ§Ã£o diretamente pela UI.

Essas operaÃ§Ãµes sÃ£o legado de migraÃ§Ã£o.

Nenhuma nova funcionalidade do Marco 8 deve ampliar esse padrÃ£o.

---

## 4. Arquitetura alvo

```text
Painel Operacional / Console
            |
            v
Frontend API Clients v1.2
            |
            v
Firebase Callable Functions
            |
            +--> Authentication
            +--> Authorization / RBAC
            +--> Input validation
            +--> Domain / Service layer
            +--> Audit
            |
            v
Firestore / Providers
```

O frontend deve conhecer somente contratos pÃºblicos da API.

O backend deve validar autenticaÃ§Ã£o, autorizaÃ§Ã£o, input, carregar entidades autoritativas, executar domÃ­nio, persistir mudanÃ§as, registrar auditoria e sanitizar erros.

---

## 5. Read models administrativos

As telas nÃ£o devem receber documentos Firestore crus.

Read models iniciais:

- OperationalPersonView
- OperationalOrganizationView
- OperationalCourseView
- OperationalExamSessionView
- OperationalCertificateView
- OperationalOrderView
- ConsoleFinancialSummaryView
- ConsoleWebhookEventView
- ConsoleAuditEventView
- ConsoleHealthView

Campos sensÃ­veis nÃ£o necessÃ¡rios devem ser omitidos.

---

## 6. Commands administrativos

Evitar endpoints genÃ©ricos como:

- adminUpdateDocument
- adminDeleteDocument
- writeFirestore
- updateAnything

Preferir contratos especÃ­ficos por intenÃ§Ã£o, por exemplo:

- suspenderPessoa
- reativarPessoa
- atualizarPerfilOperacionalPessoa
- aprovarOrganizacao
- suspenderOrganizacao
- moderarQuestao
- arquivarQuestao
- revogarCertificado
- reprocessarWebhook
- resolverReconciliacao
- atualizarConfiguracaoFinanceira

Cada command deve possuir:

- schema de input;
- autorizaÃ§Ã£o prÃ³pria;
- invariantes prÃ³prias;
- resultado sanitizado;
- auditoria;
- tratamento de retry quando necessÃ¡rio.

---

## 7. Escopo â€” Painel Operacional

### 7.1 Pessoas

- busca paginada;
- filtros;
- perfil;
- status;
- memberships;
- detalhes sanitizados;
- aÃ§Ãµes controladas;
- auditoria.

NÃ£o utilizar exclusÃ£o fÃ­sica de usuÃ¡rio como operaÃ§Ã£o padrÃ£o.

### 7.2 OrganizaÃ§Ãµes

- listagem;
- busca;
- detalhes;
- status;
- memberships;
- responsÃ¡veis;
- aÃ§Ãµes administrativas autorizadas;
- auditoria.

### 7.3 Cursos

Reutilizar contratos canÃ´nicos existentes.

- visualizar cursos;
- filtrar por workflow;
- visualizar proprietÃ¡rio;
- visualizar escopo plataforma/organizaÃ§Ã£o;
- acompanhar moderaÃ§Ã£o;
- acompanhar informaÃ§Ãµes operacionais de matrÃ­cula.

### 7.4 Exames

Reutilizar os domÃ­nios dos Marcos 5.7, 6 e 7.

- sessions;
- registrations;
- attempts;
- results;
- certificates.

NÃ£o expor:

- gabarito;
- answer keys;
- payload financeiro interno;
- providerPaymentId.

### 7.5 Banco de QuestÃµes

Migrar operaÃ§Ãµes legadas para backend.

OperaÃ§Ãµes alvo:

- listar;
- pesquisar;
- criar;
- editar;
- moderar;
- arquivar;
- importar lote validado.

Delete fÃ­sico deve ser evitado.

Toda mutation deve registrar ator, timestamp, aÃ§Ã£o, target e metadata sanitizada.

### 7.6 Certificados

Reutilizar exclusivamente exam_certificates.

- consultar;
- localizar;
- visualizar status;
- visualizar snapshot pÃºblico;
- revogar quando autorizado.

NÃ£o criar coleÃ§Ã£o paralela nem nova lÃ³gica de emissÃ£o.

### 7.7 Pedidos

Consolidar:

- course orders;
- belt_exam orders;
- payment state;
- fulfillment state;
- reversal state;
- reconciliation state.

---

## 8. Escopo â€” Console

### 8.1 Financeiro

Reutilizar serviÃ§os financeiros canÃ´nicos.

Expor:

- pedidos;
- recebimentos;
- reversÃµes;
- chargebacks;
- reconciliaÃ§Ãµes;
- agregaÃ§Ãµes;
- indicadores operacionais.

NÃ£o permitir ediÃ§Ã£o arbitrÃ¡ria do ledger.

### 8.2 Splits

- visualizar regra padrÃ£o;
- visualizar overrides;
- visualizar snapshot aplicado;
- acompanhar destinatÃ¡rios;
- acompanhar divergÃªncias.

AlteraÃ§Ã£o de regra somente via backend.

### 8.3 Webhooks

- lista de eventos;
- provider event ID sanitizado;
- tipo;
- horÃ¡rio;
- processamento;
- pedido relacionado;
- tentativas;
- falhas;
- resultado.

Reprocessamento deve ser explÃ­cito, autorizado, idempotente e auditado.

### 8.4 Auditoria

Campos recomendados:

- eventType;
- actorUid;
- actorRole;
- targetType;
- targetId;
- organizationId;
- createdAt;
- requestId;
- metadata sanitizada.

Nunca registrar senha, ID token, bearer token, secret, API key, CPF completo ou payload sensÃ­vel integral.

### 8.5 SeguranÃ§a

Inicialmente read-only.

Expor somente informaÃ§Ãµes sanitizadas:

- ambiente;
- runtime;
- versÃµes;
- gates ativos;
- configuraÃ§Ãµes pÃºblicas de seguranÃ§a;
- contadores de falhas;
- alertas operacionais.

### 8.6 ConfiguraÃ§Ãµes

ConfiguraÃ§Ãµes mutÃ¡veis devem possuir schema, versÃ£o, validaÃ§Ã£o server-side, ator, timestamp e histÃ³rico quando necessÃ¡rio.

### 8.7 SaÃºde

ConsoleHealthView deve observar de forma segura:

- ambiente;
- Firestore;
- Functions;
- provider permitido;
- processamento de webhook;
- filas;
- reconciliaÃ§Ãµes;
- versÃ£o implantada;
- incidentes operacionais.

Staging nÃ£o pode consultar produÃ§Ã£o.

---

## 9. RBAC

Capacidades iniciais propostas:

### Painel Operacional

- ops.read
- ops.people.read
- ops.people.manage
- ops.organizations.read
- ops.organizations.manage
- ops.courses.read
- ops.courses.manage
- ops.exams.read
- ops.exams.manage
- ops.questions.read
- ops.questions.manage
- ops.certificates.read
- ops.certificates.manage
- ops.orders.read

### Console

- console.read
- console.finance.read
- console.finance.manage
- console.splits.read
- console.splits.manage
- console.webhooks.read
- console.webhooks.reprocess
- console.audit.read
- console.security.read
- console.config.read
- console.config.manage
- console.health.read

O cliente nÃ£o pode enviar uma capability arbitrÃ¡ria e obter autorizaÃ§Ã£o por ela.

---

## 10. Auditoria

Toda mutation administrativa relevante deve produzir audit event.

Exemplos:

- pessoa suspensa;
- pessoa reativada;
- organizaÃ§Ã£o alterada;
- questÃ£o criada;
- questÃ£o moderada;
- questÃ£o arquivada;
- certificado revogado;
- configuraÃ§Ã£o financeira alterada;
- webhook reprocessado;
- reconciliaÃ§Ã£o resolvida.

Audit event deve ser append-only do ponto de vista do browser.

---

## 11. PaginaÃ§Ã£o

Listagens administrativas devem usar:

- limite mÃ¡ximo;
- cursor;
- ordenaÃ§Ã£o determinÃ­stica;
- filtros allow-listed.

Evitar offset pagination para collections grandes.

---

## 12. Busca

Nunca permitir que o cliente envie:

- nome arbitrÃ¡rio de collection;
- nome arbitrÃ¡rio de campo;
- operador Firestore arbitrÃ¡rio.

Campos pesquisÃ¡veis devem estar em allow-list server-side.

---

## 13. OperaÃ§Ãµes destrutivas

AÃ§Ãµes de alto impacto devem exigir:

- autorizaÃ§Ã£o;
- confirmaÃ§Ã£o de intenÃ§Ã£o no frontend;
- revalidaÃ§Ã£o no backend;
- audit event;
- idempotÃªncia quando aplicÃ¡vel.

Preferir lifecycle/status em vez de delete fÃ­sico.

---

## 14. Observabilidade

Logs devem distinguir:

- authentication failure;
- authorization failure;
- validation failure;
- not found;
- domain conflict;
- provider failure;
- unexpected failure.

NÃ£o registrar dados sensÃ­veis.

---

## 15. EstratÃ©gia de implementaÃ§Ã£o

### Gate 8.0 â€” Arquitetura e inventÃ¡rio

#### 8.0A
- criar branch;
- documentar arquitetura alvo;
- separar Painel Operacional e Console;
- registrar requisitos de seguranÃ§a.

#### 8.0B
Inventariar:
- pÃ¡ginas administrativas;
- mÃ³dulos JS administrativos;
- Firestore direto no browser;
- callables existentes;
- collections acessadas;
- mutations diretas;
- endpoints administrativos;
- cÃ³digo legado a encapsular/remover.

#### 8.0C
Definir:
- matriz RBAC;
- read models;
- commands;
- superfÃ­cie de API;
- boundaries;
- testes iniciais.

### Gate 8.1 â€” Shell administrativo

- runtime;
- environment resolution;
- autenticaÃ§Ã£o;
- bootstrap fail-closed;
- navigation shell;
- separaÃ§Ã£o Ops x Console;
- nenhuma mutation de domÃ­nio ainda.

### Gate 8.2 â€” Pessoas e OrganizaÃ§Ãµes

- read models;
- paginaÃ§Ã£o;
- filtros;
- details;
- commands;
- auditoria;
- testes RBAC.

### Gate 8.3 â€” Cursos

- course operational read model;
- moderaÃ§Ã£o;
- workflow;
- owner;
- visibility;
- enrollment summary.

### Gate 8.4 â€” Exames, QuestÃµes e Certificados

- sessÃµes;
- registrations;
- results;
- certificates;
- question bank;
- mutations server-side;
- migraÃ§Ã£o das operaÃ§Ãµes legadas privilegiadas.

### Gate 8.5 â€” Pedidos e Financeiro

- unified order read model;
- course + belt_exam;
- fulfillment;
- reversals;
- reconciliation;
- finance summaries;
- split snapshots.

### Gate 8.6 â€” Webhooks, Auditoria, SeguranÃ§a, Config e SaÃºde

- webhook operational view;
- reprocessamento controlado;
- audit explorer;
- security view;
- configuration view;
- health view.

### Gate 8.7 â€” Frontend integrado

- responsividade;
- empty states;
- loading;
- errors;
- paginaÃ§Ã£o;
- filtros;
- confirmaÃ§Ã£o;
- accessibility bÃ¡sica;
- contracts de frontend.

Nenhuma operaÃ§Ã£o Firestore privilegiada direta nas novas superfÃ­cies.

### Gate 8.8 â€” Staging

1. preflight;
2. deploy seletivo;
3. smoke read-only;
4. smoke RBAC;
5. negative auth tests;
6. mutations controladas;
7. audit validation;
8. cleanup;
9. regressÃ£o Marcos anteriores.

ProduÃ§Ã£o continua proibida.

### Gate 8.9 â€” Release candidate

- regressÃ£o;
- diff review;
- security boundaries;
- staging homologado;
- worktree limpa;
- branch atualizada com develop.

PR e merge somente apÃ³s autorizaÃ§Ã£o explÃ­cita.

---

## 16. EstratÃ©gia de testes

### UnitÃ¡rios

- schemas;
- validaÃ§Ã£o;
- RBAC;
- capabilities;
- paginaÃ§Ã£o;
- cursor;
- sanitizaÃ§Ã£o;
- lifecycle;
- audit building.

### Emulator

- Firestore Rules;
- ownership;
- organization membership;
- administrative roles;
- mutations;
- audit;
- idempotÃªncia;
- negative permissions.

### Frontend contract

- ambiente;
- auth;
- allow-list de callables;
- payload mÃ­nimo;
- parsing;
- production blocks;
- ausÃªncia de Firestore privilegiado direto.

### Staging

- read-only primeiro;
- mutation controlada depois;
- cleanup obrigatÃ³rio;
- nenhum acesso Ã  produÃ§Ã£o.

---

## 17. MigraÃ§Ã£o gradual do painel legado

1. inventariar funcionalidade;
2. implementar contrato server-side;
3. implementar nova UI;
4. homologar em staging;
5. desabilitar caminho privilegiado legado equivalente;
6. manter compatibilidade somente onde necessÃ¡ria;
7. remover cÃ³digo legado em gate posterior controlado.

NÃ£o fazer big-bang rewrite.

---

## 18. Compatibilidade

Marco 8 nÃ£o deve exigir migraÃ§Ã£o destrutiva dos dados jÃ¡ homologados.

Quando necessÃ¡rio novo campo:

- preferir opcional inicialmente;
- suportar documentos existentes;
- definir backfill separado;
- nÃ£o misturar migraÃ§Ã£o massiva com UI feature.

---

## 19. SeguranÃ§a de ambiente

Toda API nova deve seguir:

- projeto explicitamente resolvido;
- staging sem credenciais de produÃ§Ã£o;
- production gate explÃ­cito;
- emulator identificado;
- fail closed em ambiente ambÃ­guo.

Nenhuma nova Function pode remover barreiras existentes dos mÃ³dulos de exames ou financeiro.

---

## 20. NÃ£o escopo do Marco 8

- App Check completo;
- rate limiting global;
- CSP final;
- threat review final;
- testes de carga finais;
- backup/restore final;
- ativaÃ§Ã£o geral em produÃ§Ã£o;
- go-live.

Esses itens permanecem nos Marcos 9 e 10.

---

## 21. CritÃ©rios de conclusÃ£o

O Marco 8 sÃ³ poderÃ¡ ser concluÃ­do quando:

1. Painel Operacional e Console estiverem separados por responsabilidade.
2. OperaÃ§Ãµes privilegiadas relevantes nÃ£o dependerem de escrita Firestore direta pelo browser.
3. RBAC administrativo for validado no backend.
4. Read models administrativos forem sanitizados.
5. Listagens relevantes forem paginadas.
6. AÃ§Ãµes administrativas forem auditÃ¡veis.
7. Financeiro reutilizar o domÃ­nio canÃ´nico.
8. NÃ£o existir ledger financeiro paralelo.
9. Exames reutilizarem o domÃ­nio canÃ´nico.
10. Certificados reutilizarem exam_certificates.
11. Banco de QuestÃµes estiver encapsulado por contratos server-side.
12. Staging estiver homologado.
13. RegressÃµes dos Marcos 4 a 7 estiverem verdes.
14. ProduÃ§Ã£o continuar bloqueada.
15. Release candidate estiver pronto para PR.
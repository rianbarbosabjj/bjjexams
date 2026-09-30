# Marco 8.6A — Console operacional: Webhooks, Auditoria, Segurança, Configuração e Saúde

## 1. Objetivo

O Gate 8.6A fixa a arquitetura das superfícies restantes do Console Operacional do Marco 8 antes de qualquer nova implementação.

O escopo deste documento é exclusivamente:

- Webhooks operacionais;
- reprocessamento controlado de Webhooks;
- explorador de Auditoria;
- visão de Segurança;
- visão de Configuração;
- visão de Saúde operacional.

Este gate não cria UI, não implanta Functions, não lê dados reais de staging e não autoriza produção.

## 2. Princípios obrigatórios

1. Reutilizar fontes canônicas existentes.
2. Não criar ledger financeiro, ledger de Webhooks ou ledger de auditoria paralelo.
3. Toda leitura administrativa nova passa por backend autorizado e retorna read model sanitizado.
4. Toda mutação administrativa relevante produz auditoria append-only.
5. Autenticação e autorização são avaliadas antes da validação de filtros ou payload do cliente.
6. O cliente nunca escolhe collection, field, operator, capability ou role.
7. Paginação é limitada, determinística e baseada em cursor opaco.
8. Segredos, tokens, dados bancários, CPF completo e payload bruto de provider nunca são retornados ao browser.
9. Produção permanece fora do runtime administrativo do Marco 8.
10. Configuração financeira e splits permanecem no domínio financeiro canônico existente e não são duplicados neste gate.

## 3. Fontes canônicas

### 3.1 Webhooks

A fonte canônica de eventos financeiros permanece:

`payment_webhook_events`

O documento canônico existente preserva a projeção sanitizada necessária ao processamento e à investigação operacional.

Não criar:

- `admin_webhook_events`;
- `webhook_events_v2`;
- `operational_webhooks`;
- cópia de payload bruto do provider.

### 3.2 Auditoria

A fonte canônica de auditoria permanece:

`audit_logs`

A coleção já é escrita server-side por fluxos administrativos e financeiros existentes.

Não criar:

- `admin_audit_events`;
- `audit_logs_v2`;
- `operational_audit_logs`;
- ledger de auditoria paralelo.

O Console deverá adaptar esquemas históricos compatíveis para um read model único sem reescrever eventos antigos.

### 3.3 Financeiro e reconciliação

Indicadores de reconciliação devem reutilizar fontes canônicas existentes, incluindo quando aplicável:

- `financial_reversal_requests`;
- `orders`;
- `payment_transactions`;
- `exam_registrations`.

Nenhuma visão de Saúde pode originar um segundo estado financeiro.

### 3.4 Ambiente e runtime

A classificação de ambiente deve reutilizar:

`functions/src/config/environment.js`

O Console nunca consulta produção para compor uma visão de staging ou demo/emulator.

## 4. RBAC

As capacidades já definidas em `admin-access-policy.js` são a autoridade do Console.

### 4.1 Webhooks

Leitura:

`console.webhooks.read`

Papéis globais autorizados:

- `super_admin`;
- `platform_admin`;
- `finance_admin`.

Reprocessamento:

`console.webhooks.reprocess`

Papéis globais autorizados:

- `super_admin`;
- `finance_admin`.

`platform_admin` não recebe reprocessamento por implicação.

### 4.2 Auditoria

Leitura:

`console.audit.read`

Papéis globais autorizados:

- `super_admin`;
- `platform_admin`;
- `finance_admin`;
- `support_admin`.

### 4.3 Segurança

Leitura:

`console.security.read`

Papéis globais autorizados:

- `super_admin`;
- `platform_admin`;
- `support_admin`.

### 4.4 Configuração

Leitura:

`console.config.read`

Papéis globais autorizados:

- `super_admin`;
- `platform_admin`.

A capacidade existente `console.config.manage` permanece reservada. O Gate 8.6 não cria uma store genérica de configuração e não expõe mutação arbitrária.

### 4.5 Saúde

Leitura:

`console.health.read`

Papéis globais autorizados:

- `super_admin`;
- `platform_admin`;
- `finance_admin`;
- `support_admin`.

Papéis organizacionais nunca elevam acesso global ao Console.

## 5. WebhookOperationalView

A projeção operacional de Webhook deve possuir exatamente os seguintes campos de topo:

1. `eventId`
2. `provider`
3. `providerEventRef`
4. `eventType`
5. `status`
6. `relatedOrderId`
7. `deliveryCount`
8. `processing`
9. `timestamps`

### 5.1 `providerEventRef`

O identificador bruto do evento do provider não é retornado.

`providerEventRef` é uma referência mascarada determinística suficiente para investigação visual, por exemplo:

`***abc123`

A implementação deve limitar tamanho e nunca permitir reconstrução do valor original a partir da resposta.

### 5.2 `processing`

Campos exatos:

- `action`
- `result`
- `errorCode`

`result` é derivado do estado canônico e não contém payload do provider.

### 5.3 `timestamps`

Campos exatos:

- `receivedAt`
- `lastReceivedAt`
- `processedAt`

### 5.4 Campos proibidos na saída

A view nunca expõe:

- `providerPaymentId`;
- `providerCustomerId`;
- `externalReference`;
- `billingType`;
- `valueCents`;
- `authToken`;
- API key;
- webhook secret;
- payload bruto;
- wallet;
- recipient shares;
- snapshot financeiro;
- CPF.

## 6. Contratos de leitura de Webhooks

### 6.1 Listagem

Callable:

`listarWebhooksOperacionaisV12`

Capability:

`console.webhooks.read`

Payload permitido:

- `limit`
- `cursor`
- `status`
- `eventType`
- `orderId`

Limites:

- default `20`;
- máximo `25`.

Ordenação determinística:

- `receivedAt DESC`;
- desempate por document ID.

Cursor:

- opaco;
- versionado;
- contém somente dados mínimos necessários à retomada da paginação.

Filtros são allowlisted. O cliente nunca fornece nome de collection, field ou operator.

### 6.2 Detalhe

Callable:

`obterWebhookOperacionalV12`

Capability:

`console.webhooks.read`

Payload permitido:

- `eventId`

A resposta continua limitada ao `WebhookOperationalView`.

## 7. Reprocessamento controlado

Callable:

`reprocessarWebhookOperacionalV12`

Capability:

`console.webhooks.reprocess`

Payload permitido:

- `eventId`
- `requestId`

### 7.1 Ordem de validação

A função deve:

1. exigir `auth.uid`;
2. exigir claims válidas;
3. exigir `console.webhooks.reprocess`;
4. somente então validar `eventId` e `requestId`.

O cliente não pode enviar role, capability, status desejado, provider, collection ou ação interna.

### 7.2 Elegibilidade

A primeira versão aceita reprocessamento somente de evento canônico em:

`status=error`

Não reprocessar:

- `processed`;
- `ignored`;
- evento `received` que possa estar em processamento;
- evento inexistente;
- evento com identidade canônica inconsistente.

### 7.3 Idempotência

O próprio `payment_webhook_events/{eventId}` mantém metadados operacionais de comando:

- `reprocessCount`;
- `lastReprocessRequestId`;
- `lastReprocessRequestedBy`;
- `lastReprocessRequestedAt`.

O mesmo `requestId` para o mesmo evento não inicia um segundo reprocessamento.

Não criar collection paralela apenas para idempotência deste comando.

### 7.4 Execução

O reprocessamento deve reutilizar a mesma orquestração canônica usada por `processarWebhookPagamentoV12`.

A implementação poderá refatorar o worker atual para extrair um roteador/processador compartilhado, sem alterar o significado do fluxo normal de Webhook.

Fluxo:

1. transação Firestore relê e valida o evento;
2. registra auditoria append-only da solicitação;
3. registra metadados de reprocessamento no evento;
4. reposiciona o evento de forma controlada para processamento;
5. invoca o processador canônico compartilhado;
6. em sucesso, o estado canônico converge normalmente;
7. em falha, não pode deixar estado intermediário silencioso;
8. falha retryable deve permanecer observável e apta a nova tentativa explícita;
9. nenhuma mutação financeira é feita fora dos serviços canônicos.

Quando o processador canônico precisar consultar o provider, ele usa somente o provider factory já existente e seus bindings server-side.

### 7.5 Auditoria do reprocessamento

A solicitação gera evento em `audit_logs` com `eventType` normalizado equivalente a:

`admin.webhook.reprocess.requested`

A auditoria registra somente metadados sanitizados, incluindo o status anterior e `errorCode` seguro quando existente.

Nunca registrar segredo ou payload bruto.

## 8. AuditOperationalView

O Console lê exclusivamente `audit_logs`.

Não há migração destrutiva obrigatória dos logs existentes.

O adapter de leitura deve aceitar aliases históricos já usados:

- `action` -> `eventType`;
- `actorId` -> `actorUid`;
- `entityType` -> `targetType`;
- `entityId` -> `targetId`.

Novos eventos administrativos devem preferir o contrato normalizado, preservando compatibilidade de leitura.

### 8.1 Campos exatos

1. `auditId`
2. `eventType`
3. `actor`
4. `target`
5. `organizationId`
6. `source`
7. `requestId`
8. `createdAt`
9. `metadata`

`actor`:

- `uid`
- `role`

`target`:

- `type`
- `id`

### 8.2 Sanitização

`before` e `after` históricos nunca são devolvidos crus pelo explorador.

`metadata` é uma projeção allowlisted, rasa e limitada em tamanho.

Nunca retornar:

- password;
- ID token;
- bearer token;
- API key;
- webhook secret;
- wallet;
- dados bancários;
- CPF completo;
- payload bruto;
- conteúdo integral sensível de questões;
- snapshots financeiros completos.

### 8.3 Listagem

Callable:

`listarAuditoriaOperacionalV12`

Capability:

`console.audit.read`

Payload permitido:

- `limit`
- `cursor`
- `eventType`
- `actorUid`
- `targetType`
- `targetId`
- `organizationId`

Limites:

- default `20`;
- máximo `25`.

Ordenação:

- `createdAt DESC`;
- desempate por document ID.

O explorador é read-only e append-only do ponto de vista administrativo.

## 9. SecurityOperationalView

Callable:

`obterSegurancaOperacionalV12`

Capability:

`console.security.read`

A view é read-only e expõe somente fatos seguros derivados do runtime:

- classificação do ambiente;
- região da Function;
- major runtime Node;
- estado do gate administrativo;
- estado do gate de provider;
- presença lógica de bindings exigidos sem valor do secret;
- proteções estruturais relevantes;
- alertas operacionais sanitizados quando houver fonte canônica.

Não retornar:

- valores de secrets;
- environment variables sensíveis;
- tokens;
- credenciais;
- detalhes de projeto de produção;
- política IAM bruta.

Se uma métrica não possuir fonte confiável, retornar `null` ou `unsupported`. Nunca fabricar contador.

## 10. ConfigOperationalView

Callable:

`obterConfiguracaoOperacionalV12`

Capability:

`console.config.read`

A primeira versão é read-only.

Pode expor somente configuração operacional segura e estática/derivada, por exemplo:

- região;
- classificação de ambiente financeiro;
- provider suportado;
- limites operacionais públicos do Console;
- versão do contrato;
- estado de features explicitamente não sensíveis.

Não duplicar:

- taxa financeira padrão;
- recipient accounts;
- wallets;
- regras de split;
- overrides financeiros.

Esses dados permanecem nas superfícies financeiras canônicas.

Não criar `config_console`, `admin_config` ou store genérica de configuração no Gate 8.6.

Qualquer futura mutação usando `console.config.manage` exige schema explícito, versionamento, validação server-side, ator, timestamp e auditoria.

## 11. HealthOperationalView

Callable:

`obterSaudeOperacionalV12`

Capability:

`console.health.read`

A view deve ser composta sem consultar produção.

Pode observar de forma segura:

- classificação do ambiente;
- conectividade Firestore;
- runtime/revision disponível;
- estado lógico das Functions do Console;
- provider permitido no ambiente;
- agregados de Webhooks por estado;
- agregados de reconciliação;
- incidentes operacionais derivados de estados canônicos.

A primeira versão não realiza ping autenticado ao Asaas apenas para preencher Health.

`provider` deve representar configuração/permitido no ambiente, e não alegar saúde externa não medida.

Consultas devem ser limitadas ou agregadas. Nunca varrer coleções inteiras no cliente.

## 12. Boundaries de Firestore

As coleções administrativas canônicas permanecem fechadas ao browser.

Em especial:

- `payment_webhook_events`: sem leitura/escrita direta do cliente;
- `audit_logs`: sem leitura/escrita direta do cliente;
- coleções financeiras canônicas: sem leitura/escrita administrativa direta do cliente.

As novas superfícies usam Admin SDK somente atrás de callable autorizada.

## 13. Runtime e produção

As Functions administrativas do 8.6 devem seguir o mesmo gate de runtime do Marco 8:

- staging real: permitido;
- projeto `demo-*` com emuladores explícitos: permitido;
- produção `bjj-exams`: indisponível.

Read services de Webhooks, Auditoria, Segurança, Configuração e Saúde não recebem secrets de provider.

Somente a mutação de reprocessamento pode receber bindings já existentes quando a orquestração canônica efetivamente exigir acesso ao provider.

Nenhum passo deste documento autoriza deploy em produção.

## 14. Sequência de implementação

### 8.6A

Arquitetura, fontes canônicas, RBAC, contratos e boundaries.

### 8.6B

Webhook operational read model, serviço read-only e callables de lista/detalhe.

### 8.6C

Reprocessamento controlado, refatoração mínima do processador compartilhado e auditoria do comando.

### 8.6D

Audit adapter/read model e explorador de `audit_logs`, preservando eventos existentes.

### 8.6E

Views read-only de Segurança, Configuração e Saúde.

### 8.6F

Integração e regressão local de todas as superfícies do 8.6.

O staging amplo e a homologação cruzada permanecem no Gate oficial 8.8.

## 15. Etapas oficiais restantes do Marco 8

Após o 8.6:

### 8.7 — Frontend integrado

- responsividade;
- loading;
- empty states;
- erros;
- paginação;
- filtros;
- confirmações;
- acessibilidade básica;
- contratos frontend;
- nenhuma nova leitura privilegiada direta do Firestore.

### 8.8 — Homologação geral em staging

- preflight;
- deploy seletivo;
- smoke read-only;
- smoke RBAC;
- testes negativos de autenticação;
- mutações controladas;
- validação de auditoria;
- cleanup;
- regressão dos Marcos anteriores.

Produção permanece proibida.

### 8.9 — Release candidate

- regressão;
- revisão de diff;
- revisão de boundaries de segurança;
- staging aprovado;
- worktree limpa;
- branch atualizada com `develop`;
- PR/merge somente após autorização explícita.

## 16. Critério de conclusão do 8.6A

O gate está concluído quando:

- este documento estiver versionado;
- o teste arquitetural validar as fontes canônicas;
- nenhuma collection paralela tiver sido criada;
- as capacidades RBAC existentes forem preservadas;
- os contratos de read models e callables estiverem definidos;
- reprocessamento estiver restrito e auditável;
- Segurança, Configuração e Saúde estiverem explicitamente sanitizadas;
- produção permanecer fora do escopo.

# Marco 8.7 — Frontend administrativo integrado

## Objetivo
Integrar ao `admin_shell_v1_2.html` as superfícies backend dos Gates 8.2–8.6 sem transferir autoridade de domínio ao browser.

## Invariantes
- local/emulator e staging somente; produção continua bloqueada antes do carregamento da configuração Firebase;
- `obterContextoAdministrativoV12` continua sendo o único contrato de bootstrap, com ID token e payload vazio;
- roles e capabilities vêm somente do backend;
- nenhuma nova superfície pode usar diretamente `getFirestore`, `collection`, `getDoc`, `getDocs`, `setDoc`, `addDoc`, `updateDoc`, `deleteDoc` ou `onSnapshot`;
- nenhuma API administrativa genérica, collection arbitrária, campo Firestore arbitrário ou operador arbitrário;
- autorização frontend serve apenas para navegação/affordance; backend continua autoritativo;
- sem secrets, provider tokens, ledger paralelo ou configuração paralela.

## Rotas canônicas
| Rota | Superfície | Capability de leitura |
| --- | --- | --- |
| people | operations | `ops.people.read` |
| organizations | operations | `ops.organizations.read` |
| courses | operations | `ops.courses.read` |
| exams | operations | `ops.exams.read` |
| questions | operations | `ops.questions.read` |
| certificates | operations | `ops.certificates.read` |
| orders | operations | `ops.orders.read` |
| finance | console | `console.finance.read` |
| splits | console | `console.splits.read` |
| webhooks | console | `console.webhooks.read` |
| audit | console | `console.audit.read` |
| security | console | `console.security.read` |
| configuration | console | `console.config.read` |
| health | console | `console.health.read` |

São exatamente 14 rotas. A rota só aparece quando a superfície e a capability específica estiverem presentes no contexto server-side.

## Arquitetura alvo
```text
admin_shell_v1_2.html
  -> firebase-runtime-v1_2.js
  -> admin-shell-api-v1_2.js
  -> admin-shell-navigation-v1_2.js
  -> admin-shell-route-runtime-v1_2.js
  -> admin-shell-controller-v1_2.js
  -> admin-shell-bootstrap-v1_2.js
       -> route loader
       -> callable allow-listed
       -> read model sanitizado
       -> safe DOM renderer
```

`admin-shell-route-runtime-v1_2.js` coordenará loaders, paginação, filtros, actions e descarte de respostas obsoletas. Não conterá regras de domínio.

## API client
O bootstrap permanece separado e restrito a `obterContextoAdministrativoV12` com payload vazio.

Chamadas de rota deverão:
- usar registry estático de callables;
- exigir ID token;
- resolver URL somente pelo ambiente autorizado;
- aceitar somente payload objeto e campos previstos;
- nunca aceitar capability, role, projectId ou environment como mecanismo de autorização;
- sanitizar erros antes da camada visual.

## Route registry
Cada rota terá contrato estático com `routeId`, `surface`, `readCapability`, `loader`, `renderer`, filtros, paginação e actions suportadas.

Rotas ainda não integradas renderizam `route-not-integrated`; não fazem fallback para Firestore.

## Estados de conteúdo
O shell global mantém loading/ready/denied/error. Dentro de ready:
- `route-loading`;
- `route-ready`;
- `route-empty`;
- `route-error`;
- `route-not-integrated`.

Erro de autorização backend nunca vira empty state.

## Concorrência
Navegação e filtros usam `latest-request-wins`. Resposta antiga nunca sobrescreve rota atual e nenhum resultado sobrevive à troca de usuário autenticado.

## Paginação e filtros
- cursor opaco do backend;
- sem offset;
- browser não interpreta cursor;
- filtros são allow-listed por rota;
- alterar filtro reseta cursor;
- sem builder genérico de query;
- paginação concorrente duplicada é bloqueada.

## Actions e confirmação
Action só aparece quando existe capability de mutation e callable específica já homologada.

Ação de impacto exige confirmação explícita, justificativa quando requerida, `requestId` quando o backend usar idempotência, sucesso confirmado pelo backend e refresh posterior. Não há sucesso otimista para mutation administrativa de alto impacto.

Configuration permanece read-only até existir schema server-side explícito; `console.config.manage` não cria mutation genérica.

## Renderização segura e acessibilidade
Renderers usam `textContent`, `createElement`, `replaceChildren` e atributos explícitos, nunca `innerHTML` com dados.

Requisitos básicos:
- headings hierárquicos;
- labels;
- botões reais;
- loading/empty/error identificáveis;
- região `aria-live`;
- foco previsível;
- teclado;
- tabelas com overflow controlado ou cards responsivos;
- actions não dependem de hover.

## Observabilidade frontend
Pode registrar apenas routeId, operation, error code sanitizado, callable status sanitizado e timestamp local. Nunca token, secret, API key, CPF completo, payload bruto de webhook ou snapshot financeiro completo.

## Sequência 8.7
### 8.7A — Arquitetura e contratos
Este documento + teste arquitetural; nenhum runtime alterado.

### 8.7B — Foundation de route runtime
API client allow-listed, route registry, route runtime, content host, cinco estados de rota e stale-response protection.

### 8.7C — Painel Operacional
people, organizations, courses, exams, questions, certificates e orders; pode ser subdividido sem mudar este contrato.

### 8.7D — Finance e Splits
Somente domínios financeiros canônicos e actions já homologadas.

### 8.7E — Webhooks e Audit
Lista/detalhe webhook, reprocessamento controlado e audit explorer.

### 8.7F — Security, Configuration e Health
Read-only; unsupported/unavailable explícitos; sem provider ping; sem mutation genérica.

### 8.7G — Regressão frontend consolidada
14 rotas, RBAC visual, paginação, filtros, loading/empty/error, confirmations, acessibilidade, responsividade, no direct Firestore e production blocked.

## Critérios de saída
- 14 rotas cobertas;
- loaders apenas por callables allow-listed;
- paginação por cursores opacos;
- filtros allow-listed;
- mutations somente com capability e contrato específico;
- confirmação para impacto;
- stale responses bloqueadas;
- DOM seguro;
- acessibilidade básica;
- produção bloqueada;
- regressão 8.1–8.6 verde.

## Fora de escopo
Produção, deploy de produção, Firestore privilegiado direto, provider health ping, mutation genérica de configuração, ledger/audit paralelo, framework frontend novo e redesign completo.

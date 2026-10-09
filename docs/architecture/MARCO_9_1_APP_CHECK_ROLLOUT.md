# Marco 9 — Gate 9.1A: inventário e compatibilidade App Check

**Estado: INVENTORY_ONLY / NO_ENFORCEMENT / NO_DEPLOY.** Esta entrega não configura a chave do reCAPTCHA, não registra apps no App Check e não implanta Firebase Functions.

## Base e objetivo

- Base confirmada: `develop-v1.2` em `757e9fce192fa642bafd67c03ed34945e22c7076` (PR #22 integrado).
- Projetos: staging `bjj-exams-staging`; produção `bjj-exams` **proibida** neste gate.
- Node 22; Functions v2; provider Asaas exclusivamente Sandbox em testes futuros autorizados.
- Objetivo: localizar transportes, identificar pontos que precisam de token no cliente e registrar exclusões antes de habilitar enforcement.

## Achados verificáveis no repositório

| Superfície | Evidência de código | Posição atual | Tratamento futuro |
| --- | --- | --- | --- |
| Legado da v1.2 | `functions/index.js` exporta callables v2 e `asaasWebhook` HTTP | Mistura de chamadas de navegador e callback do provedor | Revisão por endpoint antes de habilitar proteção |
| Callables modulares | `functions/main.js` compõe fábricas em `functions/src/` | Endpoints com permissões distintas, inclusive leitura pública e operações administrativas | Matriz de segurança por função e modo observação antes de enforcement |
| Cursos públicos | `functions/src/courses/course-public-functions.js`, `js/course-public-api-v1_2.js` | `onCall` servido via `fetch()` HTTP direto | Incluir token App Check no header do adaptador HTTP, preservando navegação anônima |
| Compras/cursos | `functions/src/finance/financial-checkout-functions.js`, `js/course-purchase-api-v1_2.js` | `onCall` servido via `fetch()` com Firebase ID token | App Check adicional à Auth, sem mudar idempotência, autorização, checkout ou Asaas |
| Exames oficiais | `functions/src/exams/exam-attempt-functions.js`, `js/belt-exam-api-v1_2.js` | `onCall` de aluno autenticado e sessão | App Check adicional ao Auth; não expor questões/gabarito; manter reuso de tentativas |
| Console administrativo | `functions/src/admin/admin-context-functions.js`, `js/admin-shell-route-api-v1_2.js` | `onCall` com RBAC + HTTP direto | App Check adicional ao RBAC, sem confiar no cliente |
| Webhooks Asaas | `functions/src/finance/financial-webhook-functions.js` e `functions/index.js` | `onRequest`, fluxo serviço-a-serviço | **Excluir do enforcement baseado em token de navegador.** Preservar verificação do token de webhook e idempotência |

### Limites de descoberta

`scripts/inventory-app-check-v1_2.js` faz inspeção estática de `functions/index.js` e módulos JavaScript em `functions/src/`, identificando candidatos `onCall(` e `onRequest(` e quatro adaptadores HTTP do frontend. Ele não carrega módulos, não chama Firebase/Asaas e não altera arquivos. Uma definição pode não estar exportada em determinado ambiente; expressões construídas dinamicamente podem precisar de revisão manual. Números do relatório são **candidatos de código**, não endpoints implantados, nem contagem de solicitações reais.

Cada candidato começa com `authClassification=requires-manual-verification`. O scanner não infere se um endpoint é público apenas pelo nome e não classifica definitivamente papéis e trust boundaries sem revisão.

## Conclusões de segurança

1. O SDK Firebase Functions pode enviar App Check automaticamente quando a callable é invocada pelo SDK oficial, mas os clientes deste projeto executam chamadas diretas via HTTP. Por isso os adaptadores precisam anexar `X-Firebase-AppCheck` explicitamente quando o cliente estiver inicializado, antes de qualquer enforcement.
2. `Authorization: Bearer <Firebase ID token>` e App Check são fatores distintos: nenhum substitui Auth, RBAC, verificações de vínculo, idempotência ou assinatura/token de webhook.
3. Callables públicas (catálogo, validação pública) não podem depender de login; App Check não é autorização de usuário.
4. Webhooks HTTP de terceiros não têm token reCAPTCHA do navegador; aplicar `enforceAppCheck` indiscriminado nos ingressos do Asaas causa interrupção.
5. Sem chave de site registrada, SDK do App Check inicializado com renovação e inventário dos clientes, forçar `enforceAppCheck: true` bloquearia chamadas legítimas. **Não fazer isso neste gate.**
6. App Check isoladamente não fornece proteção completa contra abuso nem resolve replay; proteção de replay com `consumeAppCheckToken` é opcional, pode aumentar latência/custo e requer avaliação posterior por rota.

## Gates de rollout

### 9.1A — Inventário e testes (este PR)

- Scanner sem I/O de rede, geração de relatório reproduzível e teste de contrato.
- CI 133/133 permanece; novo teste não faz deploy e detecta ativação prematura de enforcement.
- Runtime, Functions e clientes permanecem intocados.

### 9.1B — Preparação do cliente (PR específico)

- Registrar app web de **staging** no App Check e obter public site key apropriada para o reCAPTCHA Enterprise (chave pública, nunca segredo).
- Inicializar App Check uma vez no bootstrap do browser de staging com atualização automática de tokens; suporte a debug apenas em ambiente local autorizado.
- Instrumentar adaptadores HTTP diretos com header `X-Firebase-AppCheck` quando há token; com status explícito de falha de obtenção, sem envio de dado sigiloso e sem atribuir automaticamente status de autenticado.
- Criar testes para visitante anônimo, login de aluno, professor/admin e função financeira; preservar bloqueios de produção.

### 9.1C — Telemetria em staging sem enforcement

- Homologar app web, cadastro no Firebase App Check e cobertura de clientes em `bjj-exams-staging`, sem credenciais de produção.
- Monitorar `VALID`, `MISSING`, `INVALID` em logs de verificação de callables conforme documentação oficial, com métricas agregadas e sem tokens nos logs.
- Validar tráfego legítimo (catálogo, login, compra Sandbox, exame, certificados, console), incluindo browser antigo, revogação e período de atualização do token.

### 9.1D — Enforcement gradual por allowlist

- Fazer deploy seletivo **somente após gate explícito de homologação em staging**, para poucas callables elegíveis e com rollback.
- Negativos: token ausente, inválido, expirado; positivos: token válido e permissões RBAC corretas; ausência de `X-Firebase-AppCheck` deve ser tratada sem vazar dados.
- Nunca habilitar `enforceAppCheck: true` em ingressos HTTP de webhooks, nem automaticamente em todas as Functions legadas.
- Seguir com outras rotas somente após métricas saudáveis e aprovação do gate anterior.

## Critérios para fechar 9.1A

- PR com apenas scanner, documentação, teste e CI; sem alteração de runtime dos produtos.
- CI executa a regressão 133/133, hosting e contrato 9.0A, além de contrato 9.1A.
- Nenhum segredo, deploy, operação de provider, escrita Firestore ou mudança na produção.
- App Check enforcement permanece desabilitado até 9.1D.

## Referências externas oficiais

- https://firebase.google.com/docs/app-check/cloud-functions
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-check/monitor-functions-metrics

## Próximo gate

9.1B — Preparação do cliente; **não** confundir este inventário com a ativação de App Check.

## Gate 9.1B1 — Ponte de tokens no frontend (implementada em branch, sem SDK ativo)

- `js/firebase-runtime-v1_2.js` expõe `registerStagingAppCheckTokenProvider(provider, options)` e `getAppCheckHeaders(options)`; a função fornecedora deve retornar string ou `{ token }` obtido pelo SDK Firebase App Check do **mesmo projeto staging**.
- Cinco adaptadores HTTP (`course-public`, `course-purchase`, `belt-exam`, `admin-shell`, `admin-shell-route`) consultam a ponte antes de `fetch()`, preservam `Authorization`/corpo da callable e anexam `X-Firebase-AppCheck` apenas se houver token válido.
- No estado atual a ponte não registra provedores automaticamente. Ausência, token vazio/inválido ou indisponibilidade do SDK retornam `{}`: comportamento existente é preservado porque o backend ainda não exige App Check. Em produção o helper nunca requisita nem anexa token.
- Não colocar token no corpo, query string, URL, armazenamento de longa duração ou logs. O SDK gerencia cache e renovação; o helper não persiste tokens.
- Os fluxos HTTP `onRequest` do Asaas permanecem inalterados e autenticados pelos controles próprios.
- Sem alterações em Cloud Functions, regras Firestore, Hosting, firebase.json ou serviços externos.
- Testes: `tests/marco9-app-check-client-bridge-v1_2.test.js` exercita 6 chamadas em 5 adaptadores, com token/sem token/erro, Auth e bloqueios de produção.

### Ativação pendente — etapa 9.1B2

1. No console do projeto **`bjj-exams-staging`**, cadastrar o app web e a site key de reCAPTCHA Enterprise, com domínios de staging autorizados; nunca registrar localhost na chave destinada à produção.
2. Nas páginas staging, inicializar `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })` usando o mesmo `FirebaseApp` criado no bootstrap; depois registrar `() => getToken(appCheck)` na ponte (API modular do Firebase).
3. Cobrir todos os entrypoints e páginas que invocam callables, inclusive landing, catálogo, login, alunos, professor e admin, antes da política de enforcement.
4. Homologar envio do header em staging com usuários anônimos/autenticados, browsers reais e chamadas financeiras somente Asaas Sandbox; medir `MISSING` e `INVALID` antes de ligar enforcement.
5. Executar rollout em ambiente controlado e documentar rollback antes de um único `enforceAppCheck: true`.

**Gate 9.1B1 `BRIDGE_ONLY` não representa 9.1B2, telemetria 9.1C ou enforcement 9.1D concluídos.**

## Gate 9.1B2 — Bootstrap opt-in do SDK no frontend

- O runtime `js/firebase-runtime-v1_2.js` disponibiliza `initializeStagingAppCheck(app)` e `initializeStagingAppCheckFromConfig()`. Os pontos de entrada de login, alunos, professores, cursos, exame, catálogo e console chamam uma dessas rotinas antes de invocar suas callables.
- O App Check **só inicializa** quando existe a chave **pública** reCAPTCHA Enterprise fornecida por `window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__` no host de staging ou pela opção explícita `siteKey` em ambiente de teste; nenhum valor real está no repositório.
- Em modo configurado, usa a mesma `FirebaseApp` de `bjj-exams-staging`, SDK Firebase JS `10.8.0` (`firebase-app-check.js`), `ReCaptchaEnterpriseProvider` e `isTokenAutoRefreshEnabled: true`; `getToken(instance)` alimenta a ponte `X-Firebase-AppCheck` implementada no Gate 9.1B1.
- Sem chave pública: retorna `not_configured` e não importa SDK adicional, não faz chamada de rede para App Check e não altera o comportamento anterior. Não existe `enforceAppCheck: true` no backend.
- Em hostname oficial de produção ou app Firebase de projeto diferente: retorna `production_blocked` ou `wrong_firebase_app`, sem inicializar o SDK. Erros do SDK são sanitizados e não bloqueiam chamadas existentes nesta etapa sem enforcement.
- A inicialização repetida para a mesma aplicação reutiliza a mesma promessa. Nenhum token é registrado em console, `localStorage`, URL, body ou payload do banco.
- `onRequest` dos webhooks Asaas permanece fora desse mecanismo; a autenticação externa e a idempotência existentes são preservadas.
- Teste sem serviços externos: `tests/marco9-app-check-sdk-staging-v1_2.test.js` verifica SDK injetado, inicialização única, auto-refresh, uso do mesmo app, domínios staging/produção e cobertura das sete páginas.

### Configuração externa pendente para utilização real em staging

1. **No projeto Firebase `bjj-exams-staging`**, localizar o app web correto e registrar App Check com reCAPTCHA Enterprise. Criar uma chave Web score-based no Google Cloud do mesmo projeto, incluindo os domínios `bjj-exams-staging.web.app` e `bjj-exams-staging.firebaseapp.com`. Conferir autorização de domínios e quotas.
2. Disponibilizar a site key **pública** à página de staging via `window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__` **antes** da primeira inicialização do Firebase. Essa publicação/configuração não é feita neste PR, porque não há chave registrada ou autorização de deploy.
3. Confirmar o uso do mesmo FirebaseApp para Auth/Functions e App Check nas páginas, e coletar métricas agregadas de tokens aceitos/ausentes/inválidos com dados de teste.
4. Fazer smoke real em `bjj-exams-staging` **com autorização de deploy específico** antes de qualquer enforcement; não tocar em `bjj-exams` (produção).

**Evidência atual:** SDK wiring e testes de contrato prontos; chave site pública ainda ausente, SDK não foi executado contra serviços reais e App Check não está ativo no site publicado. O Gate 9.1C de telemetria e o Gate 9.1D de enforcement continuam pendentes.

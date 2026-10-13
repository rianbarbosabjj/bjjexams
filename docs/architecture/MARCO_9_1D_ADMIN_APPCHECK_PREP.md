# Marco 9 — preparação isolada de enforcement App Check administrativo

**Estado: SOURCE_PREPARED_ONLY / NO_DEPLOY / NO_MERGE / NO_GO.**

Este documento descreve uma mudança proposta na branch `feature/marco9-admin-appcheck-enforcement-prep`, não uma
alteração no Firebase implantado. A base é `develop-v1.2` no commit
`356c3c00bcfd81f06d76773fadea332b69589196`. A homologação vigente continua sem enforcement confirmado.

## Objetivo e allowlist exata

Adicionar `enforceAppCheck: true` como opção de `onCall` **somente** a
quatro funções já observadas no staging:

| Callable | Código | Evidência prévia |
|---|---|---|
| `obterContextoAdministrativoV12` | `admin-context-functions.js` | POST 200 do administrador, 403 do professor |
| `listarPessoasOperacionaisV12` | `admin-people-read-functions.js` | POST 200 de administrador |
| `listarOrganizacoesOperacionaisV12` | `admin-organizations-read-functions.js` | POST 200 de administrador |
| `listarCursosOperacionaisV12` | `admin-courses-read-functions.js` | POST 200 de administrador |

As três rotas de detalhe `obterPessoaOperacionalV12`,
`obterOrganizacaoOperacionalV12` e `obterCursoOperacionalV12` **não**
entram no primeiro lote. Exigem avaliação de tráfego própria.

## Limites mantidos

- Os módulos administrativos já são compostos pelo `functions/main.js`
  apenas quando `firebaseProjectId === "bjj-exams-staging"` ou no
  emulador de demonstração expressamente permitido. Confirmar novamente
  esse limite e os exports antes de qualquer deploy seletivo.
- Nenhuma mudança de Auth, claims, RBAC, Firestore, HMAC, TTL, rate limits,
  cobrança ou validação dos webhooks Asaas.
- Os `onRequest` do Asaas e os fluxos públicos, professor e aluno ficam
  fora desta proposta.
- `enforceAppCheck: true` **não** substitui autenticação Firebase,
  autorização RBAC nem revogação de ID tokens.
- App Check token do navegador exposto anteriormente não é invalidado por
  revogar sessões Firebase Auth.

## Testes automatizados antes de deploy

1. `node tests/marco9-admin-appcheck-enforcement-prep-v1_2.test.js`:
   quatro registros `onCall`, allowlist exata, três detalhes não
   cobertos, fronteira staging, cliente com ponte App Check e Asaas intacto.
2. `node tests/marco9-app-check-inventory-v1_2.test.js`:
   scanner legado atualizado para tolerar **apenas** os quatro módulos
   em preparação, recusando ativação acidental em qualquer outro módulo.
3. Contratos existentes Marco 8 de contexto, pessoas, organizações e
   cursos verificam a lógica de autenticação e de capacidades.
4. Testes existentes da ponte App Check do cliente cobrem envio de header,
   token ausente e falha de aquisição no navegador.

Esses testes são **offline** e **não provam** que o SDK Firebase Functions
validará/rejeitará tokens reais. Não registrar `VALID`, `MISSING` ou
`INVALID` como PASS de backend nesta etapa.

## Matriz obrigatória de homologação futura

Após autorização **separada** de deploy seletivo em `bjj-exams-staging`,
com contas sintéticas e sem coletar tokens nos logs:

| Cenário | Resultado esperado |
|---|---|
| Admin válido + App Check válido | HTTP 200, resposta autorizada |
| Admin válido + token App Check ausente | Rejeição pela camada App Check |
| Admin válido + token App Check inválido/expirado | Rejeição pela camada App Check |
| Professor válido + App Check válido | Bloqueio RBAC (HTTP 403) |
| Sem Firebase Auth + App Check válido | Bloqueio de autenticação |
| Admin válido + App Check válido em Pessoas/Organizações/Cursos | HTTP 200 nos três destinos |
| Rotas de detalhe não incluídas no lote | Sem mudança de política |
| Webhook Asaas externo | Sem mudança de política; autenticação própria preservada |

**Não compartilhar** cabeçalhos Authorization ou X-Firebase-AppCheck;
registrar apenas status/código agregados. Validar presença da site key
pública em staging, compatibilidade do browser, latência, renovação e
telemetria antes de habilitar cada endpoint.

## Baseline operacional lida em 13/10/2026 (sem mudanças na nuvem)

Auditoria `BASELINE_AUDIT=PASS` no projeto `bjj-exams-staging`,
região `southamerica-east1`, com `gcloud functions describe` e
`gcloud run services describe`. Todas as quatro funções estavam
`ACTIVE`, `GEN_2`, `nodejs22`, com as revisões seguintes
recebendo 100% do tráfego:

| Callable | Serviço Cloud Run | Revisão baseline | Tráfego |
| --- | --- | --- | --- |
| `obterContextoAdministrativoV12` | `obtercontextoadministrativov12` | `obtercontextoadministrativov12-00001-zok` | 100% |
| `listarPessoasOperacionaisV12` | `listarpessoasoperacionaisv12` | `listarpessoasoperacionaisv12-00001-juw` | 100% |
| `listarOrganizacoesOperacionaisV12` | `listarorganizacoesoperacionaisv12` | `listarorganizacoesoperacionaisv12-00001-wad` | 100% |
| `listarCursosOperacionaisV12` | `listarcursosoperacionaisv12` | `listarcursosoperacionaisv12-00001-dih` | 100% |

Em 13/10/2026 houve também a auditoria somente de leitura
`ROLLBACK_REVISION_PREFLIGHT=PASS`, `READY_REVISIONS=4/4`,
para as revisões acima:

- `REVISION_FOUND=TRUE`, `REVISION_READY=True`,
  `IMAGE_REFERENCE_PRESENT=True` e `ENTRY_POINT_MATCH=True`
  em cada uma das quatro revisões;
- `FUNCTION_SOURCE_KIND=GCS` nas quatro Cloud Functions v2;
- `SOURCE_COMMIT_MATCH=NOT_ESTABLISHED` nas quatro: a origem exata em
  Git ainda não foi comprovada;
- `ROLLBACK_EXECUTED=NO`, `DEPLOY=NONE`,
  `CLOUD_WRITES=NONE` e `MARCO9=NO_GO`.

### Inventário dos pacotes GCS (somente metadados)

A auditoria `SOURCE_AUDIT`, também realizada em 13/10/2026
sem escritas na nuvem, identificou quatro pacotes de origem distintos.
Os identificadores abaixo são os **primeiros 16 caracteres hexadecimais
de SHA-256 de bucket|objeto|geração**, não hashes do conteúdo do código
e **não** SHAs de commits:

| Callable | Fingerprint de origem | Geração GCS presente | Build ref presente |
| --- | --- | --- | --- |
| `obterContextoAdministrativoV12` | `8ADF2536BB898F03` | Sim | Sim |
| `listarPessoasOperacionaisV12` | `3902BC6362F52E85` | Sim | Sim |
| `listarOrganizacoesOperacionaisV12` | `19892BD4B9D5E0BE` | Sim | Sim |
| `listarCursosOperacionaisV12` | `CACEDE6EBF1FFBBA` | Sim | Sim |

`FUNCTIONS_VERIFIED=4/4`,
`DISTINCT_SOURCE_ARTIFACTS=4`,
`SOURCE_BUNDLE_CONSISTENCY=MULTIPLE_ARTIFACTS` e
`SOURCE_COMMIT_MATCH=NOT_ESTABLISHED`.
Pacotes distintos são compatíveis com builds separados; não
comprovam divergência de código entre funções ou revisão específica
do GitHub. **Não alegar equivalência do código implantado com o
`develop-v1.2` ou com o PR #53 sem evidência adicional.**

Próximo gate de proveniência: inspecionar somente os metadados dos
quatro builds associados (sem conteúdo de artefatos, logs, variáveis,
tokens ou dados de usuários) e procurar um SHA de Git rastreável.
Se não existir origem Git verificável, registrar
`SOURCE_COMMIT_MATCH=NOT_ESTABLISHED` como risco residual e manter
o deploy bloqueado até revisão de fallback/rollback específica.

Isso é uma **pré-condição de disponibilidade**, não um teste de rollback
nem garantia de que uma revisão pode ser promovida sem problemas.
O próximo gate é consultar metadados de proveniência e validar o
procedimento de reconciliação do serviço gerenciado pelo Firebase
Functions antes de solicitar autorização de implantação.

Estas são **referências**, não uma prova de elegibilidade para
rollback. A próxima inspeção, só de leitura, precisa confirmar que
cada revisão está pronta (`Ready=True`) e continua disponível, além
de identificar metadados de proveniência da versão implantada.
Nenhum comando de alteração de tráfego está autorizado nesta PR.

Se um futuro deploy seletivo autorizado gerar revisões novas, um
rollback emergencial de tráfego pode ser planejado conforme a
documentação oficial do Cloud Run, apontando 100% de volta às revisões
baseline **somente depois de verificar disponibilidade e
compatibilidade**. Esse ajuste de tráfego não restaura por si só o
código-fonte nem a configuração gerenciada pela Cloud Functions; a
reconciliação definitiva deve respeitar a ferramenta de implantação e
exigir autorização específica. Confirmar os efeitos do controle do
Cloud Functions v2 antes de executar comandos do Cloud Run.

Referência: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration

## Autorização futura, rollout e rollback

Esta PR é **draft**, não pode ser interpretada como autorização de deploy.
Manter `MARCO9=NO_GO`. Antes do rollout:

- Comparar o código proposto com a revisão implantada de 07/10/2026 e
  conferir derivações, CI, RBAC e App Check do staging.
- Obter autorização explícita para cada deploy seletivo em staging,
  plano de rollback e janela de observação.
- Se houver bloqueio inesperado, restaurar a revisão anterior da
  função afetada (ou remover a flag no código e redesimplantar **apenas**
  a função explicitamente autorizada).
- Não implantar funções na produção `bjj-exams`. Nenhum merge automático
  ou publicação deve ocorrer com `NO_GO`.

Documentação oficial: https://firebase.google.com/docs/app-check/cloud-functions

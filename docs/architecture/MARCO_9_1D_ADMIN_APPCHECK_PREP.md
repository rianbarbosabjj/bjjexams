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

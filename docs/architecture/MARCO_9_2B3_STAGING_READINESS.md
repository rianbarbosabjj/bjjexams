# Marco 9 — Gate 9.2B3: pré-requisitos de HMAC, TTL e calibração

**Status verificado no código: PLAN_ONLY / NO_ENFORCEMENT / NO_DEPLOY.** Este gate não provisiona chaves HMAC, não aplica TTL, não acessa Firebase e não ativa quotas. O pré-flight rejeita qualquer afirmação antecipada de que os controles estejam prontos ou ativos.

## Ambiente e política

- Projeto Firebase de homologação: **`bjj-exams-staging`**. Produção **`bjj-exams`** continua proibida. Somente PRs para `develop-v1.2`; nenhum merge autoriza deploy.
- Collection Group planejada: **`_bjj_exams_rate_limits_v12`**; documentos criados exclusivamente pelo Admin SDK dentro do guard de rate limiting, quando houver uma futura ativação.
- Timestamp para TTL: **`expiresAt`** (Firestore `Date and time` / Timestamp). O núcleo grava `new Date(expiresAtMs)`, com expiração duas janelas de 60 segundos após o começo do bucket. TTL remove dados em modo assíncrono e não equivale a bloqueio de leitura, garantia de exclusão instantânea ou limite de quota.
- Segredo HMAC planejado: **`BJJ_EXAMS_RATE_LIMIT_HMAC_V12`** (nome não sensível). **Não foi criado nem vinculado.** Formato planejado para a ativação: pelo menos 32 bytes gerados criptograficamente; nunca UID/CPF/token, valores fixos no código ou informações previsíveis.
- Configuração de referência `config/rate-limit-staging-readiness-v1_2.json` é um **manifesto de planejamento NÃO deployável**; não é um arquivo `firebase.json`, `firestore.indexes.json` nem um comando de provisionamento.

## Estado atual e justificativa

- Os Gates 9.2A e 9.2B1 validaram o limitador com transações e concorrência do Firestore Emulator em projeto fictício `demo-bjj-exams-rate-limit`.
- O Gate 9.2B2 conectou à callable `obterContextoAdministrativoV12` apenas `createRateLimitGuard({ enabled: false })`: o backend segue sem consulta ao contador, sem HMAC e sem alteração de resposta.
- A lista `firestore.indexes.json` existente tem `fieldOverrides: []` e permanece **INTOCADA**; um index override só poderá ser aprovado em um gate próprio, preservando todos os índices financeiros, de cursos e exames.
- A Security Rule final do projeto nega por padrão documentos sem match. A coleção de contadores não tem autorização de leitura/edição direta no cliente. Reavaliar antes de habilitar escrita server-side; a Admin SDK é regida por credenciais de serviço, não por regras cliente.
- O registro real de App Check, site key e homologaçāo do **Gate 9.1C2B** seguem pendentes e independentes deste gate.

## Ferramenta offline (9.2B3)

`node scripts/preflight-rate-limit-staging-v1_2.js` inspeciona manifesto, índices padrão, composição do backend e regra final de negação. Retorna um JSON **sanitizado** com `ttlPolicy=PLANNED_NOT_APPLIED`, `secret=NOT_PROVISIONED_OR_VERIFIED`, `backendQuota=DISABLED` e `activationDecision=BLOCKED_REQUIRES_SEPARATE_STAGING_APPROVAL`. Sem SDK cloud, leitura de secret, credenciais ou acesso de rede.

Os testes injetam um Buffer **sintético** para validar compatibilidade do formato HMAC, mas o resultado `SYNTHETIC_FORMAT_VALID` **não comprova** geração segura ou provisionamento da chave real. A ferramenta rejeita nome de projeto produção, campo/coleção incorretos, índices globais alterados, enforcement habilitado e estados de cadastro alegados sem evidência.

## Política TTL futura (somente execução manual, após autorização específica)

A configuração correta é um TTL de **`expiresAt`** no collection group `_bjj_exams_rate_limits_v12`, **apenas em `bjj-exams-staging`**. Os comandos abaixo são um **runbook futuro**, não executados nem incluídos no workflow do CI:

```powershell
$Project = 'bjj-exams-staging'
$Collection = '_bjj_exams_rate_limits_v12'
gcloud firestore fields ttls list --project=$Project --collection-group=$Collection

# Somente APÓS autorização expressa para a mutação em staging:
gcloud firestore fields ttls update expiresAt --collection-group=$Collection --enable-ttl --project=$Project

# Conferir estado no projeto correto (a operação pode demorar):
gcloud firestore fields ttls list --project=$Project --collection-group=$Collection
```

Além do TTL, preparar a isenção de indexação single-field de `expiresAt` em **um PR independente**. Firestore suporta uma entrada `fieldOverrides` com `collectionGroup`, `fieldPath`, `ttl: true` e `indexes: []`, mas **não** se deve substituir o arquivo principal por um índice mínimo que apagaria configurações existentes.

**Risco importante:** Firestore TTL pode levar tempo para configurar e para excluir documentos vencidos. A decisão do guard ocorre pela janela de tempo e pelo contador transacional, não pela exclusão imediata do TTL. Estimar crescimento/custos e alertas antes de ativar qualquer quota.

## Segredo HMAC futuro (sem imprimir, armazenar ou provisionar neste gate)

Em um gate operacional separado, com aprovação e projeto `bjj-exams-staging` conferido, provisionar um segredo aleatório forte no Firebase Secret Manager, com nome `BJJ_EXAMS_RATE_LIMIT_HMAC_V12`. O Firebase Functions v2 usa `defineSecret` + `secrets: [...]` para vinculação **somente às Functions autorizadas**; nada disso foi colocado no código executado nesta entrega.

- Gerar material aleatório de ao menos 32 bytes via gerador criptográfico confiável; registrar **somente em cofre**, nunca no Git, CI, prints de terminal, logs, PDF, issue ou chat.
- Para segredo armazenado em Base64, a futura composição deverá decodificar explicitamente para Buffer de bytes antes de chamar `createRateLimitGuard`, preservando a validação de 32 bytes. Não reutilizar segredo financeiro do Asaas ou do App Check.
- A rotação do segredo HMAC altera os IDs derivados e pode efetivamente reiniciar as quotas por principal. Planejar janela de rotação, monitoramento e rollback antes da ligação do backend.
- O acesso ao Secret Manager deve seguir o menor privilégio e permitir apenas o runtime da callable especificamente protegida, não webhooks, funções financeiras ou outras superfícies por padrão.

## Calibração com agregados numéricos (sem métricas reais coletadas)

`scripts/analyze-rate-limit-calibration-v1_2.js` recebe **somente** valores numéricos de quantidade de chamadas por principal/janela de 60s, já anonimizados/agregados **antes de entrar no programa**. Rejeita qualquer chave adicional, inclusive `uid`, `ip`, `email`, `customer`, token ou payload, porque aceita exclusivamente `{schemaVersion,projectId,windowMs,scopes}` e elementos `{scope,counts}`.

Formato ilustrativo, com **dados fictícios**, a enviar via stdin:

```json
{
  "schemaVersion": "1.2",
  "projectId": "bjj-exams-staging",
  "windowMs": 60000,
  "scopes": [
    { "scope": "authenticated_read", "counts": [1, 2, 5, 3, 1] }
  ]
}
```

Uso: `Get-Content .\amostra-numerica-ficticia.json -Raw | node scripts/analyze-rate-limit-calibration-v1_2.js --stdin`. Relatório: p50/p95/p99, máximo, orçamento candidato e percentual de janelas acima do candidato. Amostras com menos de 30 janelas por escopo recebem `INSUFFICIENT_SAMPLE_SIZE`; mesmo amostras maiores produzem `MANUAL_REVIEW_REQUIRED`, nunca autorização automática.

Para amostras reais: coletar somente com autorização e sem PII, garantir representatividade de turmas, papéis, horários e variações de rede; **não usar exportação bruta de logs nem armazenar dados individuais no repositório**. Os valores existentes de 90/120/12/5/10/8 solicitações por minuto são candidatos, não metas definitivas.

## Gate futuro 9.2B4 — requisitos antes de ativar

1. Cadastro do segredo HMAC no Secret Manager **somente staging**, com evidência de permissões e rotação.
2. TTL configurado e confirmado no console correto, indexação avaliada e custo monitorado.
3. Métricas reais agregadas e aprovação de quotas/UX por contexto, com análise de retries de alunos, professores e administradores.
4. Smoke tests de Auth/RBAC, acesso público, checkout **Asaas Sandbox**, provas e certificados, mantendo webhooks externos fora das quotas por browser.
5. Rollback explícito e autorização de deploy seletivo, sem tocar o projeto `bjj-exams` de produção.

Referências oficiais:
- https://firebase.google.com/docs/firestore/ttl
- https://firebase.google.com/docs/reference/firestore/indexes
- https://firebase.google.com/docs/functions/config-env

**Aceite do Gate 9.2B3:** `HMAC_READINESS=PLANNED`, `TTL_READINESS=PLANNED`, `CALIBRATION_TOOL=READY`, `REAL_STAGING_SAMPLES=NOT_COLLECTED`, `NO_ENFORCEMENT`, `NO_DEPLOY`.

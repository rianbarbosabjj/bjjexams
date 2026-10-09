# BJJ Exams v1.2 — Gate 9.8A: pré-flight de Release Candidate do Marco 9

**Status:** `NO_GO / NO_DEPLOY / NO_ENFORCEMENT` para encerramento do Marco 9 e passagem operacional ao Marco 10. A conclusão do **Gate 9.8A no código** significa apenas que o inventário e as travas de liberação foram validados. **Não significa** que o Marco 9 inteiro está concluído, que staging foi homologado ou que produção foi autorizada.

## Identificação e fonte de evidências

- Fonte declarativa de evidência: `config/marco9-rc-evidence-v1_2.json`.
- Pré-flight offline: `scripts/preflight-marco9-rc-v1_2.js`. Testes de recusa segura: `tests/marco9-rc-readiness-v1_2.test.js`.
- Base da entrega: `develop-v1.2` depois do merge do PR #35, `3a21df188c55eb353bb3ff48c39a819e28bcdffd`.
- Projeto de homologação **exato**: `bjj-exams-staging`. Projeto de produção **`bjj-exams`**: `PRODUCTION_ACCESS=FORBIDDEN`.
- **17 gates de código** com referência a PR e teste no repositório (9.0A–9.7A). Essas referências NÃO são evidência de que a configuração cloud esteja ativada. O CI do PR valida o HEAD do código, mas a matriz não é um certificado de operação de Firebase.
- **10 bloqueios operacionais** enumerados, sem evidências de homologação real anexadas. O registro não aceita transformá-los em concluídos sem um gate separado.

## Matriz de pendências antes do encerramento

| Gate pendente | Evidência necessária | Situação |
| --- | --- | --- |
| 9.1C2B | Cadastro reCAPTCHA Enterprise, Web App Check e tráfego real do navegador no staging | Não comprovada |
| 9.1D | Enforcement App Check seletivo, clientes legítimos/inválidos, rollback e aceitação | Desligado / não homologado |
| 9.2B4 | Chave HMAC no Secret Manager, TTL dos contadores, calibração real, quotas e rollback | Não provisionados / desligado |
| 9.3C | Publicar CSP *report-only* em staging autorizado e verificar cabeçalhos/violações no DevTools | Apenas versionada |
| 9.3D | Corrigir scripts/estilos inline, avaliar terceiros e aprovar política CSP obrigatória seletiva | Não ativada |
| 9.4C | `npm audit` atualizado, revisão de CVEs, ações SHA-pinned e testes negativos STRIDE em staging | Sem auditoria ao vivo |
| 9.5B | Revisão completa dos logs, acessos IAM e política LGPD/retention assinada | `RETENTION_UNAPPROVED` |
| 9.6B | Backup gerenciado e restore isolado, consistência e cleanup; RPO/RTO formalizados | Somente restore sintético no emulador |
| 9.7B | Teste controlado de Functions/Firestore real, custo/cold starts/latência e Asaas Sandbox | Somente carga sintética no emulador |
| 9.8B | Decisão humana de riscos, aceites documentados, instruções de rollback e handoff ao Marco 10 | `NO_GO` |

Esta lista é **dez gates operacionais de aceite, não dez PRs obrigatórios**; podem ser agrupados quando houver autorização para operações em staging, respeitando a ordem de dependências. A liberação a produção pertence a um Gate do Marco 10 distinto.

## Critérios mínimos para cada evidência operacional

1. **Responsável e autorização.** Nomear aprovador técnico e dono do produto; registrar data, escopo do projeto, artefato/versionamento, janela e risco. Nenhuma autorização implícita por aprovação de PR.
2. **Escopo único de staging.** Antes de comandos Firebase/Google Cloud, confirmar projeto `bjj-exams-staging`, conta/roles IAM e ausência de qualquer operação no projeto `bjj-exams`. Pagamentos de homologação somente Asaas Sandbox.
3. **Teste observável.** Registrar artefatos sanitizados de Auth, RBAC, acesso a curso, tentativa de exame, nota/certificado, compra, webhook, reprocessamento, quotas e violações CSP. Sem tokens, CPF, gabarito, payload financeiro ou IDs pessoais no repositório.
4. **Meta e rollback.** Definir limites de erro, latência e custo, RPO/RTO, janela de reversão e critérios de interrupção. Registrar resultado de rollback em staging; uma regressão bloqueia fechamento.
5. **Governança LGPD.** Aprovar finalidade, acesso e retenção de logs, contadores, eventos financeiros e auditoria; jamais aplicar TTL arbitrário a ledger ou eventos com obrigação legal.
6. **Gate formal de aceite.** Só atualizar o registro de risco e aceitar o gate 9.8B depois de comprovação real e revisão humana. A matriz 9.8A deve continuar em `NO_GO` até que exista uma versão posterior revisada e sustentada por evidências.

## Travas automáticas desta etapa

O validador lê `firebase.json` (que deve continuar **sem Hosting**), `firebase.staging-hosting.json` (site exato staging, apenas `Content-Security-Policy-Report-Only`), `functions/main.js` (rate limit ainda `createRateLimitGuard({ enabled: false })`), manifesto HMAC/TTL (`provisioned=false`, `NOT_APPLIED`) e o workflow read-only. Inspeciona se os testes de 17 gates constam no GitHub Actions e se os dez bloqueadores estão preservados. O programa não precisa de credenciais, não executa deploy e não chama APIs remotas.

**Importante:** a aprovação do CI, inclusive a regressão **133/133**, confirma a consistência do pré-flight e dos testes automatizados, não afirma que os requisitos operacionais foram executados. O pré-flight tem sucesso quando confirma corretamente **`rcDecision=NO_GO`**; essa é a decisão segura neste momento.

## Plano de execução em lotes até o Gate 9.8B

- **Lote operacional 1 — App Check + CSP:** quando reCAPTCHA Enterprise tiver cadastro e houver autorização específica para publicar Hosting staging, validar 9.1C2B e 9.3C no mesmo smoke de browser. Sem enforcement inicial.
- **Lote operacional 2 — quota + dados + LGPD:** após autorização formal, configurar HMAC e TTL de staging, colher métricas agregadas de rate limit e revisar logs/retention (9.2B4 + 9.5B). Não ativar mutações sensíveis sem calibragem e rollback.
- **Lote operacional 3 — robustez:** inventariar backup/restore gerenciado em destino isolado e realizar carga controlada com teto de custo e cenários Asaas Sandbox (9.6B + 9.7B), sem dados de produção.
- **Lote de segurança final:** auditoria npm atualizada, pentest/STRIDE negativo, ajustes de CSP e App Check de enforcement somente quando seguros (9.4C + 9.3D + 9.1D).
- **Fechamento 9.8B:** consolidar evidências, matrizes de risco residual, decisores, RPO/RTO, rollback e aceite com documentação para o Marco 10, **sem** liberar produção automaticamente.

## Saída esperada do Gate 9.8A

`MARCO9_8A_CODE_EVIDENCE_GATES=17/17`; `MARCO9_8A_UNVERIFIED_OPERATIONAL_BLOCKERS=10/10`; `MARCO9_8A_FINAL_RELEASE_DECISION=NO_GO`; `MARCO9_8A_DEPLOY=NOT_RUN`; `MARCO10_PRODUCTION_AUTHORIZATION=FORBIDDEN`.

**Marcadores finais: NO_GO, NO_DEPLOY, NO_ENFORCEMENT, produção `bjj-exams` bloqueada.**
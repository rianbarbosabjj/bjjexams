# BJJ Exams v1.2 — Marco 9: handoff de homologação operacional (Gate 9.8B, ainda NO_GO)

**Escopo:** orientação de operação humana; documento de preparação, não autorização. Código e verificações do PR #45 não equivalem a homologação do Firebase. **Projeto permitido após autorização formal:** `bjj-exams-staging`; **produção:** `bjj-exams`, estritamente proibida nesta etapa. **Asaas:** Sandbox apenas, mediante aceite específico. Nenhum teste ou deploy é executado por este documento.

## Ordem de execução e registro de evidências

| Lote | Gates pendentes | Evidência exigida antes de marcar PASS | Abort / bloqueio |
| --- | --- | --- | --- |
| 1. Browser | 9.1C2B, 9.3C | Autorização de Hosting em staging, App Check registrado, teste de token legítimo/inválido, cabeçalho CSP *report-only*, console/DevTools e rollback documentados | Origem inesperada, bloqueio de cliente legítimo ou vazamento de token |
| 2. Quotas e privacidade | 9.2B4, 9.5B | HMAC em Secret Manager de staging, TTL restrito a contadores elegíveis, métricas agregadas, revisão IAM/LGPD e retenção aprovada | Impacto no ledger, PII em logs ou calibragem não aprovada |
| 3. Recuperação | 9.6B | Backup Firestore gerenciado, destino de restore isolado, manifesto de escopo, confirmação da integridade, limpeza e medições RPO/RTO aprovadas | Origem/destino trocados, restore parcial, overwrite, operação concorrente |
| 4. Carga | 9.7B | Janela, endpoints, orçamento em moeda, limites de requisições/concorrência/duração, p95/p99, erros e cold starts aprovados; smoke gradual; idempotência e somente Asaas Sandbox | Custo/erro/latência acima do teto; cross-tenant; evento financeiro duplicado |
| 5. Segurança final | 9.4C, 9.3D, 9.1D | Revisão de CVEs atuais, STRIDE negativo real, revisão e correções CSP, App Check seletivo, rollback ensaiado | Regressão, dependência crítica, bloqueio legítimo |
| 6. Aceite | 9.8B | Relatório consolidado sanitizado, desvios e riscos residuais, aprovadores humanos, hora/commit/projeto, comparação RPO/RTO e rollback | Qualquer aceite sem evidência independente |

## Formulário de aceite por lote (preenchimento humano)

- Gate/lote: **PENDENTE**
- Projeto e ambiente observados: **NÃO VALIDADO**
- Commit/artefato implantado: **NÃO VALIDADO**
- Responsável técnico / dono de produto / segurança: **NÃO DESIGNADOS**
- Autorização, janela e escopo: **NÃO CONCEDIDOS**
- Links internos para evidências sanitizadas (sem tokens, dados pessoais, gabaritos ou payload financeiro): **NÃO ANEXADOS**
- Limites aprovados e medidos (se aplicável): **NÃO DEFINIDOS**
- Resultado do teste e rollback: **NÃO EXECUTADOS**
- Risco residual e decisão assinada: **NO_GO / SEM ACEITE**

## Regras de segurança

1. Nunca transformar checklist preenchido, CI verde ou PR mergeado em autorização de deploy. Exigir confirmação humana de escopo, IAM, orçamento, retenção e plano de parada.
2. Separar coleta de evidência de operações que alterem staging. Não usar credenciais reais, endpoints reais ou dados pessoais no repositório. Toda autorização de operação real deve ocorrer fora deste PR.
3. Não configurar políticas de segurança em enforcement, TTL, quotas, backups ou testes de carga sem o respectivo aceite; rollback deve estar preparado previamente.
4. Não executar restore contra `bjj-exams` ou em destino pré-populado. Não criar cobranças reais. Um erro de isolamento ou idempotência interrompe imediatamente o lote.
5. Encerramento do Marco 9 e passagem ao Marco 10 requerem Gate 9.8B assinado. Mesmo depois disso, produção continua sujeita a autorização distinta no Marco 10.

## Fonte de verdade e próximo desbloqueio

- Registro declarativo: `config/marco9-rc-evidence-v1_2.json` (10 bloqueios operacionais; `NO_GO`).
- Checklist original de gates: `docs/architecture/MARCO_9_8_RC_PREFLIGHT.md`.
- Backup/restore: `docs/architecture/MARCO_9_6B1_MANAGED_BACKUP_READINESS.md`.
- Carga: `docs/architecture/MARCO_9_7B1_STAGING_LOAD_HANDOFF.md`.

**Próxima ação humana:** atribuir responsáveis pelo Lote 1, confirmar que o ambiente de staging é acessível e registrar autorização específica para observação no navegador e eventual publicação de CSP report-only. Na ausência dessa autorização, manter **NO_GO / NO_DEPLOY / NO_ENFORCEMENT** e seguir apenas com revisões offline.

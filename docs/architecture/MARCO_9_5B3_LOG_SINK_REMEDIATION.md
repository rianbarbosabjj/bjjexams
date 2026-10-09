# Marco 9 — Gate 9.5B3: mitigação de sinks de log (código, sem deploy)

**Status:** `CODE_PATCH_AND_OFFLINE_TESTS_ONLY / NO_GO / NO_DEPLOY`. A revisão de IAM, retenção e Cloud Logging continua sujeita a aprovação humana.

## Escopo do patch

1. `functions/src/compatibility/legacy-index.v1_1.js`: erro do webhook legado passa a usar `sanitizeOperationalError(error)` (allowlist de classe, sem mensagem/stack/headers). Logs de recuperação/conflito de perfis não incluem `uid`, `oldUid` ou informações pessoais; a contagem agregada de conflitos é preservada.
2. `functions/src/courses/course-moderation-submission-functions.js`: o log do provedor passa a registrar somente IDs técnicos de correlação já existentes e a classe sanitizada. O diagnóstico do fluxo de revisão humana, estado `manual_review`, contratos de moderação, quotas, pagamentos e falhas permanecem inalterados.
3. Teste dedicado `tests/marco9-privacy-remaining-log-sinks-v1_2.test.js` adicionado ao workflow versionado. Usa somente strings artificiais e leitura de código local; não lê logs reais.

## Evidências operacionais (não equivalem a aceite)

O inventário estático do Gate 9.5B1 é heurístico: lista pontos candidatos de logs; não demonstra vazamento em produção. O responsável de staging reportou execução de inventário e inspeção da configuração de Cloud Logging em 2026-10-09; **o patch não lê Cloud Logging nem modifica permissões/retention**.

## Bloqueios remanescentes

- Auditar buckets e IAM efetivo (incluindo grupos, herança, custom roles, permissões por bucket, service accounts, acessos organizacionais e sinks), sem expor identidades nos relatórios.
- Rever logs históricos e retenção por finalidade conforme LGPD, sem exclusão automática.
- Validar o comportamento após um **deploy staging independente e expressamente aprovado**. Nenhum resultado de CI comprova implantação.
- Permanecem proibidos: produção `bjj-exams`, deploy automático, alteração de Firestore Rules/índices, App Check enforcement, HMAC, TTL, Asaas e dados reais.

**Gate 9.5B: parcial. Gate 9.8B: NO_GO.**

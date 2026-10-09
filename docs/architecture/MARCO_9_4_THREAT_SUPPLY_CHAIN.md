# Marco 9 — Gates 9.4A e 9.4B: STRIDE e integridade da cadeia de software

**Status: REPOSITORY_REVIEW_ONLY / NO_DEPLOY / NO_ENFORCEMENT.** O conjunto documenta ameaças e verifica o lockfile offline; não prova pentest, conformidade operacional ou ausência de CVEs.

## Gate 9.4A — modelo de ameaça STRIDE

`docs/security/marco9-threat-model-v1_2.json` contém 12 cenários estruturados e revisáveis com **STRIDE**: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service e Elevation of privilege. Cada registro identifica o fluxo, fronteira de confiança, origem no código, impacto, controle conhecido, teste de referência, lacuna residual e teste negativo proposto.

Fluxos contemplados: bootstrap administrativo e RBAC; associação organizacional; checkout; webhook Asaas legado; webhook canônico; reprocessamento administrativo; prova e respostas; certificados; rate limit; observabilidade; CSP e App Check. As referências a testes existentes indicam evidência de contrato, NÃO revisão independente de todos os vetores. Não afirmar vulnerabilidades corrigidas sem reproduzir o cenário negativo em emulador e staging.

**Riscos abertos:** App Check Enterprise real ainda não homologado, rate limiting desativado, CSP report-only apenas versionada, idempotência e replay sob carga em Asaas Sandbox sem smoke recente, revisão de associação cruzada entre organizações incompleta e política de retenção de logs não aprovada.

Para concluir a revisão 9.4 operacional, responsáveis técnicos devem classificar severidade/probabilidade, reproduzir os cenários negativos em ambiente isolado, verificar IDOR e limites por organização, aprovar tratamento de riscos e documentar evidências por teste. `REQUIRES_MANUAL_STAGING_REVIEW` não significa controle habilitado nem falha confirmada.

## Gate 9.4B — CI e dependências

`scripts/preflight-supply-chain-v1_2.js` confere offline a coerência entre `functions/package.json`, `functions/package-lock.json` v3 e a versão Node 22.23.2 fixada no workflow, quatro dependências diretas com versões exatas (`axios`, `firebase-admin`, `firebase-functions`, `form-data`), os hashes de integridade dos tarballs resolvidos, HTTPS no registro oficial npm, `npm ci --ignore-scripts`, checkout sem credenciais persistidas e permissão global de leitura.

**Limites da verificação:** ela não consulta a base de vulnerabilidades npm, não compara tarballs baixados com hashes e não garante ausência de pacotes comprometidos, malware ou problemas de licença. `actions/checkout@v4`, `actions/setup-node@v4` e `actions/setup-java@v4` ainda estão fixados por tags de versão, **não por SHA imutável**. Estado registrado: `TAG_BASED_NOT_COMMIT_SHA_PINNED`. A futura migração para SHAs deverá validar os digests oficiais e manter smoke CI.

Após autorização de revisão externa e sem expor credenciais, executar auditoria de vulnerabilidades atualizada somente no ambiente isolado:

```bash
npm --prefix functions audit --omit=dev --audit-level=high
npm --prefix functions outdated
```

**Esses comandos NÃO foram executados neste gate.** Registrar CVEs, gravidade, pacote afetado, versão corrigida, compatibilidade de Firebase SDK e justificativa de exceções. Não atualizar dependências financeiras e Firebase sem regressão, smoke de Auth e webhook Asaas Sandbox.

## Segurança do processo

- GitHub Actions executa PR contra `develop-v1.2` com `permissions: contents: read`, sem `pull_request_target`, tokens privados ou deploy.
- `firebase.json` continua sem Hosting de produção, Firestore staging somente após autorização de deploy específica, webhook Asaas externo fora de App Check e rate limiting.
- Novas verificações são offline e usam somente arquivos versionados. `MANUAL_REVIEW_REQUIRED` significa que o gate operacional ainda não foi certificado.

**Gate combinado de código 9.4A/9.4B:** STRIDE documentado, contratos automatizados de versões/lockfile/CI e pendências de testes reais registradas. `NO_DEPLOY`, `NO_ENFORCEMENT`.

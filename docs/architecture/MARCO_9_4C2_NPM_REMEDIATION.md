# Marco 9 — Gate 9.4C2: triagem e correção das dependências npm

**Situação inicial em 9 de outubro de 2026:** o CI do Gate 9.4C1 detectou **5 pacotes vulneráveis** no recorte das dependências de produção (`1 critical`, `2 high`, `2 moderate`). A análise por nome do pacote e atualização disponível **ainda não foi validada**; essa etapa inicial adiciona a triagem em CI. `NO_GO / NO_DEPLOY`.

## Fase 1 — descobrir os pacotes afetados e as possibilidades de correção

`scripts/triage-npm-advisories-v1_2.js` recebe o mesmo relatório de `npm audit --prefix functions --omit=dev --json` por stdin, mas imprime **somente** nome de pacote público npm, gravidade, status de dependência direta/transitiva e indicação de versão/relação de atualização. Não imprime título de advisory, URI, CVE, dados pessoais, stack, token nem payload.

O relatório atual fica em arquivo temporário no runner do GitHub Actions e é apagado após o teste. A triagem não altera `functions/package.json` ou `functions/package-lock.json`; a aprovação desse subgate significa somente que o diagnóstico é reproduzível.

## Fase 2 — atualização controlada (ainda não executada)

- Classificar direct vs transitive, caminho de dependência e `fixAvailable`. Preferir versões patch/minor dentro das faixas compatíveis. Sem `npm audit fix --force`, sem alteração de versões principais Firebase/Admin/Functions sem revisão.
- Gerar `package-lock.json` consistente com npm, usando registro público, versão fixa do Node do CI, `--package-lock-only` e sem lifecycle scripts. Nunca editar hashes de integridade manualmente nem remover dependências necessárias ao runtime.
- Rodar `npm ci --prefix functions --ignore-scripts`, 133/133 regressões, testes Auth/RBAC, Firestore Emulator, checkout/webhooks Asaas Sandbox simulados, e novo `npm audit` no HEAD exato.
- Corrigir/mitigar critical/high; se sobrar alguma vulnerabilidade, registrar bloqueio explícito para Marco 9, sem concluir 9.4C.
- Preservar ambiente Firebase `bjj-exams-staging`, produção `bjj-exams` intocada e `develop-v1.2` como única base de merge. Nenhum deploy, cobrança real, alteração de webhook ou dado pessoal.

**Critério desta primeira entrega:** evidência de triagem sem dados sensíveis, contratos CI verdes, nenhuma mudança de dependência ainda. **A correção de vulnerabilidades permanece pendente até confirmação por auditoria após atualização.**
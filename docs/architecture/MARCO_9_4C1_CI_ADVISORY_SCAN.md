# Marco 9 — Gate 9.4C1: auditoria npm atual e SHA imutável do CI

**Situação:** auditoria pública de vulnerabilidades atualizada no GitHub Actions, com saída agregada e sanitizada. **Não** conclui o Gate 9.4C inteiro (ainda faltam STRIDE/pentest, triagem e aceite). `NO_GO / NO_DEPLOY / NO_ENFORCEMENT` para encerramento do Marco 9 e Marco 10.

## Limites desta entrega

- Branch única `develop-v1.2`, sem acesso a dados Firebase/Asaas e sem uso de Firebase CLI em modo deploy. Somente rede para o registro público de pacotes npm em ambiente CI temporário, sem credenciais de repositório persistidas.
- Projeto de staging permitido nos contratos: `bjj-exams-staging`; produção `bjj-exams` continua explicitamente proibida.
- `functions/package.json` e `functions/package-lock.json` não são atualizados; quatro dependências diretas continuam fixas: axios, firebase-admin, firebase-functions e form-data.
- Não há operações no Asaas Sandbox nem atualização de funções financeiras, regras Firestore ou índices.

## Actions com commits confirmados

| Action | Commit SHA imutável usado no CI | Linha mantida |
| --- | --- | --- |
| `actions/checkout` | `11bd71901bbe5b1630ceea73d27597364c9af683` | v4.2.2 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |
| `actions/setup-java` | `c5195efecf7bdfc987ee8bae7a71cb8b11521c00` | v4.7.1 |

Esses SHAs foram conferidos nos repositórios oficiais GitHub `actions/checkout`, `actions/setup-node` e `actions/setup-java`; não foram inventados. O preflight da cadeia de suprimentos agora exige exatamente esses commits, sem tags mutáveis. `SHA_PINNED_V4` não equivale a segurança eterna: versões V4 ainda dependem de runtime **NODE20** (Node 20). A migração para versões mais novas e suportadas é um trabalho separado, com revalidação das 133 regressões, Firestore Emulator e testes de segurança.

## `npm audit` atual, somente leitura

O CI chama `npm audit --prefix functions --omit=dev --json`, com `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`. Os arquivos `package.json` e lockfile permanecem intocados. A consulta usa a base atual de advisories do npm no momento da execução, que pode variar entre dias ou execuções.

O relatório JSON bruto é gravado em arquivo temporário isolado e eliminado ao final do job. `scripts/summarize-npm-audit-v1_2.js` recebe o JSON por stdin, exige esquema auditReportVersion 2 e imprime **somente totais por gravidade** (`info`, `low`, `moderate`, `high`, `critical`, `total`), sem nomes de pacotes, texto de advisories, URLs, tokens ou dados pessoais. Falta de relatório íntegro, formato inesperado ou indisponibilidade de registry causam falha do CI. Quando existem findings, o job pode continuar para preservar diagnóstico, mas o relatório continua `FINDINGS_REQUIRE_MANUAL_SECURITY_REVIEW` e a decisão **NO_GO**.

A ausência de achados é específica do registro npm e do recorte `--omit=dev` naquele instante; não prova ausência de backdoors, CVEs não catalogados, riscos dos CDNs carregados no navegador, dependências do Firebase em nuvem, falhas de autorização ou vulnerabilidades de projeto. Mutações de pacote e atualizações automáticas não são executadas. Não rodar `npm audit fix` nem `npm update` sem revisar efeitos colaterais de Firebase SDK, checkout e Asaas.

## Próximos aceites pendentes do Gate 9.4C

- Triar achados com nome, versão, gravidade, alcance, compatibilidade e ação (corrigir / mitigar / aceitar formalmente), em ambiente privado aprovado. A saída agregada do CI **não substitui** essa revisão.
- Reexecutar `npm audit` em janela controlada, registrar evidência de severidade e resolver high/critical antes de recomendar homologação final.
- Validar as 12 ameaças STRIDE com testes negativos em staging (incluindo acesso cruzado a organizações, replay, checkout Asaas Sandbox, exame, certificado e RBAC), sob autorização, limites de custo e rollback.
- Planejar migração de Actions V4/Node 20 para versões suportadas, sem trocar imagens do runner ou versão do Node de aplicação sem regressão.
- A matriz 9.8A mantém o Gate 9.4C como bloqueador operacional, independentemente do sucesso deste subgate técnico.

**Aceite de código 9.4C1:** `CI_ACTION_SHA_PINS=3/3`, `NPM_AUDIT_OUTPUT=SANITIZED`, `STRIDE_STAGING_TESTS=PENDING`, `MARCO9_RC_DECISION=NO_GO`, `NO_DEPLOY`, `NO_ENFORCEMENT`.

Referências: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions ; https://docs.npmjs.com/cli/v10/commands/npm-audit

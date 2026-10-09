# Marco 9 — Gate 9.4C2: correções npm prioritárias e riscos residuais

**Estado da correção versionada em 9 de outubro de 2026:** três atualizações transitivas de `package-lock.json` geradas via `npm audit fix --package-lock-only` no runner temporário e incorporadas após conferência; quatro dependências diretas mantidas intactas. **O npm audit pós-proposta no runner indicou 2 moderate, 0 high, 0 critical**. Essa verificação ainda precisa ser repetida no HEAD final do PR com o lockfile efetivamente commitado.

## Antes → depois

| Pacote transitivo | Versão anterior | Versão atual no lockfile | Classe anterior do npm audit |
| --- | --- | --- | --- |
| `@grpc/grpc-js` | 1.14.4 | 1.14.6 | high |
| `brace-expansion` | 2.1.4 | 2.1.7 | high |
| `proxy-addr` | 2.0.7 | 2.0.8 | critical |

Estes pacotes são instalados indiretamente. Nenhuma dependência direta foi adicionada, removida ou atualizada: `axios=1.20.0`, `firebase-admin=14.4.0`, `firebase-functions=7.3.2`, `form-data=4.0.6`. Os campos `resolved` e `integrity` dos três pacotes vieram da resolução real do registro público npm feita no GitHub Actions, e não foram inventados. O teste `tests/marco9-npm-lock-fixes-v1_2.test.js` impede regressões das versões.

## O que permanece pendente

O `npm audit` pós-proposta ainda apontou **2 moderate** referentes a `gaxios` e `uuid`. `gaxios` possui cópias transitivas de linhas principais distintas; `uuid` aparece na linha 9.x. Embora o npm informe correção disponível, a opção não-forçada `npm audit fix` não conseguiu eliminar ambos sem outra decisão de dependência. Isso exige revisão de relações semver, origem e impacto de upgrade, inclusive migração de linha principal, antes de qualquer `overrides` ou atualização de Firebase SDK.

Não usar `npm audit fix --force` nem adicionar dependências artificiais apenas para zerar um contador. Confirmar dependentes reais, risco explorável no BJJ Exams, compatibilidade de Auth, Firestore, certificados, exames, checkout e webhooks Asaas Sandbox. Registrar explicitamente correção, mitigação ou aceite formal aprovado para cada vulnerabilidade residual.

## Validação e limites

- O pipeline instala com `npm ci --prefix functions --ignore-scripts --no-audit --no-fund`, roda 133/133 regressões, Gates de segurança existentes e testes reais do Firestore Emulator em projeto fictício.
- O scan atual `npm audit --prefix functions --omit=dev --json` imprime somente contagens agregadas, e uma segunda triagem imprime apenas nomes públicos de pacotes, severidade e versão de correção. Não divulga relatórios JSON brutos, dados pessoais ou tokens.
- O script temporário que propôs os upgrades foi removido do workflow; não há execução automática de `npm audit fix` nem alteração de lockfile nos CI futuros.
- A aprovação do CI só autoriza integrar as correções **no código**. O Gate 9.4C continua operacionalmente pendente por duas vulnerabilidades moderadas, teste negativo STRIDE e revisão de atualizações de Actions V4 (Node 20).
- `NO_GO` para encerramento do Marco 9, `NO_DEPLOY`, nenhum contato com Firebase/Asaas de staging ou produção e nenhum enforcement ativado.

**Próximo gate proposto 9.4C3:** triagem e resolução das linhas `gaxios` / `uuid`, com testes de compatibilidade e auditoria npm final. Não confundir ausência de erros do workflow com ausência de vulnerabilidades.
# Marco 9 — Segurança, resiliência e preparação operacional (BJJ Exams v1.2)

## Estado e referência

- Gate atual: **9.0A — contrato e inventário de segurança (sem enforcement)**.
- Base imutável de início: `develop-v1.2` em `c1d74252bec4d9b28cea7b6e514ebc1138d9bdd7` (merge do PR #21 / Marco 8).
- Marco 8: RC Gate 8.9B aprovado, 133/133 verificações locais e CI do PR #21 aprovada.
- Esta entrega **não** comprova que controles novos estejam implantados ou homologados. O produto continua staging-only para as superfícies canônicas protegidas.

## Objetivo

Introduzir proteções contra abuso, falhas operacionais e alterações de configuração inseguras, sem regressão funcional nem ativação silenciosa em produção. Cada mudança de enforcement deve ser pequena, reversível, testada em emulador e homologada separadamente em `bjj-exams-staging`.

## Fronteiras invioláveis

1. `PRODUCTION_ACCESS=FORBIDDEN` neste marco até autorização explícita e gate próprio.
2. `STAGING_PROJECT=bjj-exams-staging`; o projeto `bjj-exams` não recebe deploy, alteração de regra, secret, webhook ou operação de dados.
3. Em staging, qualquer pagamento real de teste é exclusivamente `Asaas Sandbox`, nunca credencial ou wallet de produção.
4. Não relaxar os bloqueios de produção dos Marcos 5 a 8; manter `firebase.json` sem Hosting e preservar o Hosting explicitamente configurado para staging.
5. Não criar fontes financeiras paralelas, não expor ledger, gabarito, segredos ou dados pessoais em read models/logs.
6. Fluxos de exames, cursos, certificados, webhooks, estornos e reprocessamento mantêm idempotência, autorização backend, auditoria e limites canônicos.
7. Nada de automações de deploy em CI; `pull_request` com credenciais somente de leitura, sem Firebase, Asaas ou serviços reais.
8. A ausência de checks de CI não constitui aprovação. Merge é permitido na `develop-v1.2` somente após checks reais verdes e políticas de revisão atendidas.

## Inventário e prioridades

| Área | Estado após Marco 8 | Ameaça principal | Gate de implementação | Aceite obrigatório |
| --- | --- | --- | --- | --- |
| App Check | Fora de escopo do Marco 8; enforcement não presumido | Chamadas automatizadas e falsificação de cliente | 9.1 | Matriz de callables, estratégia gradual, recusa controlada, emulador e staging testados |
| Rate limiting | Limitação global ainda não homologada | Abuso de endpoints públicos, checkout e consumo de quota | 9.2 | Limites por endpoint/identidade, respostas sanitizadas, tratamento de retry e testes de concorrência |
| CSP e cabeçalhos | CSP final não homologada | XSS e carregamento arbitrário de scripts | 9.3 | Inventário de scripts/origens; CSP report-only primeiro; política final validada sem quebrar Firebase |
| Threat model | Revisão final pendente | Escalada de privilégios, IDOR, replay e exfiltração | 9.4 | Matriz STRIDE por fluxo com mitigação verificável e testes negativos |
| Dependências e CI | CI 133/133 do Marco 8; hardening contínuo pendente | Supply-chain e regressões sem detecção | 9.4 | Node 22 fixado; dependências travadas; workflow read-only; auditoria documentada |
| Auditoria, observabilidade e LGPD | Read models sanitizados no Marco 8; governança final pendente | Logs sensíveis e retenção excessiva | 9.5 | Política de campos, retenção, acesso administrativo e trilha de auditoria |
| Backup e restore | Exercício final não comprovado | Perda ou corrupção de dados | 9.6 | Plano RPO/RTO, teste de restore em destino isolado com dados sintéticos e prova de cleanup |
| Carga e falhas | Testes finais não comprovados | Saturação, retries duplicados e indisponibilidade | 9.7 | Testes graduais em staging, limites definidos e sem operações de dinheiro real |
| Release e rollback | Produção bloqueada; sem go-live | Ativação prematura/rollback inseguro | 9.8 | RC e relatório de risco; plano de reversão e handoff ao Marco 10 |

## Gate 9.0A — aceite deste PR

- Criar e versionar este contrato de segurança.
- Registrar limites conhecidos sem alegar enforcement já ativo.
- Criar teste de contrato estático que confira separação staging/produção e ausência de deploy no workflow.
- Estender CI da v1.2 aos PRs de outros marcos contra `develop-v1.2`, reaproveitando a regressão 133/133.
- Preservar `functions/main.js`, `firestore.rules`, `firebase.json`, Hosting e dados sem alterações neste gate.
- Registrar gate como `PLAN_ONLY`, não como App Check/rate limiting/CSP implantados.

## Gate 9.1 — App Check

1. Inventariar callables expostas por domínio, distinguir públicas/autenticadas e chamadas externas como webhooks.
2. Identificar suporte no SDK/browser, diferenças entre Firebase callable e endpoints HTTP e o comportamento em emulador.
3. Introduzir telemetria e modo sem enforcement quando aplicável; depois permitir enforcement apenas por allowlist em staging.
4. Preservar chamadas serviço-a-serviço e webhooks autenticados por mecanismos próprios; App Check não substitui Auth, RBAC, assinatura de webhook nem rate limit.
5. Testar legítimo, ausente, inválido, token expirado, replay e clientes legados; rollback documentado antes de enforcement.

## Gate 9.2 — Antiabuso

Definir cotas distintas para leitura pública, emissão/validação, operações autenticadas e checkout, respeitando idempotência. Evitar guardar PII desnecessária em chaves de limitação. O limite deve falhar fechado para comandos sensíveis quando infraestrutura da defesa não estiver disponível, com exceções justificadas e observáveis. Testar concorrência, burst, retry e negativa por papel.

## Gate 9.3 — CSP

Inventariar JS inline, bibliotecas remotas, Firebase/Auth, endpoints de Functions, mídia e redirecionamentos no artefato de 52 arquivos. Começar com `Content-Security-Policy-Report-Only` em staging; revisar relatórios sem exibir PII e migrar gradualmente à política restritiva após smoke visual e funcional. Não usar `unsafe-eval` ou wildcard indiscriminado como solução definitiva.

## Gate 9.4 — Threat model e supply chain

Cobrir STRIDE/abuso em: bootstrap administrativo, associação organizacional, cadastro, checkout, confirmação do Asaas, webhook, reprocessamento, exame, resultados, emissão/revogação de certificado e conteúdo dos cursos. Para cada cenário: fronteira de confiança, ator, impacto, controle existente, lacuna, teste negativo e evidência. Fixar versões e revisar dependências; CI não recebe tokens, chaves ou permissões de escrita.

## Gate 9.5 — Auditoria e retenção

Auditar sanitização de dados pessoais e de eventos, controle de leitura, correlação de operações e retenção por classe de dados. Não registrar payloads brutos de pagamento, tokens, gabaritos nem informações sensíveis em logs. O período de retenção deve ser decisão formal de governança, não suposição deste documento.

## Gate 9.6 — Backup/restore

Definir escopo mínimo (Firestore, Storage quando aplicável, índices, regras e metadata necessária), pontos de restauração e RPO/RTO aprovados. Executar teste somente com dados sintéticos em projeto/namespace isolado; conferir integridade, acesso, trilha e eliminação de resíduos. Não efetuar restore em produção como parte da homologação.

## Gate 9.7 — Testes de carga/falhas

Usar perfis graduais e teto de custo em staging, sem Asaas produção nem cobranças reais. Medir latência, erro, cold starts, idempotência, quota e comportamento sob indisponibilidade. Testes destrutivos exigem ambiente isolado e limpeza.

## Gate 9.8 — RC e handoff ao Marco 10

Requer regressão consolidada verde, controles implantados com evidências, smoke autorizado em staging, revisão de segredos e dependências, threat model revisado, prova de restore isolado, performance dentro dos limites aprovados e instruções reproduzíveis de rollback. **Não autoriza go-live nem produção**; essa decisão é do Marco 10 e depende de autorização explícita.

## Rastreabilidade

- Documento anterior: `docs/architecture/MARCO_8_PLAN.md` (seção de não escopo dos Marcos 9 e 10).
- PR de origem: `#21` / HEAD de integração `c1d74252bec4d9b28cea7b6e514ebc1138d9bdd7`.
- Teste do gate: `tests/marco9-security-baseline-v1_2.test.js`.
- CI da v1.2: `.github/workflows/marco8-rc-regression.yml` (reutilizado; sem deploy).
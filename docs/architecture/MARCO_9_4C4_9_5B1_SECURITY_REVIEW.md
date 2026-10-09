# Marco 9 — Gates 9.4C4 + 9.5B1: testes negativos e inventário de logs

**Estado: CODE_EVIDENCE_ONLY / NO_GO / NO_DEPLOY / NO_ENFORCEMENT.** Este lote não acessou Firebase real, Asaas Sandbox ou produção, não executou pentest remoto nem leu dados pessoais. Não encerra os Gates operacionais 9.4C ou 9.5B.

## Gate 9.4C4 — STRIDE negativo sobre handlers reais com dados artificiais

`tests/marco9-stride-negative-handlers-v1_2.test.js` utiliza os handlers reais de ingress do webhook Asaas, reprocessamento administrativo e contexto administrativo, mas injeta serviços falsos em memória. Exige:

- **T01 / Spoofing, Elevation of privilege**: Auth UID ausente, claim `owner` não-administrativa e tentativa de elevar papel através de payload/headers não conseguem acessar o contexto; RBAC rejeita antes do contador. A identidade em uma resposta autorizada vem do UID Firebase Auth simulado, não do header `x-user-id`.
- **T04 / Spoofing**: `GET`, webhook sem token, token errado e payload array falham com HTTP 405/401/403/400; nenhuma dessas chamadas alcança o serviço de persistência.
- **T05 / Tampering e replay**: evento com mesma identidade mas projeção divergente gera código sintético `WEBHOOK_EVENT_REDELIVERY_MISMATCH` mapeado em HTTP 409, sem retornar o conteúdo da exceção; a idempotência real no Firestore será testada separadamente em staging.
- **T06 / Elevation of privilege**: reprocessamento sem sessão, perfil comum ou `platform_admin` sem capability é rejeitado antes de qualquer execução; `finance_admin` não consegue injetar `role` no payload. O UID e papel efetivamente encaminhados são extraídos do Auth verificado, não do cliente.
- **T10 / Information disclosure**: erro sintético em webhook carrega token falso, nome de classe malicioso e campos headers; o log contém apenas `{name:'Error'}`, e a resposta HTTP contém apenas código genérico, sem vazamento de token ou mensagem.

**Limite:** estes contratos comprovam comportamentos negativos desses três handlers em isolamento, não abrangem os 12 cenários STRIDE nem substituem testes de carga, pentest de IDOR entre organizações, replay real de Asaas Sandbox ou homologação do App Check.

## Gate 9.5B1 — inventário estático do código de logging

`scripts/inventory-operational-logs-v1_2.js` percorre **somente** `functions/index.js`, `functions/main.js` e arquivos `functions/src/**/*.js` do repositório, sem acesso à rede. Identifica aproximadamente chamadas `console.log/info/warn/error/debug` e `logger.log/info/warn/error/debug` e as classifica em:

- `POSSIBLE_SENSITIVE_ARGUMENT_REVIEW_REQUIRED`: o trecho de código próximo à chamada menciona error/request/token/payload/CPF/email etc.; indicação de investigação, **não uma exposição confirmada**.
- `SANITIZER_PRESENT_REVIEW_REQUIRED`: aparece `sanitizeOperationalError()` próximo à chamada; a existência do helper não certifica o restante do caminho.
- `MANUAL_REVIEW_REQUIRED`: demais chamadas, que também precisam de inspeção.

A saída JSON contém apenas **totais, classes e marcadores de pendência**, sem conteúdo das linhas, corpos HTTP, e-mails, CPF, tokens ou textos de mensagens. Os limites da busca textual podem incluir chamadas comentadas ou perder logs gerados por aliases ou chamadas multilinha complexas; a revisão manual de todas as origens, sinks e funções é indispensável.

### Pendências LGPD e Cloud Logging

- **RETENTION_UNAPPROVED**: não foram aprovados prazos, base legal/finalidade por dado, exceções, eliminação, retenção financeira/auditável ou governança de incidentes.
- **Cloud Logging IAM não inspecionado**: falta revisar acesso por papel, service accounts, sinks, queries salvas, exportações, contagem de eventos e segurança do armazenamento no projeto `bjj-exams-staging` mediante autorização específica.
- **Histórico não revisto**: ausência de inventário de logs antigos e eventuais exposições passadas; a varredura estática não apaga nem altera dados.
- **Ledger e webhook financeiro**: não aplicar TTL ou limpeza em eventos de reprocessamento, transações, idempotência, certificados ou auditoria sem análise legal, contábil e operacional.
- Produção `bjj-exams` e pagamentos reais são inacessíveis neste gate. O uso de Asaas Sandbox para testes de replay em staging depende de autorização de integração separada.

## Evidências e critério de conclusão parcial

O CI roda 133/133 regressões existentes, os emuladores Firestore demo, `npm audit` com zero vulnerabilidades reportadas no instante do scan e os novos testes negativos/varredura. **Gate 9.4C4 = REPOSITORY_NEGATIVE_TESTS_ONLY**, **Gate 9.5B1 = SOURCE_INVENTORY_ONLY**. Ambos podem ser mergeados sem encerrar os Gates 9.4C e 9.5B, que continuam marcados como bloqueios operacionais no registro 9.8A.

**Próximo lote:** realizar testes negativos de IDOR entre organizações, isolamento de exames/certificados e replay real apenas em staging/Asaas Sandbox autorizado; aprovar governança e retention LGPD e inspeção operacional do Cloud Logging.

**Marcadores: NO_GO, NO_DEPLOY, NO_ENFORCEMENT, RETENTION_UNAPPROVED, produção intocada.**

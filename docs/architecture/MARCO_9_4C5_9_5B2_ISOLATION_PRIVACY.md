# Marco 9 — Gates 9.4C5 / 9.5B2: isolamento por organização e minimização de logs

**Status: CODE_NEGATIVE_TESTS / LOG_MINIMIZATION / NO_GO / NO_DEPLOY.** Não foi feito teste remoto, deploy, consulta Cloud Logging ou operação Firebase/Asaas. A liberação do Marco 9 e o aceite LGPD continuam pendentes.

## 9.4C5 — Testes negativos de IDOR entre academias (STRIDE)

`tests/marco9-cross-organization-denials-v1_2.test.js` exercita as funções reais de domínio de organização e matrícula, com dados sintéticos de duas academias e dois usuários distintos. São validados os seguintes invariantes:

- Vínculo **ativo em academia A** não permite acesso a curso da **academia B**; vínculo de outro usuário em B não é suficiente para o usuário A; ausência de vínculo, `pending`, `suspended`, `ended` e `rejected` também são negados.
- Matrícula válida do próprio aluno na academia correta pode gerar entitlement, enquanto matrícula de outro usuário, outro curso, cancelada/refunded ou de organização errada não libera conteúdo.
- Cursos privados exigem concessão; cursos pagos exigem pagamento/concessão apropriada. Vínculo de professor sem permissão explícita não autoriza aplicar exame oficial; vínculo suspenso de gestor não autoriza gestão.
- Os identificadores das matrículas são vinculados a `courseId` e **Firebase Auth UID** distintos por hash; testes estáticos verificam que as consultas de vínculo no handler utilizam `request.auth.uid` e não `request.data.userId`.

**Limite:** este é um teste de contratos de domínio e de composição do handler, não um pentest de IDOR real contra regras Firestore, Cloud Functions ou Auth em staging; não valida todos os endpoints, certificados ou webhooks. Gate 9.4C operacional permanece bloqueado.

## 9.5B2 — Redução concreta de dados em logs legados

A revisão de código identificou quatro registros em `functions/index.js` ligados a login legado, relink de perfil e sincronização de Global Claims. O log de falha de sincronização emitia antes `uid`, papel, fonte, código e **mensagem de erro bruta**; os outros registravam identificadores pessoais e identificadores de perfil. Essa exposição potencial foi mitigada no **código-fonte** por minimização:

- Evento de sucesso na sincronização: apenas mensagem fixa, sem UID, papel ou fonte.
- Falha na sincronização: mensagem fixa e `sanitizeOperationalError(error)` (somente classe de erro allowlisted), sem mensagem, stack, código externo, UID ou token.
- Perfil relincado: somente mensagem fixa; conflito de perfis: somente contagem de perfis em conflito (sem UID ou e-mail).
- O teste `tests/marco9-legacy-auth-log-redaction-v1_2.test.js` impede retorno de campos pessoais nesses quatro registros e injeta erros fictícios contendo segredos para garantir que o sanitizador não os reproduza.

**Não houve alteração na lógica de Auth, credenciais, consulta de Firestore, cobrança, mapeamento de organizações ou persistência.** A mudança só afeta conteúdo do logging. O inventário de 150 fontes e 10 sinks do Gate 9.5B1 permanece uma aproximação; esta entrega não declara que todos os logs são seguros nem que registros históricos foram eliminados.

## O que ainda exige homologação operacional

- Autorização específica para testes negativos cross-org e certificados em `bjj-exams-staging`, usuários sintéticos com escopo e titularidade corretos, sem tocar produção `bjj-exams`.
- Revisão histórica e atual do **Cloud Logging**, sinks, permissões IAM, logs Firebase/Auth, exceções do provedor e políticas de acesso; não reproduzir CPF, tokens, e-mails, gabaritos, payloads financeiros ou identificadores nos relatórios.
- Política LGPD aprovada de finalidade, acesso, base legal e prazos de conservação: **RETENTION_UNAPPROVED**. Não aplicar TTL genérico a logs auditáveis, ledger, webhooks e transações.
- Reexecutar toda a regressão 133/133, Firebase Firestore Emulator, teste do webhook Asaas simulado e auditoria npm zero no HEAD exato antes do merge.
- O Gate 9.8A permanece `NO_GO` até as homologações reais, RPO/RTO, backup gerenciado, carga em staging e aceite humano.

**Marcadores:** `9.4C5=OFFLINE_IDOR_DOMAIN_CHECK`, `9.5B2=RUNTIME_LOG_CONTENT_MINIMIZED`, `NO_GO`, `NO_DEPLOY`, `RETENTION_UNAPPROVED`, `NO_ENFORCEMENT`.
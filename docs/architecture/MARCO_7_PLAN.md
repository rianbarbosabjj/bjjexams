# Marco 7 — Certificação Oficial de Exames de Faixa

## 1. Objetivo

Implementar a certificação canônica da jornada oficial de exames de
faixa da BJJ Exams v1.2.

O Marco 7 começa exatamente na fronteira deixada pelo Marco 6:

- `exam_results.outcome = passed`;
- `exam_results.certificateEligible = true`;
- `exam_registrations.status = passed`;
- `exam_registrations.certificateId = null`.

O Marco 7 termina com um certificado canônico persistido,
verificável publicamente e com a registration transitando de
`passed` para `certified`.

A certificação não promove automaticamente a faixa atual do aluno.

---

## 2. Princípios

1. Backend como única autoridade de emissão.
2. Resultado acadêmico do Marco 6 é imutável.
3. Um resultado aprovado produz no máximo um certificado canônico.
4. Retry de emissão precisa ser idempotente.
5. Browser não escreve certificado.
6. Browser não lê a collection canônica diretamente.
7. Gabarito e estado financeiro nunca entram no certificado.
8. Certificado emitido não é apagado.
9. Revogação é lifecycle do certificado, não reescrita do resultado.
10. Legado permanece isolado da fonte canônica.

---

## 3. Collection canônica

Collection:

`exam_certificates/{certificateId}`

A collection legada `certificados` não será reutilizada como fonte
canônica para exames oficiais v1.2.

### 3.1 Identidade

`certificateId` será determinístico a partir do `resultId`.

Contrato previsto:

`SHA-256("exam-certificate-v1:" + resultId)`

Consequências:

- mesma prova finalizada não produz dois certificados;
- retry converge para o mesmo documento;
- certificateId pode funcionar como código público de autenticidade;
- nenhuma sequência incremental é exposta.

---

## 4. Certificate document

Versão inicial:

`certificateVersion = 1`

### 4.1 Cadeia canônica

O certificado deve congelar:

- registrationId;
- resultId;
- attemptId;
- sessionId;
- organizationId;
- studentId;
- instructorId;
- templateId;
- templateVersionId;
- targetBelt.

### 4.2 Snapshot acadêmico

Também deve congelar:

- scoreBps;
- correctCount;
- totalQuestions;
- resultFinalizedAt.

O resultado não é recalculado durante a emissão.

### 4.3 Snapshot de apresentação

No momento da emissão serão congelados valores de apresentação
obtidos de fontes autoritativas:

- studentName;
- organizationName;
- instructorName.

Mudanças futuras nesses cadastros não reescrevem o certificado já
emitido.

### 4.4 Lifecycle

Campos previstos:

- status: `valid` ou `revoked`;
- issuedAt;
- issuedBy;
- revokedAt;
- revokedBy;
- revocationReason.

Campos do snapshot são imutáveis depois da criação.

---

## 5. Elegibilidade para emissão

Uma emissão canônica exige simultaneamente:

1. registration existe;
2. registration pertence ao ator autenticado;
3. registration.status é `passed`;
4. registration.resultId existe;
5. result existe;
6. result pertence à mesma registration;
7. result.studentId corresponde ao aluno;
8. result.sessionId corresponde à sessão;
9. result.organizationId corresponde à organização;
10. result.outcome é `passed`;
11. result.certificateEligible é `true`;
12. attempt/result/session/template formam a mesma cadeia canônica;
13. não existe estado `needs_reconciliation`.

Membership ativa não será exigida depois da aprovação.

O direito adquirido pelo resultado aprovado não depende da permanência
posterior do aluno na academia.

---

## 6. Operação de emissão

Callable planejada:

`emitirMeuCertificadoExameV12`

Entrada pública mínima:

- registrationId.

Não serão aceitos do browser:

- nota;
- faixa;
- nome;
- professor;
- organizationId;
- resultId;
- certificateId;
- status;
- timestamps.

Todos esses valores serão resolvidos server-side.

---

## 7. Transação de emissão

A criação do certificado e a certificação da registration precisam
ocorrer na mesma transação Firestore.

Sequência:

1. carregar registration;
2. carregar result;
3. carregar attempt;
4. carregar session;
5. carregar entidades necessárias aos snapshots;
6. validar cadeia canônica;
7. derivar certificateId;
8. verificar certificado existente;
9. criar `exam_certificates/{certificateId}`;
10. alterar registration:
   `passed -> certified`;
11. definir registration.certificateId;
12. criar audit log.

Se o certificado já existir e corresponder integralmente à mesma cadeia,
a operação retorna o certificado existente.

Se existir com identidade divergente, a operação falha fechada.

---

## 8. Registration domain

Será criada operação explícita:

`markRegistrationCertified`

Regras:

- origem obrigatória: `passed`;
- certificateId obrigatório;
- resultId deve ser preservado;
- attemptId deve ser preservado;
- orderId deve ser preservado;
- retry com o mesmo certificateId é idempotente;
- retry com certificateId diferente falha;
- `failed -> certified` é proibido;
- `submitted -> certified` é proibido;
- `needs_reconciliation -> certified` é proibido.

---

## 9. Resultado acadêmico

`exam_results` permanece imutável.

A emissão:

- não altera outcome;
- não altera score;
- não altera certificateEligible;
- não adiciona certificateId ao result;
- não recalcula respostas;
- não acessa gabarito.

A ligação canônica para o certificado fica na registration.

---

## 10. Faixa do aluno

O Marco 7 NÃO altera automaticamente:

- `usuarios.faixa_atual`;
- `alunos.faixa_atual`;
- qualquer estado equivalente de graduação.

Certificação comprova aprovação e emissão do documento.

Promoção de faixa é uma decisão de domínio separada.

---

## 11. Financeiro

A emissão não:

- cria cobrança;
- altera order;
- altera transaction;
- consome créditos de professor;
- chama Asaas;
- altera split;
- modifica snapshot financeiro.

Eventos financeiros tardios continuam usando
`needs_reconciliation` conforme contratos existentes.

---

## 12. Revogação

Certificados canônicos nunca serão apagados.

Lifecycle inicial:

`valid -> revoked`

Não haverá `revoked -> valid` na v1.

A revogação deverá:

- exigir permissão administrativa;
- registrar ator;
- registrar timestamp;
- exigir motivo;
- preservar todo snapshot original;
- gerar audit log.

Revogação não altera retroativamente o resultado acadêmico.

---

## 13. Verificação pública

Callable planejada:

`validarCertificadoExamePublicoV12`

Não exige autenticação.

Entrada:

- certificateId/código de autenticidade.

Resposta pública sanitizada:

- certificateId;
- status;
- studentName;
- targetBelt;
- organizationName;
- instructorName;
- scoreBps;
- correctCount;
- totalQuestions;
- issuedAt;
- revokedAt, quando aplicável.

Não serão expostos:

- studentId;
- CPF;
- e-mail;
- membershipId;
- orderId;
- transactionId;
- provider IDs;
- dados de split;
- answer key;
- templateVersionId;
- audit metadata interno.

---

## 14. Firestore Rules

A collection canônica terá bloqueio explícito para clientes:

`match /exam_certificates/{id}`

- direct read: false;
- direct create: false;
- direct update: false;
- direct delete: false.

A leitura pública acontecerá somente pela callable sanitizada.

Admin SDK permanece como única autoridade de persistência.

---

## 15. Compatibilidade legada

A collection `certificados` permanece como legado.

Não será migrada silenciosamente para `exam_certificates`.

Fluxos antigos podem continuar sendo consultados para certificados
históricos e certificados de curso enquanto sua migração específica
não ocorrer.

O Marco 7 não chamará o finalizador legado de exames.

Em particular, o Marco 7 não herdará do legado:

- alteração automática da faixa;
- criação client-side de certificado;
- estrutura de documento sem vínculo à registration/result canônicos.

---

## 16. `validar.html`

A evolução planejada será:

1. tentar validação canônica via
   `validarCertificadoExamePublicoV12`;
2. se não encontrado, consultar o legado BJJ Exams;
3. manter fallback BJJ Manager já existente.

A página não consultará `exam_certificates` diretamente.

---

## 17. Read model do aluno

Depois da emissão:

- examState passa a `certified`;
- resultado acadêmico permanece disponível;
- read model pode expor somente resumo sanitizado do certificado;
- IDs internos desnecessários não vão para o browser.

O aluno poderá gerar/baixar a representação visual a partir do snapshot
canônico sanitizado.

O PDF não será a fonte de verdade.

---

## 18. Auditabilidade

A emissão deverá registrar evento semelhante a:

`exam.certificate.issued`

A revogação deverá registrar:

`exam.certificate.revoked`

Audit logs não serão públicos.

---

## 19. Isolamento de ambiente

Durante o desenvolvimento do Marco 7:

- Functions canônicas permanecem staging/demo-emulator only;
- nenhum deploy em produção;
- nenhum acesso à produção;
- nenhuma abertura prematura de Firestore Rules em produção.

A habilitação em produção exigirá gate e autorização explícitos.

---

## 20. Gates planejados

### Gate 7.0
Baseline, branch e inventário.

### Gate 7.1
Domínio de certificado e transição `passed -> certified`.

### Gate 7.2
Service transacional de emissão + testes Emulator.

### Gate 7.3
Callable autenticada de emissão e read model do aluno.

### Gate 7.4
Verificação pública sanitizada + Rules.

### Gate 7.5
Revogação administrativa + auditoria.

### Gate 7.6
Frontend canônico e compatibilidade com `validar.html`.

### Gate 7.7
Deploy seletivo e smoke real em staging.

### Gate 7.8
Regressões finais, cleanup e fechamento técnico.

Nenhum merge em `develop-v1.2` ocorrerá sem autorização explícita.

---

## 21. Critérios mínimos de conclusão

1. passed elegível emite exatamente um certificado;
2. retry não duplica certificado;
3. failed não emite certificado;
4. submitted não emite certificado;
5. outro aluno não emite certificado alheio;
6. needs_reconciliation não emite certificado;
7. cadeia divergente falha fechada;
8. resultado não é modificado;
9. faixa atual do aluno não é modificada;
10. financeiro não é modificado;
11. créditos do professor não são consumidos;
12. browser não grava certificado;
13. browser não lê collection canônica diretamente;
14. validação pública não expõe IDs internos/sensíveis;
15. certificado válido é verificável;
16. certificado revogado continua verificável como revogado;
17. revogação não apaga snapshot;
18. legado continua consultável;
19. cursos não sofrem regressão;
20. Marco 6 não sofre regressão;
21. produção permanece intocada.
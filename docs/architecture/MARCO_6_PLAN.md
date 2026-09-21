# Marco 6 — Exames Oficiais v1.2

## 1. Objetivo

Implementar a execução canônica de exames oficiais de faixa sobre a
infraestrutura criada no Marco 5.7.

O Marco 6 começa somente após uma `exam_registration` canônica estar
autorizada pelo financeiro.

Produção permanece fora do escopo.

---

## 2. Baseline herdado do Marco 5.7

O Marco 6 reutiliza:

- `exam_sessions`;
- `exam_registrations`;
- seleção server-side;
- RBAC organizacional;
- membership canônica;
- `canApplyOfficialExam`;
- checkout individual `belt_exam`;
- confirmação financeira server-side;
- reversões e reconciliação financeira;
- read models sanitizados.

Não será criado um segundo fluxo de seleção, cobrança ou entitlement.

---

## 3. Legado identificado

O fluxo legado usa:

- `autorizacoes_exame`;
- `config_exames`;
- `questoes`;
- `tentativas_exame`;
- `resultados`;
- `certificados`;
- `creditos_professor`.

O runtime canônico do Marco 6 não poderá depender dessas collections.

Um exame `belt_exam` pago nunca poderá consumir `creditos_professor`.

O navegador nunca poderá:

- ler banco oficial de questões diretamente;
- receber gabarito;
- receber `correctAnswer`;
- receber `resposta_correta`;
- calcular nota oficial;
- criar resultado oficial;
- criar certificado oficial.

As estruturas legadas permanecem temporariamente apenas para
compatibilidade e migração controlada.

---

## 4. Invariantes de segurança

Um aluno só pode iniciar uma prova oficial quando:

- o usuário autenticado é o `studentId` da registration;
- a registration pertence à session correspondente;
- a registration está `authorized`;
- existe pagamento canônico confirmado;
- membership do aluno continua ativa;
- session não está `cancelled` ou `archived`;
- target belt da registration coincide com a session;
- session possui template canônico;
- session possui versão canônica fixada;
- a versão está válida para execução;
- não existe tentativa concorrente.

Uma registration possui no máximo uma tentativa oficial ativa.

Retry de rede nunca pode criar uma segunda tentativa.

Toda decisão acadêmica é server-side.

---

## 5. Templates canônicos

Collection principal:

`exam_templates/{templateId}`

Campos principais:

    name
    targetBelt
    status: draft | active | archived
    activeVersionId
    createdBy
    createdAt
    updatedAt

Cada template possui versões:

`exam_templates/{templateId}/versions/{versionId}`

Campos principais da versão:

    templateId
    version
    status: draft | active | retired
    timeLimitMinutes
    passingScoreBps
    questionCount
    questionIds
    source
    createdBy
    createdAt
    activatedAt

Uma versão ativa é imutável.

Mudança de conteúdo gera nova versão.

---

## 6. Snapshots de questões

Caminho:

`exam_templates/{templateId}/versions/{versionId}/questions/{questionId}`

Campos internos:

    prompt
    alternatives
    correctAnswer
    category
    difficulty
    media
    sourceQuestionId
    createdAt

Essa estrutura é server-only.

O navegador recebe apenas uma projeção sanitizada.

`correctAnswer` nunca atravessa a fronteira do backend.

Mudanças futuras no banco de autoria não podem modificar uma prova já
versionada.

---

## 7. Extensão de exam_sessions

`exam_sessions` será estendida de forma retrocompatível com:

    templateId: null
    templateVersionId: null

Sessões criadas no Marco 5.7 continuam válidas para seleção e financeiro.

Porém nenhuma prova oficial poderá iniciar sem:

- `templateId`;
- `templateVersionId`.

O vínculo entre sessão e versão deve ocorrer antes da primeira tentativa
oficial.

---

## 8. exam_attempts

Collection canônica server-only:

`exam_attempts/{attemptId}`

Contrato:

    registrationId
    sessionId
    organizationId
    studentId
    templateId
    templateVersionId
    orderedQuestionIds
    status: in_progress | submitted | invalidated
    startedAt
    expiresAt
    submittedAt
    resultId
    createdAt
    updatedAt

A tentativa pertence a exatamente uma registration.

A creation precisa ser idempotente.

O backend deve reutilizar uma tentativa ativa existente em caso de retry.

---

## 9. Início da prova

Callable:

`iniciarExameOficialV12`

Entrada mínima:

    registrationId

O backend deverá:

1. autenticar o aluno;
2. carregar registration;
3. carregar session;
4. confirmar relação registration/session;
5. revalidar membership;
6. exigir registration `authorized`;
7. validar organização;
8. validar target belt;
9. validar template e versão;
10. criar ou reutilizar attempt idempotente;
11. fixar a ordem das questões;
12. calcular `expiresAt`;
13. transicionar registration para `started`;
14. devolver somente questões sanitizadas.

O browser não escolhe:

- faixa;
- template;
- versão;
- tempo;
- nota mínima;
- questões;
- organização;
- instrutor.

---

## 10. Retomada da prova

Callable:

`obterTentativaExameOficialV12`

Permite retomar tentativa válida depois de:

- refresh;
- fechamento acidental;
- perda temporária de rede;
- nova abertura da tela.

A retomada não modifica prazo original.

Nunca devolve gabarito.

---

## 11. Finalização

Callable:

`finalizarExameOficialV12`

Entrada:

    attemptId
    answers

O backend deverá:

1. autenticar usuário;
2. confirmar proprietário da tentativa;
3. validar status;
4. validar expiração;
5. validar IDs das questões;
6. rejeitar IDs estranhos à tentativa;
7. ler o gabarito somente no backend;
8. calcular acertos;
9. calcular score em basis points;
10. criar resultado de maneira idempotente;
11. finalizar attempt;
12. transicionar registration;
13. persistir resultId;
14. devolver resultado sanitizado.

Respostas ausentes contam como incorretas.

Submit repetido não cria segundo resultado.

---

## 12. exam_results

Collection canônica:

`exam_results/{resultId}`

Campos:

    attemptId
    registrationId
    sessionId
    organizationId
    studentId
    templateId
    templateVersionId
    targetBelt
    scoreBps
    correctCount
    totalQuestions
    outcome: passed | failed
    reason
    certificateEligible
    finalizedAt
    resultVersion

Resultado canônico é imutável.

`resultId` deve ser determinístico pela tentativa ou possuir proteção
idempotente equivalente.

Browser não lê nem escreve essa collection diretamente.

---

## 13. Estados da registration

O fluxo acadêmico canônico será:

`authorized -> started -> submitted -> passed|failed`

`passed -> certified` pertence ao Marco 7.

Estados financeiros e acadêmicos não devem ser misturados.

A execução da prova não pode:

- criar cobrança;
- alterar split;
- consumir `creditos_professor`;
- reautorizar pagamento.

---

## 14. Certificados

Marco 6 não emite certificado canônico.

Quando aprovado, o resultado registra:

    certificateEligible: true

Quando reprovado:

    certificateEligible: false

O Marco 7 será responsável por:

- `passed -> certified`;
- emissão server-side;
- código público;
- QR;
- validação pública;
- revogação;
- substituição;
- auditoria.

A collection legada `certificados` não será fonte de verdade das novas
registrations canônicas.

---

## 15. Migração do legado

A migração de:

- `config_exames`;
- `questoes`;

para templates canônicos deve possuir:

- `--dry-run`;
- `--apply`;
- produção bloqueada por padrão;
- nenhum delete físico;
- IDs determinísticos;
- relatório de inconsistências;
- contagem antes/depois.

Configuração incompleta não poderá gerar versão ativa.

Questão inexistente não poderá ser ignorada silenciosamente.

Gabarito inválido impedirá ativação.

Runtime canônico não terá fallback para legado.

---

## 16. Compatibilidade

As callables legadas:

- `obterPreviaExame`;
- `iniciarExameSeguro`;
- `finalizarExameSeguro`;

não serão usadas pelo frontend canônico de exame de faixa.

Elas poderão permanecer temporariamente por compatibilidade histórica,
sem receber novas responsabilidades.

O novo runtime ficará em:

`functions/src/exams/`

Não haverá segunda implementação paralela em:

`functions/src/modules/exams/index.js`

---

## 17. Segurança Firestore

As collections abaixo serão server-only:

- `exam_templates`;
- versões de templates;
- snapshots das questões;
- `exam_sessions`;
- `exam_registrations`;
- `exam_attempts`;
- `exam_results`.

O browser consome somente callables e read models sanitizados.

Nenhuma Rule será aberta para fornecer gabaritos ao aluno.

---

## 18. Gates

Gate 0 — inventário e contrato arquitetural.

Gate 1 — templates, versões e snapshots.

Gate 2 — início e retomada server-side.

Gate 3 — submissão e correção server-side.

Gate 4 — resultados e read models.

Gate 5 — frontend canônico da prova.

Gate 6 — fronteira com certificados.

Gate 7 — staging e regressão completa.

---

## 19. Critérios de conclusão

Em staging:

1. registration `authorized` inicia exatamente uma tentativa;
2. retry de start não duplica tentativa;
3. outro aluno não acessa tentativa;
4. membership inativa bloqueia início;
5. aluno não selecionado não inicia;
6. session sem template não inicia;
7. gabarito nunca chega ao browser;
8. refresh retoma tentativa;
9. expiração é validada no servidor;
10. correção ocorre somente no servidor;
11. submit repetido não duplica resultado;
12. registration termina em `passed` ou `failed`;
13. resultado não altera financeiro;
14. `creditos_professor` permanece inalterado;
15. certificado canônico não é emitido prematuramente;
16. fluxo de cursos continua sem regressão;
17. financeiro continua sem regressão;
18. produção permanece intocada.

---

## 20. Fora de escopo

- deploy em produção;
- merge automático;
- proctoring definitivo;
- reconhecimento facial;
- gravação de vídeo;
- certificado público canônico;
- QR de certificado;
- revogação e substituição;
- painel operacional completo;
- go-live.

Qualquer ampliação de escopo exige novo gate e regressão.
---

## 21. Decisões complementares de consistência

### 21.1 Ciclo de vida da sessão

No Marco 6, `exam_sessions` continua representando o contêiner
organizacional e financeiro da aplicação do exame.

A execução individual é representada por:

- `exam_registrations`;
- `exam_attempts`;
- `exam_results`.

Não serão adicionados `in_progress` ou `completed` à sessão apenas para
espelhar o estado de um aluno.

Uma mesma sessão pode possuir registrations em diferentes estados.

O estado agregado da sessão poderá ser calculado futuramente por read
model, sem transformar a session em fonte de verdade da execução
individual.

### 21.2 Congelamento de template

`templateId` e `templateVersionId` devem ser fixados server-side antes
que qualquer registration da sessão entre em estado financeiro
`awaiting_payment` ou acadêmico/financeiro `authorized`.

Depois que existir registration vinculada a pagamento iniciado, a versão
da prova é imutável para aquela sessão.

Alterar o conteúdo exige nova versão e, quando necessário, nova sessão.

O browser nunca escolhe `templateId` ou `templateVersionId`.

### 21.3 Identidade determinística

A tentativa oficial será determinística por registration.

Regra conceitual:

    attemptId = hash("exam-attempt-v1:" + registrationId)

O resultado será determinístico por tentativa.

Regra conceitual:

    resultId = hash("exam-result-v1:" + attemptId)

Retries concorrentes devem convergir para os mesmos documentos.

Nenhum retry pode criar tentativa ou resultado duplicado.

### 21.4 Atomicidade

As transições críticas devem ocorrer por transaction Firestore.

Start deve tornar atômicos, quando aplicável:

- validação final da registration;
- criação/reutilização da attempt;
- vínculo `attemptId`;
- transição `authorized -> started`.

Submit deve tornar atômicos:

- validação final da attempt;
- criação/reutilização do result;
- encerramento da attempt;
- vínculo `resultId`;
- transições `started -> submitted -> passed|failed`.

Concorrência ou retry não pode deixar estados parcialmente aplicados.

### 21.5 Tempo

Autoridade temporal pertence ao servidor.

`startedAt`, `expiresAt`, `submittedAt` e `finalizedAt` devem ser
derivados de relógio server-side.

O timer do browser é apenas apresentação.

Manipulação do relógio local não modifica validade da tentativa.

### 21.6 Auditoria

As operações administrativas e acadêmicas relevantes devem produzir
`audit_logs` sanitizados.

No mínimo:

- `exam.template.created`;
- `exam.template.version.created`;
- `exam.template.version.activated`;
- `exam.session.template_bound`;
- `exam.attempt.started`;
- `exam.attempt.resumed`, quando útil operacionalmente;
- `exam.attempt.submitted`;
- `exam.result.created`.

Audit log nunca armazena:

- gabarito;
- respostas completas;
- secrets;
- provider IDs financeiros desnecessários.

### 21.7 Promoção de faixa

No Marco 6, aprovação acadêmica produz:

- registration `passed`;
- `exam_result` imutável;
- `certificateEligible=true`.

A correção da prova não altera automaticamente `faixa_atual` no perfil
do aluno.

A promoção de faixa deverá ocorrer por operação server-side específica,
idempotente e auditável, baseada em resultado canônico aprovado.

Essa separação evita que cálculo de nota produza efeitos colaterais
irreversíveis no cadastro acadêmico.

Até a definição dessa operação, `targetBelt` permanece snapshot da
registration/result e não substitui automaticamente a graduação atual.

### 21.8 RBAC de templates oficiais

Template oficial e versão ativa não podem ser publicados diretamente por
instrutor comum.

Ativação de versão oficial exige papel administrativo autorizado pela
plataforma.

Instrutores podem futuramente propor conteúdo por workflow específico,
mas proposta de questão não equivale a ativação de template oficial.

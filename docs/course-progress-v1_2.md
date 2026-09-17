# Progresso de cursos — BJJ Exams v1.2

## Escopo

Este documento define o contrato do Marco 4B.3 para progresso por aula e conclusão de curso sobre a fundação de matrícula/entitlement do 4B.1 e o consumo protegido do 4B.2.

O 4B.3 não implementa interface completa do aluno, cobrança, upload protegido de mídia ou regras de exame final.

## Princípios

- progresso só pode ser alterado por usuário autenticado com entitlement válido;
- o UID autenticado é a identidade autoritativa; `userId` nunca é aceito do cliente;
- a conclusão de uma aula é monotônica e idempotente;
- o cliente não lê nem escreve progresso diretamente no Firestore;
- o agregado do curso é atualizado na mesma transação da conclusão da aula;
- a conclusão integral do curso altera a matrícula canônica para `completed`;
- repetição da mesma operação não incrementa contadores, não recria progresso e não duplica auditoria;
- inconsistências de identidade, contagem ou revisão de conteúdo falham fechado;
- o modelo legado `matriculas` / `concluirAulaCurso` permanece isolado e não é fonte de verdade da v1.2.

## Modelo canônico

A matrícula continua em:

`enrollments/{enrollmentId}`

O detalhe por aula fica em subcoleção privada da própria matrícula:

`enrollments/{enrollmentId}/lesson_progress/{lessonId}`

O `enrollmentId` continua determinístico pelo contrato do 4B.1 a partir de `courseId + userId`.

### Agregado na matrícula

Além dos campos já existentes, a matrícula passa a materializar:

- `completedLessonCount`: quantidade de aulas concluídas;
- `progressPercent`: percentual agregado de 0 a 100;
- `progressContentRevision`: revisão do conteúdo usada pelo progresso;
- `status`: `active` enquanto incompleto e `completed` quando atingir 100%;
- `completedAt`: preenchido apenas na primeira conclusão integral;
- `updatedAt`: atualizado quando o progresso muda.

`progressPercent` permanece compatível com o contrato já exposto por `listarMeusCursosV12`.

### Documento de progresso por aula

Cada documento em `lesson_progress/{lessonId}` contém:

- `courseId`;
- `userId`;
- `lessonId`;
- `status='completed'`;
- `contentRevision`;
- `completedAt`;
- `updatedAt`.

O ID do documento é o próprio `lessonId`, tornando a conclusão naturalmente idempotente dentro de uma matrícula.

## Revisão de conteúdo

Cursos publicados não podem ter seu conteúdo editado no contrato atual da v1.2. Um curso publicado pode ser suspenso e republicado, mas não volta a `draft`.

Mesmo assim, o progresso grava `contentRevision` e `progressContentRevision` como defesa de integridade. Se a revisão persistida do progresso divergir da revisão atual do curso, a operação falha fechado em vez de misturar progresso de estruturas diferentes.

## Concluir aula

Callable:

`concluirAulaCursoV12`

Entrada:

- `courseId`;
- `lessonId`.

Fluxo obrigatório:

1. exigir autenticação;
2. carregar curso, matrícula determinística e aula canônica;
3. recalcular entitlement no backend;
4. validar que a aula pertence ao curso e referencia módulo existente;
5. validar contadores/revisão de conteúdo necessários ao agregado;
6. executar transação sobre matrícula e `lesson_progress/{lessonId}`;
7. se a aula já estiver concluída para a mesma identidade/revisão, retornar sucesso idempotente sem novo incremento;
8. se for nova conclusão, criar o progresso da aula e incrementar `completedLessonCount` exatamente uma vez;
9. recalcular `progressPercent`;
10. ao atingir todas as aulas, mudar a matrícula para `completed` e preencher `completedAt` uma única vez;
11. auditar somente mudanças efetivas.

A operação nunca aceita `progressPercent`, `completedLessonCount`, `status` ou `userId` enviados pelo cliente.

## Cálculo agregado

Para `totalLessonCount > 0`:

`progressPercent = round((completedLessonCount / totalLessonCount) * 100, 2)`

O percentual é limitado entre 0 e 100.

A matrícula só passa a `completed` quando `completedLessonCount === totalLessonCount`.

Se a contagem concluída ultrapassar o total persistido do curso, a operação falha como inconsistência de dados; ela não trunca silenciosamente o contador.

## Consulta de progresso

Callable:

`obterProgressoCursoV12`

Requisitos:

- autenticação;
- entitlement válido recalculado;
- matrícula canônica correspondente ao UID e curso.

Resposta sanitizada:

- `courseId`;
- `enrollmentId`;
- `status` da matrícula;
- `completedLessonCount`;
- `totalLessonCount`;
- `progressPercent`;
- `courseCompleted`;
- `completedAt`;
- `completedLessonIds`.

A consulta não entrega conteúdo de aula nem dados de outros usuários.

Como gate de integridade, a quantidade de documentos válidos de `lesson_progress` deve ser compatível com o agregado materializado na matrícula. Divergência falha fechado e exige correção administrativa, em vez de ser escondida do cliente.

## Concorrência e idempotência

A matrícula é o ponto de serialização do agregado. Conclusões concorrentes de aulas diferentes disputam a mesma matrícula e são reexecutadas pelo mecanismo transacional do Firestore.

Duas chamadas concorrentes para a mesma aula convergem para um único documento `lesson_progress/{lessonId}` e um único incremento do agregado.

A resposta diferencia:

- `changed=true`: nova conclusão persistida;
- `changed=false`: replay idempotente de uma aula já concluída.

## Auditoria

Uma nova conclusão gera evento de auditoria:

`course.progress.lesson.completed`

Quando a mesma transação conclui o curso pela primeira vez, também gera:

`course.progress.course.completed`

Replay idempotente não cria eventos adicionais.

Os eventos não carregam corpo da aula, URL de mídia, token de autenticação ou senha.

## Firestore Rules

`enrollments` e sua subcoleção `lesson_progress` permanecem sem leitura ou escrita direta pelo cliente.

A autorização e a mutação são exclusivamente server-side via Cloud Functions/Admin SDK.

## Compatibilidade com o legado

A função legada `concluirAulaCurso` e a coleção legada `matriculas` continuam existindo enquanto houver superfícies antigas que dependam delas.

O 4B.3 não faz dual-write para o legado. As novas superfícies da v1.2 devem consumir apenas `enrollments` e as callables V12. Isso evita duas fontes concorrentes de verdade.

## Fora do 4B.3

- interface visual completa do aluno;
- marcar aula como não concluída;
- progresso parcial por tempo assistido, posição de vídeo ou percentual dentro da aula;
- sincronização offline;
- migração automática do progresso legado;
- emissão de certificado;
- desbloqueio de exame final;
- checkout, cobrança e Asaas;
- qualquer ação em produção.

## Próximo marco

### 4B.4 — Interface do aluno

Consumirá `listarMeusCursosV12`, as APIs protegidas do 4B.2 e as APIs de progresso do 4B.3 para montar Meus Cursos, navegação por módulos/aulas e progresso visual.
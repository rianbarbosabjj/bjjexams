# Cursos MVP — BJJ Exams v1.2

## Objetivo

Entregar rapidamente uma versão visual e funcional do domínio de cursos,
sem antecipar riscos do financeiro ou dos exames oficiais.

O MVP deve permitir cadastrar cursos reais, preparar catálogo público,
demonstrar a plataforma e iniciar piloto com instrutores e alunos.

## Fonte canônica

Novos cursos utilizam:

`courses/{courseId}`

O legado `cursos_teoricos` permanece apenas durante a transição e não deve
ser usado como fonte de verdade da v1.2.

## Marco 4A — Cadastro e divulgação

### 4A.1 Fundação do domínio

- modelo canônico de curso;
- enums e invariantes;
- preço em centavos;
- workflow de publicação;
- visão pública sanitizada;
- testes unitários.

### 4A.2 Backend de administração

Callables server-side para:

- criar curso draft;
- editar curso;
- listar cursos administráveis;
- enviar para review;
- publicar/suspender/arquivar conforme RBAC.

Escrita direta do cliente em `courses` deve permanecer bloqueada.

### 4A.3 Catálogo público

- listar apenas cursos `published`;
- somente `visibility=platform` no catálogo aberto;
- detalhe público sanitizado;
- não expor conteúdo de aula, regras financeiras ou IDs internos desnecessários.

### 4A.4 Interface visual

Criar telas v1.2 para:

- Cursos no Painel Operacional;
- Meus Cursos no Painel do Instrutor;
- formulário de cadastro/edição;
- catálogo público;
- página pública do curso.

Neste ponto já será possível cadastrar cursos reais e iniciar divulgação.

### 4A.5 Conteúdo

Estrutura canônica persistida:

`courses/{courseId}/modules/{moduleId}`

`courses/{courseId}/lessons/{lessonId}`

Cada aula referencia seu módulo por `moduleId`.

Conteúdo pago nunca é entregue publicamente.

## Marco 4B — Matrículas e consumo

### 4B.1 Fundação de matrícula e entitlement

Entregue no backend v1.2:

- coleção canônica `enrollments`;
- matrícula gratuita idempotente;
- ID determinístico por `courseId + userId`;
- validação de curso publicado e gratuito;
- curso de organização exige membership ativo da mesma organização e do mesmo usuário;
- curso privado não aceita auto matrícula gratuita;
- curso pago não recebe entitlement gratuito;
- callable autenticada de consulta de entitlement;
- backend de Meus Cursos;
- `enrollments` fechado para leitura e escrita direta do cliente;
- auditoria da criação de matrícula;
- nenhuma entrega de módulos ou aulas nesta etapa.

Contrato detalhado:

`docs/course-enrollment-entitlement-v1_2.md`

### 4B.2 Consumo protegido

Contrato do incremento:

- estrutura do curso entregue somente a usuário autenticado com entitlement válido recalculado no backend;
- estrutura contém metadados de módulos e aulas, mas nunca `body`, `videoUrl` ou `documentUrl`;
- payload integral é entregue somente pela leitura individual de uma aula;
- leitura individual exige entitlement válido, exceto preview explicitamente permitido;
- preview sem entitlement somente para curso `published`, `visibility=platform` e aula `isPreview=true`;
- cursos `organization` e `private` não possuem preview público nesta etapa;
- aula órfã de módulo falha fechado;
- `courses`, `modules`, `lessons` e `enrollments` continuam sem leitura direta pelo cliente;
- URLs externas continuam sujeitas à política de proteção do provedor de mídia. Tokenização ou URL assinada pertence a um hardening posterior quando houver armazenamento controlado pela plataforma.

Contrato detalhado:

`docs/course-protected-consumption-v1_2.md`

### 4B.3 Progresso

Contrato do incremento:

- progresso por aula persistido em `enrollments/{enrollmentId}/lesson_progress/{lessonId}`;
- atualização idempotente e monotônica, sem duplicar contadores ou auditoria;
- UID autenticado e entitlement recalculado no backend antes de qualquer mutação;
- agregado materializado na matrícula com `completedLessonCount`, `progressPercent` e `progressContentRevision`;
- conclusão integral altera a matrícula para `status=completed` e preenche `completedAt` uma única vez;
- concorrência serializada pela matrícula em transação Firestore;
- revisão de conteúdo registrada no progresso para impedir mistura de estruturas divergentes;
- consulta sanitizada de progresso por callable;
- `lesson_progress` sem leitura ou escrita direta pelo cliente;
- legado `matriculas` / `concluirAulaCurso` sem dual-write na v1.2.

Contrato detalhado:

`docs/course-progress-v1_2.md`

### 4B.4 Interface do aluno

Contrato do incremento:

- `Meus Cursos` usa exclusivamente `listarMeusCursosV12`;
- estrutura navegável usa `obterEstruturaConsumoCursoV12`;
- conteúdo integral é carregado por aula com `obterAulaConsumoCursoV12`;
- progresso visual usa `obterProgressoCursoV12` e o agregado retornado pelo backend;
- conclusão usa somente `concluirAulaCursoV12`, sem incremento ou persistência manual no navegador;
- Firebase Auth fornece o ID token das callables privadas e o UID não é aceito da UI;
- cliente não acessa diretamente `courses`, `enrollments`, `lesson_progress` ou `matriculas` para a nova experiência;
- primeira aula sugerida é a primeira ainda não concluída segundo a ordem canônica;
- estados de loading, vazio, acesso revogado, conteúdo indisponível, erro de rede e curso concluído são explícitos;
- ambiente desconhecido/desenvolvimento aponta para staging e a API privada bloqueia produção fora dos hosts oficiais;
- a superfície legada de Academia Digital/LMS será substituída sem dual-write.

Contrato detalhado:

`docs/course-student-ui-v1_2.md`

## Fora dos Marcos 4A/4B

Não implementar nesta etapa:

- cobrança real;
- split;
- webhook financeiro;
- estorno;
- chargeback;
- venda em produção.

Esses itens pertencem ao Marco 5.

## Compatibilidade

A página legada `cursos.html`, a collection `cursos_teoricos` e a collection legada `matriculas` não definem
o novo contrato da v1.2.

Nenhuma alteração dos Marcos 4A/4B deve exigir escrita em produção.

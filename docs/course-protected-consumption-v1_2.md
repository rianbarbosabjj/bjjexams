# Consumo protegido de cursos — BJJ Exams v1.2

## Escopo

Este documento descreve o contrato do Marco 4B.2 para entrega protegida de módulos e aulas ao aluno.

O 4B.2 depende do entitlement entregue no 4B.1. Ele não implementa cobrança, matrícula paga, progresso por aula ou interface completa do aluno.

## Modelo canônico de conteúdo

A persistência v1.2 usa:

`courses/{courseId}`

`courses/{courseId}/modules/{moduleId}`

`courses/{courseId}/lessons/{lessonId}`

Cada aula contém `moduleId` apontando para o módulo correspondente.

O caminho aninhado `modules/{moduleId}/lessons/{lessonId}` não é a fonte de verdade do conteúdo v1.2.

## Princípios de segurança

- o cliente não lê `courses`, `modules`, `lessons` ou `enrollments` diretamente;
- entitlement é recalculado no backend em cada operação protegida;
- a estrutura do curso nunca transporta `body`, `videoUrl` ou `documentUrl`;
- o payload integral de uma aula é retornado somente na leitura individual;
- inconsistência estrutural falha fechado;
- curso não publicado não pode ser consumido por entitlement;
- preview não concede matrícula nem cria entitlement.

## Estrutura protegida

Callable:

`obterEstruturaConsumoCursoV12`

Requisitos:

- usuário autenticado;
- curso existente;
- entitlement válido para o `courseId` e o UID autenticado.

O backend recalcula o entitlement consultando a matrícula canônica e, quando necessário, o membership institucional atual.

A resposta contém:

- visão sanitizada do curso;
- `contentRevision` e contadores;
- módulos ordenados;
- metadados das aulas de cada módulo.

A estrutura de aula contém somente:

- `id`;
- `moduleId`;
- `title`;
- `description`;
- `position`;
- `contentType`;
- `durationMinutes`;
- `isPreview`.

Ela não contém corpo textual, URL de vídeo ou URL de documento.

## Leitura individual de aula

Callable:

`obterAulaConsumoCursoV12`

A operação lê uma única aula por `courseId + lessonId`.

Quando o usuário possui entitlement válido, a resposta usa:

`accessMode='entitled'`

O payload integral é então entregue de acordo com `contentType`:

- `video`: `videoUrl`;
- `text`: `body`;
- `document`: `documentUrl`.

Campos incompatíveis com o tipo permanecem `null` pela normalização canônica de conteúdo.

A aula também precisa referenciar um módulo persistido. Aula órfã não é entregue.

## Preview público

A mesma callable de leitura individual pode entregar uma aula sem entitlement somente quando todas as condições abaixo forem verdadeiras:

- curso `status='published'`;
- curso `visibility='platform'`;
- aula `isPreview=true`.

Nesse caso:

`accessMode='preview'`

O preview pode ser usado por usuário não autenticado.

Não há preview público para cursos `organization` ou `private` nesta etapa, mesmo que uma aula esteja marcada como `isPreview=true`.

Aulas não marcadas como preview retornam indisponibilidade genérica quando não existe entitlement válido, evitando revelar conteúdo protegido.

## Relação com entitlement

O 4B.2 reutiliza o resolver canônico do 4B.1.

Para consumo integral, continuam valendo as mesmas condições:

- curso publicado;
- matrícula válida;
- matrícula `active` ou `completed`;
- identidade documental correspondente ao curso e usuário autenticados;
- membership institucional ativo e compatível para curso de organização;
- fonte compatível com acesso pago ou privado quando aplicável.

Revogação de membership institucional revoga o consumo protegido sem apagar a matrícula.

## Firestore Rules

A autorização do aluno não é implementada em Firestore Rules.

O cliente chama Cloud Functions e o Admin SDK faz as leituras após a autorização server-side.

As coleções canônicas permanecem fechadas para leitura e escrita direta do cliente.

## Proteção de mídia

O 4B.2 controla quando a aplicação entrega uma URL persistida, mas não transforma automaticamente uma URL externa em mídia privada.

Se `videoUrl` ou `documentUrl` apontarem para um provedor com URL pública permanente, o recurso continua compartilhável fora da aplicação depois de conhecido.

Para proteção forte de mídia, a plataforma deverá adotar armazenamento controlado com URL assinada de curta duração, streaming tokenizado ou mecanismo equivalente. Esse hardening deve ser implementado junto da camada de upload/armazenamento, sem alterar o contrato de entitlement.

## Fora do 4B.2

- progresso por aula;
- conclusão do curso;
- interface visual completa do aluno;
- download offline;
- DRM;
- URL assinada de mídia;
- cobrança, Asaas e webhook financeiro;
- matrícula paga originada de `order`.

## Próximos marcos

### 4B.3 — Progresso

Persistir estado por aula, atualização idempotente, agregado percentual e conclusão do curso.

### 4B.4 — Interface do aluno

Construir Meus Cursos, navegação por módulos, abertura de aula e progresso visual sobre as APIs protegidas.

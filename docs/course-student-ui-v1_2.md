# Interface do aluno para cursos — BJJ Exams v1.2

## Escopo

Este documento define o contrato do Marco 4B.4 para a experiência do aluno em cursos, construída exclusivamente sobre as APIs canônicas dos Marcos 4B.1, 4B.2 e 4B.3.

O 4B.4 substitui, nas novas superfícies v1.2, o consumo legado baseado em `matriculas`, leitura direta de cursos/aulas no Firestore e cálculo de progresso no navegador.

## Princípios

- a UI nunca lê ou escreve diretamente `courses`, `enrollments` ou `lesson_progress`;
- a identidade do aluno vem do Firebase Auth e o UID nunca é enviado como parâmetro de negócio;
- toda chamada autenticada envia o ID token atual no header `Authorization`;
- entitlement é sempre recalculado pelo backend;
- progresso exibido vem de `listarMeusCursosV12` e `obterProgressoCursoV12`;
- conclusão de aula usa somente `concluirAulaCursoV12`;
- estrutura e conteúdo são consumidos pelas APIs protegidas do 4B.2;
- a UI não mantém uma segunda fonte persistente de progresso;
- respostas de erro de domínio devem ser tratadas sem expor detalhes internos;
- hosts desconhecidos e desenvolvimento local apontam para staging por padrão;
- nenhuma etapa do 4B.4 exige escrita em produção.

## Superfícies

### Meus Cursos

A listagem do aluno usa:

`listarMeusCursosV12`

Cada item deve apresentar, no mínimo:

- título;
- descrição resumida quando disponível;
- status da matrícula;
- percentual de progresso;
- estado de acesso atual;
- ação de continuar curso quando o entitlement estiver ativo.

A listagem não consulta a coleção legada `matriculas`.

### Sala de aula

A estrutura navegável usa:

`obterEstruturaConsumoCursoV12`

A resposta contém apenas a estrutura sanitizada de módulos e aulas. Conteúdo integral da aula não deve ser pré-carregado em lote.

Ao selecionar uma aula, a UI chama:

`obterAulaConsumoCursoV12`

Somente essa resposta pode alimentar o player/texto/documento da aula selecionada.

### Progresso

Ao abrir o curso, a UI consulta:

`obterProgressoCursoV12`

O estado visual é derivado de:

- `completedLessonIds`;
- `completedLessonCount`;
- `totalLessonCount`;
- `progressPercent`;
- `courseCompleted`;
- `completedAt`.

Para concluir uma aula:

`concluirAulaCursoV12`

Após sucesso, a UI utiliza o progresso retornado e/ou refaz `obterProgressoCursoV12`. Nenhuma contagem é incrementada manualmente no navegador.

## Navegação

A primeira aula sugerida deve ser:

1. a primeira aula ainda não concluída na ordem canônica da estrutura;
2. se todas estiverem concluídas, a primeira aula do curso;
3. se o curso não tiver aulas, exibir estado vazio sem tentar abrir conteúdo.

A navegação anterior/próxima usa a ordem entregue pelo backend.

## Estados de interface

A UI deve representar explicitamente:

- carregando;
- sem cursos;
- curso sem aulas;
- acesso revogado/entitlement inválido;
- conteúdo indisponível;
- progresso normal;
- curso concluído;
- erro de rede com possibilidade de tentar novamente.

Falhas de autorização não devem ser convertidas em acesso parcial silencioso.

## Segurança

A UI v1.2 não deve:

- chamar `getDoc`, `getDocs`, `addDoc`, `setDoc` ou `updateDoc` para progresso ou conteúdo de cursos;
- utilizar `matriculasAluno`, `aulas_concluidas` ou `progresso` do modelo legado como fonte da interface nova;
- aceitar `userId` vindo de query string, localStorage ou formulário;
- armazenar ID token em localStorage;
- renderizar HTML remoto sem sanitização quando o campo for destinado a texto simples;
- liberar conteúdo com base apenas no estado visual do cliente.

## Ambiente

A UI deve seguir o runtime seguro já existente em `js/firebase-runtime-v1_2.js`:

- produção apenas nos hosts oficiais de produção;
- staging nos hosts oficiais de staging;
- localhost e hosts desconhecidos falham para staging;
- configuração local de staging não é versionada.

## Compatibilidade com legado

`painel_aluno.html` possui atualmente uma implementação legada de Academia Digital/LMS baseada em `matriculas` e escrita direta de progresso. Durante o 4B.4 essa superfície será substituída pela implementação v1.2.

`sala_aula.html` também é legado e não constitui contrato da v1.2 enquanto consumir Firestore diretamente.

Não haverá dual-write entre a UI nova e `matriculas`.

## Fora do 4B.4

- checkout real e Asaas;
- split financeiro;
- emissão automática de certificado;
- exame final;
- progresso parcial de vídeo;
- sincronização offline;
- download protegido de mídia;
- migração automática do histórico legado;
- qualquer deploy em produção.

## Gates do marco

Antes da integração em `develop-v1.2`, o 4B.4 deve provar:

- cliente API só chama funções permitidas;
- chamadas privadas exigem token;
- ambiente desconhecido não aponta para produção;
- Meus Cursos não lê `matriculas`;
- player não lê conteúdo direto do Firestore;
- conclusão de aula chama `concluirAulaCursoV12`;
- progresso visual reflete o backend e é idempotente;
- logout/usuário ausente bloqueia a superfície privada;
- fluxo real validado em `bjj-exams-staging`;
- produção não acessada.

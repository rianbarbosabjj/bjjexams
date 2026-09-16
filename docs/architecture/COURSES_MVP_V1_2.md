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

Estrutura:

`courses/{courseId}/modules/{moduleId}`

`courses/{courseId}/modules/{moduleId}/lessons/{lessonId}`

Conteúdo pago nunca é entregue publicamente.

## Marco 4B — Matrículas e consumo

- matrícula gratuita;
- `enrollments`;
- Meus Cursos do aluno;
- controle de entitlement;
- progresso;
- consumo protegido de aulas.

## Fora do Marco 4A

Não implementar nesta etapa:

- cobrança real;
- split;
- webhook financeiro;
- estorno;
- chargeback;
- venda em produção.

Esses itens pertencem ao Marco 5.

## Compatibilidade

A página legada `cursos.html` e a collection `cursos_teoricos` não definem
o novo contrato da v1.2.

Nenhuma alteração do Marco 4A deve exigir escrita em produção.
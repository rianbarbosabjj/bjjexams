# BJJ Exams v1.2 — Conteúdo canônico de cursos

## Marco 4A.5a

Este incremento cria a camada canônica de módulos e aulas dos cursos sem reutilizar a coleção legada `cursos_teoricos`.

## Extensão do Marco 4A.5b

O Marco 4A.5b adiciona a interface visual de autoria para instrutores e a reordenação atômica de módulos e aulas. A reordenação troca duas posições em uma única transação, incrementa `contentRevision` uma única vez e registra uma única auditoria por operação.

## Modelo

```text
courses/{courseId}
  contentRevision
  moduleCount
  lessonCount
  estimatedDurationMinutes
  contentUpdatedAt

courses/{courseId}/modules/{moduleId}
  title
  description
  position
  lessonCount
  createdAt
  updatedAt

courses/{courseId}/lessons/{lessonId}
  moduleId
  title
  description
  position
  contentType
  durationMinutes
  isPreview
  videoUrl
  body
  documentUrl
  createdAt
  updatedAt
```

## Tipos de aula

- `video`: exige `videoUrl` HTTPS;
- `text`: exige `body`;
- `document`: exige `documentUrl` HTTPS.

Campos incompatíveis com o tipo escolhido são normalizados para `null` antes da persistência.

## Segurança

Toda operação exige autenticação.

Para cursos de instrutor (`ownerType=user`), somente o proprietário do curso pode editar conteúdo. Para cursos da plataforma (`ownerType=platform`), a edição exige papel global de moderação. Nenhuma mutação é permitida fora do estado `draft`.

A leitura administrativa do conteúdo é permitida ao proprietário ou a moderadores globais, preparando a integração futura com a revisão humana.

O frontend não escreve diretamente em Firestore. Toda alteração passa por Functions canônicas.

## Consistência

Cada mutação de módulo ou aula incrementa `contentRevision` no documento do curso dentro da mesma transação que altera o conteúdo.

O curso mantém contadores denormalizados:

- `moduleCount`;
- `lessonCount`;
- `estimatedDurationMinutes`.

Cada módulo mantém `lessonCount`. Um módulo não pode ser excluído enquanto possuir aulas. Ao mover uma aula entre módulos, os dois contadores são atualizados na mesma transação.

A reordenação de módulos e aulas usa `reordenarConteudoCursoV12`. A callable lê os dois itens na mesma transação, valida as posições atuais e faz a troca atômica. Para aulas, os dois itens precisam pertencer ao mesmo módulo. A operação incrementa `contentRevision` exatamente uma vez.

Essa revisão será incorporada ao fingerprint de publicação no próximo incremento, impedindo que o conteúdo seja alterado depois da triagem sem uma nova submissão.

## Auditoria

As mutações registram eventos em `audit_logs`:

- `course.content.module.created`;
- `course.content.module.updated`;
- `course.content.module.deleted`;
- `course.content.module.reordered`;
- `course.content.lesson.created`;
- `course.content.lesson.updated`;
- `course.content.lesson.deleted`;
- `course.content.lesson.reordered`.

O evento preserva ator, papel, entidade, estado anterior, estado posterior e `contentRevision` resultante. Na reordenação, a auditoria registra as duas posições antes e depois da troca.

## Functions canônicas de conteúdo após o Marco 4A.5b

- `listarConteudoCursoV12`;
- `reordenarConteudoCursoV12`;
- `criarModuloCursoV12`;
- `atualizarModuloCursoV12`;
- `excluirModuloCursoV12`;
- `criarAulaCursoV12`;
- `atualizarAulaCursoV12`;
- `excluirAulaCursoV12`.

## Interface do Marco 4A.5b

O estúdio visual permite:

- criar, editar e excluir módulos;
- criar, editar e excluir aulas;
- mover aulas entre módulos;
- reordenar módulos e aulas por setas usando a callable atômica;
- trabalhar com aulas `video`, `text` e `document`;
- acompanhar `moduleCount`, `lessonCount`, `estimatedDurationMinutes` e `contentRevision`.

## Fora deste incremento

- reordenação por drag-and-drop ou operação em lote;
- incorporação de textos estruturais na triagem Gemini e fingerprint de publicação (4A.5c);
- acesso integral do aluno, matrícula e entitlement (4B);
- upload/armazenamento de mídia;
- migração automática de `cursos_teoricos`.

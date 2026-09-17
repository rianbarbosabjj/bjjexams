# BJJ Exams v1.2 — Conteúdo canônico de cursos

## Marco 4A.5a

Este incremento cria a camada canônica de módulos e aulas dos cursos sem reutilizar a coleção legada `cursos_teoricos`.

## Extensão do Marco 4A.5b

O Marco 4A.5b adiciona a interface visual de autoria para instrutores e a reordenação atômica de módulos e aulas. A reordenação troca duas posições em uma única transação, incrementa `contentRevision` uma única vez e registra uma única auditoria por operação.

## Extensão do Marco 4A.5c

O Marco 4A.5c vincula a estrutura canônica do curso ao fluxo de publicação. Antes da triagem, o backend lê o curso, seus módulos e suas aulas na mesma transação, monta um snapshot canônico versionado e calcula um fingerprint SHA-256 determinístico.

O fingerprint inclui os metadados publicáveis do curso e a estrutura persistida de módulos e aulas, inclusive ordem, duração, prévia, URLs e corpo de aulas textuais. Timestamps e contadores denormalizados não participam do hash.

A submissão registra `contentHash`, `contentHashVersion` e `contentRevision`. Antes da conclusão da triagem automática, o backend recalcula o estado estrutural e exige correspondência integral com o snapshot submetido. Uma publicação por override humano também é bloqueada quando o conteúdo atual não corresponde à versão triada.

A triagem Gemini não recebe o snapshot integral. O payload externo é minimizado e contém apenas título/descrição do curso, títulos/descrições de módulos e aulas e `contentType`. Identificadores, preço, URLs e corpo integral de aulas textuais permanecem fora desse payload.

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

`contentRevision` agora também integra a identidade da versão submetida à moderação. O fingerprint estrutural e a revisão precisam continuar correspondendo à versão triada antes de uma publicação automática ou por override humano.

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

A submissão e a decisão de moderação registram no snapshot auditável o hash estrutural, sua versão, `contentRevision` e a versão do escopo de moderação.

## Functions canônicas de conteúdo após o Marco 4A.5b

- `listarConteudoCursoV12`;
- `reordenarConteudoCursoV12`;
- `criarModuloCursoV12`;
- `atualizarModuloCursoV12`;
- `excluirModuloCursoV12`;
- `criarAulaCursoV12`;
- `atualizarAulaCursoV12`;
- `excluirAulaCursoV12`.

O Marco 4A.5c não adiciona nova callable pública de conteúdo; ele endurece `solicitarPublicacaoCursoV12` e `registrarDecisaoModeracaoV12` no backend de moderação.

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
- transcrição de vídeos;
- extração do conteúdo interno de documentos/PDFs;
- análise de imagens;
- acesso integral do aluno, matrícula e entitlement (4B);
- upload/armazenamento de mídia;
- migração automática de `cursos_teoricos`.

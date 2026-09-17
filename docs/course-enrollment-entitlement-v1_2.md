# Matrícula e entitlement de cursos — BJJ Exams v1.2

## Escopo

Este documento descreve o contrato entregue no Marco 4B.1 para matrícula e autorização de acesso a cursos.

O 4B.1 cria a fundação de autorização, mas **não entrega o conteúdo de módulos ou aulas**. O consumo protegido pertence ao 4B.2, o progresso por aula ao 4B.3 e a interface completa do aluno ao 4B.4.

Cobrança real, Asaas, webhooks financeiros e criação de matrícula paga permanecem no Marco 5.

## Fonte de verdade

A coleção canônica é:

`enrollments/{enrollmentId}`

A coleção legada `matriculas` não define o contrato da v1.2.

O `enrollmentId` é determinístico e versionado a partir do par `courseId + userId`. Isso garante uma única identidade documental para a relação entre aluno e curso e torna a matrícula gratuita idempotente.

## Contrato da matrícula

```js
{
  courseId,
  userId,
  source: 'free' | 'order' | 'admin_grant',
  orderId: null,
  status: 'active' | 'completed' | 'cancelled' | 'refunded',
  progressPercent,
  startedAt,
  completedAt,
  createdAt,
  updatedAt
}
```

Regras principais:

- `source='order'` exige `orderId`;
- `orderId` não é aceito para outras fontes;
- `progressPercent` permanece entre 0 e 100;
- matrícula `cancelled` ou `refunded` não é reativada automaticamente;
- uma matrícula existente `active` ou `completed` torna nova solicitação gratuita idempotente;
- o documento precisa permanecer vinculado ao mesmo `courseId` e `userId` esperados.

## Matrícula gratuita

Callable:

`matricularCursoGratuitoV12`

A matrícula gratuita exige usuário autenticado e curso publicado.

### `visibility='platform'`

Pode receber auto matrícula quando o curso for gratuito.

### `visibility='organization'`

Além de ser gratuito e publicado, exige vínculo institucional ativo do mesmo usuário com a mesma organização do curso.

Durante a transição v1.2, o backend consulta `vinculos_organizacao` e normaliza os campos legados por meio do domínio de memberships.

### `visibility='private'`

Não aceita auto matrícula gratuita. O acesso exige concessão explícita futura (`admin_grant` ou fluxo compatível).

### Curso pago

Curso com `isPaid=true` ou preço maior que zero não recebe matrícula gratuita. O 4B.1 não cria matrícula `order`.

## Entitlement

Callable:

`obterEntitlementCursoV12`

O entitlement é calculado no backend a cada consulta. Não é um booleano permanente confiado ao cliente.

Para conceder acesso, o resolver exige simultaneamente:

- curso em `published`;
- matrícula existente e válida;
- matrícula em `active` ou `completed`;
- matrícula vinculada ao `courseId` e `userId` autenticados;
- para curso de organização, membership ativo do mesmo usuário na mesma organização;
- para curso privado, fonte explícita `order` ou `admin_grant`;
- para curso pago, fonte `order` ou `admin_grant`.

Consequências importantes:

- curso suspenso, arquivado, em revisão ou rascunho não concede entitlement;
- encerramento do vínculo institucional revoga o entitlement de curso da organização sem apagar a matrícula;
- matrícula cancelada ou reembolsada não concede acesso;
- inconsistência de identidade falha fechado.

## Meus Cursos

Callable:

`listarMeusCursosV12`

A consulta usa exclusivamente matrículas cujo `userId` corresponde ao usuário autenticado.

A resposta contém visão sanitizada do curso, matrícula e resultado atual do entitlement. Não contém módulos, aulas, corpo textual, URL de vídeo ou URL de documento.

Limite operacional do 4B.1: até 100 matrículas por consulta. Paginação fica para incremento posterior caso seja necessária antes do go-live.

## Segurança

`enrollments` permanece `deny by default` nas Firestore Rules:

```text
match /enrollments/{enrollmentId} {
  allow read, write: if false;
}
```

Toda leitura e escrita do domínio passa por Cloud Functions com Admin SDK.

O frontend não deve usar Firestore diretamente para descobrir matrícula ou entitlement.

O 4B.1 também mantém `courses`, módulos, aulas e `vinculos_organizacao` fora do acesso direto necessário a esse fluxo.

## Auditoria

A criação de uma matrícula gratuita gera `audit_logs` server-side com:

- `action='course.enrollment.created'`;
- `entityType='enrollment'`;
- ator autenticado;
- snapshot mínimo de `courseId`, `userId`, `source` e `status`;
- timestamp server-side.

Chamadas idempotentes que reutilizam matrícula já ativa/concluída não criam uma segunda matrícula.

## Callables entregues no 4B.1

- `matricularCursoGratuitoV12`;
- `obterEntitlementCursoV12`;
- `listarMeusCursosV12`.

## Staging

O smoke do Marco 4B.1 valida contra `bjj-exams-staging`:

- criação de matrícula gratuita;
- idempotência;
- consulta de entitlement;
- listagem em Meus Cursos;
- bloqueio de matrícula gratuita para curso pago;
- bloqueio de curso de organização sem membership;
- matrícula de organização com membership ativo;
- revogação após encerramento do membership;
- bloqueio de leitura direta do documento em `enrollments`;
- auditoria da matrícula;
- cleanup com verificação de ownership dos dados temporários;
- bloqueio explícito de acesso ao projeto de produção.

Nenhuma ação em produção faz parte do Marco 4B.1.

## Próximos marcos

### 4B.2 — Consumo protegido

Entregar módulos e aulas somente após validação server-side de entitlement, incluindo regras de preview.

### 4B.3 — Progresso

Persistir progresso por aula, cálculo agregado e conclusão de curso com operações idempotentes.

### 4B.4 — Interface do aluno

Construir Meus Cursos e experiência de consumo sobre as APIs protegidas.

### Marco 5 — Financeiro

Somente o fluxo financeiro poderá criar entitlement pago originado de `order`, após confirmação financeira idempotente e regras de estorno/chargeback.

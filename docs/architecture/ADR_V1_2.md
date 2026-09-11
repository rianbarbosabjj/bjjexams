# Architecture Decision Records — BJJ Exams v1.2

## ADR-001 — Usuário é a raiz da identidade
**Status:** Aceito

Um UID do Firebase Auth corresponde a uma identidade canônica em `users/{uid}`. Perfis não serão duplicados em collections independentes por papel.

## ADR-002 — Academia é organização opcional
**Status:** Aceito

Academia não é requisito para usar cursos públicos. Vínculos são modelados separadamente.

## ADR-003 — Exames oficiais exigem organização
**Status:** Aceito

Sessão de exame pertence a uma academia/organização e só aceita alunos com vínculo ativo selecionados por professor autorizado.

## ADR-004 — Cursos suportam dois escopos principais
**Status:** Aceito

- `platform`: disponível a todos os usuários elegíveis;
- `organization`: exclusivo a membros ativos da organização.

`private` fica reservado para evolução futura.

## ADR-005 — Sem mensalidade
**Status:** Aceito

Aluno e professor não pagam assinatura obrigatória. Receita é transacional por curso/exame.

## ADR-006 — Taxa administrativa padrão 10%
**Status:** Aceito

Cursos e exames usam 1000 bps por padrão. Admin pode configurar defaults e overrides. Toda transação salva snapshot.

## ADR-007 — Base do split alinhada ao Asaas
**Status:** Proposto para validação funcional

Como o percentual do split Asaas incide sobre `netValue`, recomenda-se interpretar a taxa administrativa como percentual do líquido após taxas do gateway. A conta emissora retém a diferença não distribuída.

## ADR-008 — Ledger próprio
**Status:** Aceito

Asaas não será a única fonte de verdade financeira. BJJ Exams mantém ledger append-only e conciliação.

## ADR-009 — Painel Operacional separado do Console
**Status:** Aceito

Operação de conteúdo/usuários e governança técnica/financeira serão experiências distintas.

## ADR-010 — Server-side authority
**Status:** Aceito

Preço, split, autorização, exame, nota, certificado e entitlement são decididos no backend.

## ADR-011 — Staging separado de produção
**Status:** Aceito

Hosting preview no mesmo projeto não é isolamento suficiente. Backend de staging e produção deve usar projetos Firebase distintos.

## ADR-012 — Migração sem delete físico
**Status:** Aceito

Dados legados permanecem durante a migração. Apenas após validação e janela de estabilização poderão ser arquivados/removidos por rotina específica.

# BJJ Exams v1.2 — Architecture Pack

Este pacote consolida as decisões de produto, arquitetura, segurança, dados, financeiro, migração e qualidade da versão 1.2 do BJJ Exams.

## Objetivo

Transformar o BJJ Exams em uma plataforma profissional de cursos e exames de Jiu-Jitsu com:

- identidade única por usuário;
- academias/equipes como organizações opcionais para cursos e obrigatórias para exames oficiais;
- cursos públicos ou exclusivos de academia;
- exames criados por professor para alunos vinculados à academia;
- monetização transacional, sem mensalidade para aluno ou professor;
- taxa administrativa padrão de 10%, configurável pelo Administrador do Sistema;
- split automático e auditável;
- painel operacional separado do Console do Sistema;
- segurança server-side, auditoria, observabilidade e migração controlada do legado.

## Documentos

1. `ARCHITECTURE_V1_2.md` — arquitetura funcional e técnica.
2. `DATA_MODEL_V1_2.md` — modelo de dados Firestore e invariantes.
3. `IMPLEMENTATION_PLAN_V1_2.md` — plano de implementação por marcos.
4. `ADR_V1_2.md` — decisões arquiteturais formalizadas.
5. `TEST_ACCEPTANCE_V1_2.md` — critérios de aceite e estratégia de testes.

## Regra de desenvolvimento a partir da v1.2

Nenhuma alteração estrutural deve ser implementada diretamente em produção por correção pontual de tela. Toda mudança deve ser classificada, modelada, testada em ambiente isolado e publicada de forma reversível.

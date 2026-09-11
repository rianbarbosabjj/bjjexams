# Plano de Implementação — BJJ Exams v1.2

## Estratégia

A v1.2 deve ser implementada em marcos, cada um com deploy isolado, rollback e critérios de aceite. Evitar hotfixes em cadeia sem regressão.

---

## Marco 0 — Congelamento e baseline

- congelar alterações estruturais na v1.1;
- exportar Firestore/Auth de teste;
- inventariar collections e Functions legadas;
- registrar versão atual do frontend/backend;
- criar branch/tag de baseline;
- documentar secrets existentes sem copiá-los para repositório.

**Saída:** baseline recuperável.

---

## Marco 1 — Ambientes e runtime

- separar staging e produção;
- staging com Asaas Sandbox;
- atualizar runtime Node 20 para runtime suportado;
- atualizar `firebase-functions` com testes de regressão;
- padronizar `.firebaserc`, aliases e scripts de deploy;
- criar pré-flight que bloqueia credenciais de produção no staging.

**Critério:** deploy completo em staging sem avisos críticos de runtime.

---

## Marco 2 — Identidade, RBAC e organizações

- criar `users` canônico;
- criar `organizations`;
- criar `organization_memberships`;
- implementar claims globais;
- funções server-side de convite, solicitação e aprovação;
- regras Firestore deny-by-default;
- migrar Super Admin atual.

**Critério:** aluno sem academia usa cursos; aluno com vínculo aparece corretamente na organização; permissões são validadas no backend.

---

## Marco 3 — Migração legado

Migration tool idempotente com:

- `--dry-run`;
- relatório de inconsistências;
- contagem antes/depois;
- arquivo de rollback/referência;
- nenhum delete físico.

Mapeamentos principais:

- `usuarios/alunos/professores/admins/super_admins` -> `users` + roles/memberships;
- `equipes` -> `organizations`;
- vínculos antigos -> `organization_memberships`.

**Critério:** zero identidade duplicada para o mesmo UID; inconsistências legadas explicitamente catalogadas.

---

## Marco 4 — Cursos v1.2

- novo modelo de curso;
- visibilidade plataforma/academia;
- proprietário do produto;
- workflow draft/review/published;
- backend de catálogo e entitlement;
- matrícula gratuita/paga;
- proteção de conteúdo;
- moderação de curso público.

**Critério:** curso público acessível a aluno independente; curso de academia bloqueado para não-membro mesmo via URL direta.

---

## Marco 5 — Financeiro e split

- `system_config/finance` com 10% padrão;
- `financial_rules` versionadas;
- `orders` e ledger;
- snapshots de split;
- Asaas wallet mapping;
- checkout;
- webhooks idempotentes;
- conciliação `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` e `PAYMENT_SPLIT_DONE`;
- estorno/chargeback.

**Critério:** pagamento Sandbox não duplica entitlement nem split após reenvio do webhook.

---

## Marco 6 — Exames oficiais

- exam templates;
- sessões de exame por academia;
- seleção de alunos vinculados;
- inscrição individual;
- cobrança individual;
- prova server-side;
- resultado e certificado;
- bloqueio de aluno não selecionado.

**Critério:** somente aluno ativo da academia e selecionado pelo professor pode pagar e iniciar o exame.

---

## Marco 7 — Certificados

- emissão server-side;
- validação pública;
- revogação/substituição;
- QR/código único;
- auditoria.

---

## Marco 8 — Painel Operacional e Console

### Painel Operacional

- Pessoas
- Organizações
- Cursos
- Exames
- Banco de Questões
- Certificados
- Pedidos

### Console

- Financeiro
- Splits
- Webhooks
- Auditoria
- Segurança
- Configurações
- Saúde

---

## Marco 9 — Hardening

- App Check;
- rate limiting;
- revisão de Rules;
- CSP/security headers;
- threat review;
- testes de carga dos fluxos críticos;
- backup/restore testado;
- alertas.

---

## Marco 10 — Go-live

Checklist obrigatório:

- staging aprovado;
- migração ensaiada;
- Asaas produção com secrets novos;
- webhook produção validado;
- domínio/SSL;
- observabilidade;
- rollback documentado;
- contas administrativas revisadas;
- termos e privacidade publicados;
- smoke test pós-deploy.

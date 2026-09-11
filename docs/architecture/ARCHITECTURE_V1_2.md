# Arquitetura BJJ Exams v1.2

## 1. Visão do produto

O BJJ Exams será uma plataforma transacional de cursos, exames e certificação para Jiu-Jitsu. Não haverá mensalidade obrigatória para aluno, professor ou academia. A monetização ocorre quando existe uma transação: compra de curso pago ou pagamento de exame.

A plataforma deve suportar quatro experiências principais:

### Painel Operacional da Plataforma
Usado pela administração do BJJ Exams para operar o negócio:

- Pessoas
- Organizações/Academias
- Cursos
- Exames
- Banco de Questões
- Certificados
- Pedidos
- Relatórios operacionais

O Administrador pode criar e vender cursos próprios da plataforma.

### Console do Sistema
Usado apenas por perfis privilegiados para governança e operação técnica:

- Financeiro
- Regras de split
- Recebedores
- Asaas e webhooks
- Auditoria
- Segurança
- Configurações globais
- Saúde do sistema
- Logs e falhas operacionais

### Painel do Instrutor

- Criar e administrar cursos
- Definir curso público ou exclusivo da academia
- Acompanhar matrículas
- Gerenciar alunos vinculados
- Criar sessões de exame
- Selecionar alunos para exame
- Acompanhar pagamentos, resultados e receitas

### Painel do Aluno

- Explorar cursos
- Meus cursos
- Exames autorizados
- Certificados
- Perfil
- Vínculo opcional com academia

---

## 2. Princípios arquiteturais

1. **Identidade única:** um usuário = um UID do Firebase Authentication.
2. **Autorização server-side:** a interface nunca é fonte de verdade para permissões, preço, nota, split ou certificado.
3. **Academia é organização, não identidade:** usuário existe independentemente da academia.
4. **Cursos e exames têm regras diferentes:** curso pode ser independente; exame oficial exige vínculo institucional.
5. **Financeiro é imutável historicamente:** toda venda salva snapshot de preço, taxa e split.
6. **Idempotência obrigatória:** webhook ou ação repetida não pode duplicar matrícula, repasse ou certificado.
7. **Soft delete:** entidades relevantes são arquivadas/suspensas; não apagadas rotineiramente.
8. **Auditabilidade:** ações críticas registram autor, data, origem e antes/depois.
9. **Ambientes isolados:** staging e produção não compartilham banco, Functions, Secrets ou webhooks.
10. **Migração controlada:** legado permanece somente durante janela de transição definida.

---

## 3. Domínios

### 3.1 Identidade e acesso

`users/{uid}` será a fonte central de perfil.

Papéis globais devem ser restritos e preferencialmente representados por Firebase Custom Claims:

- `super_admin`
- `platform_admin`
- `finance_admin`
- `content_admin`
- `support_admin`

Papéis de academia não devem ser Custom Claims, pois mudam com maior frequência. Devem viver em `organization_memberships`:

- `owner`
- `manager`
- `instructor`
- `student`

Uma pessoa pode possuir mais de um vínculo organizacional.

### 3.2 Organizações

Academias/equipes serão representadas por `organizations`.

O vínculo com pessoas ficará exclusivamente em `organization_memberships`. O documento do usuário não deve conter listas duplicadas de academias, exceto campos derivados/cache não autoritativos.

### 3.3 Cursos

Cursos suportarão:

- proprietário `platform`, `user` ou `organization`;
- visibilidade `platform`, `organization` ou futuramente `private`;
- gratuito ou pago;
- fluxo de publicação e moderação;
- matrícula independente de academia quando visibilidade = `platform`;
- validação de vínculo ativo quando visibilidade = `organization`.

Estado sugerido:

`draft -> review -> published -> suspended -> archived`

Cursos públicos de instrutores devem passar por revisão antes de publicação. Cursos internos de academia podem usar política de revisão simplificada, configurável pelo Admin.

### 3.4 Exames oficiais

Exame oficial é institucional.

Fluxo obrigatório:

`Professor -> Academia -> Alunos vinculados -> Sessão de exame -> Seleção de candidatos -> Cobrança -> Liberação -> Prova -> Resultado -> Certificado`

O aluno não cria a própria inscrição para exame oficial.

A sessão de exame pertence a uma organização e possui professor responsável. Só podem ser selecionados alunos com vínculo `student` ativo naquela organização.

Estado da sessão:

`draft -> candidates_selected -> awaiting_payment -> ready -> in_progress -> completed -> cancelled -> archived`

Estado individual do candidato:

`selected -> awaiting_payment -> paid -> authorized -> started -> submitted -> passed|failed -> certified`

### 3.5 Certificados

Certificados possuem ciclo de vida:

- `issued`
- `revoked`
- `replaced`

Devem conter identificador público único, referência imutável ao resultado e informações necessárias à validação pública sem expor dados desnecessários.

---

## 4. Financeiro e split

### 4.1 Regra padrão

Taxa administrativa padrão do BJJ Exams:

- Cursos: **10%**
- Exames de faixa: **10%**

Internamente, percentuais serão armazenados em basis points (bps):

- 10% = `1000 bps`
- 100% = `10000 bps`

Evita-se armazenar dinheiro ou percentual em ponto flutuante.

### 4.2 Quem controla a taxa

A taxa administrativa é controlada pelo Administrador do Sistema.

Prioridade:

1. override específico do produto/exame;
2. regra específica da categoria;
3. taxa padrão do sistema.

Professor/instrutor não pode reduzir ou alterar a taxa da plataforma.

### 4.3 Base recomendada para o split Asaas

A integração deve considerar que o split percentual do Asaas é calculado sobre o `netValue`, após taxas do gateway. Portanto, para a v1.2, a definição recomendada é:

> **Taxa administrativa de 10% sobre o valor líquido da transação após tarifas do meio de pagamento.**

A conta principal da plataforma deve emitir a cobrança; o Asaas recebe apenas os splits dos recebedores externos. O saldo não distribuído permanece na conta emissora e representa a parcela da plataforma.

Exemplo conceitual com um único instrutor:

- plataforma: 10% do líquido, por diferença residual;
- instrutor: 90% do líquido via split.

Para múltiplos recebedores, os 90% distribuíveis são rateados conforme os pesos definidos para o produto.

### 4.4 Snapshot financeiro

No momento da criação do pedido, devem ser congelados:

- preço bruto;
- moeda;
- taxa administrativa aplicada;
- versão da regra;
- recebedores;
- pesos/percentuais;
- walletIds usados;
- referência do produto;
- proprietário econômico;
- ambiente;
- timestamps.

Alterar a taxa padrão posteriormente não altera uma venda existente.

### 4.5 Eventos de pagamento

Recomendação:

- `PAYMENT_CONFIRMED`: pagamento confirmado; pode gerar entitlement digital quando a política do produto permitir.
- `PAYMENT_RECEIVED`: valor disponível; atualizar liquidação financeira.
- `PAYMENT_SPLIT_DONE`: conciliar split individual.
- eventos de estorno e chargeback devem atualizar entitlement e financeiro de forma explícita.

Todo evento precisa ser idempotente.

---

## 5. RBAC e autorização

A UI pode esconder ações, mas toda ação crítica deve ser revalidada no backend.

Exemplos:

- somente `super_admin`/`finance_admin` alteram taxa administrativa;
- `platform_admin` cria cursos da plataforma;
- instrutor edita apenas cursos sob sua propriedade ou escopo autorizado;
- `organization.manager` gerencia vínculos da própria organização;
- professor só cria exame para organização onde possui papel autorizado;
- aluno só acessa curso de organização se possuir vínculo ativo;
- resultado de exame e certificado nunca são gravados diretamente pelo cliente.

---

## 6. Painel Operacional x Console do Sistema

### Painel Operacional

Foco em negócio e conteúdo:

- Dashboard
- Pessoas
- Academias
- Cursos
- Exames
- Banco de Questões
- Certificados
- Pedidos
- Relatórios

### Console do Sistema

Foco em governança e infraestrutura:

- Visão técnica
- Financeiro
- Regras de split
- Recebedores/wallets
- Webhooks
- Conciliação
- Auditoria
- Segurança
- Configurações
- Logs
- Saúde das Functions

O mesmo Super Admin pode alternar entre os dois ambientes, mas as rotas e permissões permanecem separadas.

---

## 7. Segurança

Obrigatório para v1.2:

- Secrets apenas no Firebase Secret Manager;
- App Check nas chamadas elegíveis;
- rate limiting em fluxos sensíveis;
- webhook com token e idempotência;
- validação de payload no backend;
- regras Firestore com deny-by-default;
- nenhum gabarito, preço autoritativo, split ou nota confiado ao navegador;
- logs sem secrets e sem PII desnecessária;
- CSP e security headers no Hosting;
- princípio de menor privilégio.

---

## 8. Ambientes

Preview Hosting não isola Functions nem Firestore. Para testes profissionais, a arquitetura deve separar projetos Firebase.

Recomendação:

- Local: Firebase Emulator Suite
- Staging: projeto Firebase exclusivo + Asaas Sandbox
- Produção: projeto Firebase exclusivo + Asaas Produção

Secrets, webhooks, bancos e service accounts não devem ser compartilhados entre staging e produção.

Antes de produção, o runtime Node 20 e o SDK `firebase-functions 4.9.0` atuais devem ser atualizados e submetidos à regressão completa.

---

## 9. Observabilidade

O Console deve exibir pelo menos:

- webhooks com falha;
- pagamentos pendentes anormais;
- divergências de split;
- erros de Functions;
- falhas de emissão de certificado;
- ações administrativas recentes;
- saúde das integrações;
- métricas de transação.

Alertas críticos devem ser persistidos e possuir status `open`, `acknowledged`, `resolved`.

---

## 10. Fora do escopo v1.2

Para evitar dispersão:

- Modo Rola
- Ranking
- Afiliados
- Cupons avançados
- Assinaturas/mensalidades
- Gamificação ampliada
- Marketplace externo

Esses recursos só retornam após estabilização do núcleo.

---

## 11. Referências técnicas Asaas

A documentação oficial do Asaas informa que:

- o split usa `walletId` dos recebedores;
- o percentual é calculado sobre `netValue`;
- a diferença não distribuída permanece na conta emissora;
- `PAYMENT_SPLIT_DONE` pode ser usado para acompanhar liquidação individual;
- webhooks diferenciam `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`.

Referências oficiais:

- https://docs.asaas.com/docs/split
- https://docs.asaas.com/docs/payment-split-overview
- https://docs.asaas.com/docs/checkout-com-split-de-pagamento
- https://docs.asaas.com/docs/webhook-para-cobrancas

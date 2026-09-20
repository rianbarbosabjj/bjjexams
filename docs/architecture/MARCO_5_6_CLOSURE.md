# Marco 5.6 — Fechamento técnico

## Status

**CONCLUÍDO EM STAGING**

Branch: `feature/marco5f-purchase-ui-ops`

Base: `develop-v1.2`

Escopo: UI de compra PIX de cursos, histórico financeiro sanitizado do aluno e operação financeira administrativa, sem produção.

## Critério de conclusão

O Marco 5.6 foi considerado concluído após validar, em `bjj-exams-staging`, que:

- aluno autenticado inicia checkout PIX de curso pago;
- checkout pendente é retomado após reload sem duplicar pedido/transação;
- entitlement só é concedido após confirmação server-side do pagamento;
- histórico do aluno distingue compra pendente, paga/liberada e encerrada;
- administrador autorizado visualiza operações por read model sanitizado;
- cobrança pendente pode ser cancelada pela UI administrativa;
- refund integral pode ser solicitado pela UI administrativa;
- `needs_reconciliation` é exibido explicitamente quando o provedor nega/retorna resultado que exige ação manual;
- nenhuma UI lê diretamente coleções financeiras canônicas;
- produção permaneceu fora do escopo.

## Gates

### Gate 1 — contratos e read models

**OK**

- domínio puro de estados de compra;
- `obterStatusCompraCursoV12`;
- `listarComprasCursosAlunoV12`;
- `listarOperacoesFinanceirasCursosV12`;
- contratos sanitizados e fail-safe;
- cobertura unitária/emulador.

### Gate 2 — API frontend financeira

**OK**

- `js/course-purchase-api-v1_2.js`;
- allowlist explícita de callables;
- autenticação obrigatória;
- idempotency intent persistente por usuário/curso;
- bloqueio de produção neste marco;
- sem exposição de IDs internos do provedor.

### Gate 3 — experiência de compra no curso

**OK**

- CTA contextual por estado;
- checkout PIX;
- QR Code + copia-e-cola;
- polling apenas em estados transitórios;
- reload retoma cobrança pendente;
- nenhum entitlement concedido pelo browser.

### Gate 4 — área do aluno

**OK**

- curso pago só aparece como disponível após entitlement canônico;
- seção `Compras e pagamentos` via callable sanitizada;
- estados pendente, pago/liberado, encerrado, refund e chargeback tratados separadamente;
- histórico financeiro não bloqueia área acadêmica em caso de falha própria.

### Gate 5 — console operacional financeiro

**OK**

- console sanitizado para `super_admin` / `platform_admin`;
- cancelamento de cobrança pendente;
- solicitação de refund integral;
- confirmação destrutiva + justificativa obrigatória;
- prevenção de duplo clique;
- `awaiting_webhook`, `completed`, `provider_rejected` e `needs_reconciliation` representados explicitamente;
- sem acesso direto do frontend a coleções financeiras.

### Gate 6 — staging integrado

**OK**

Validações executadas em `bjj-exams-staging`:

1. deploy dos índices e três read models novos;
2. pós-deploy: 8/8 superfícies financeiras `ACTIVE` em Gen 2;
3. `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` vinculados somente onde necessários;
4. três read models sem secrets do provedor;
5. frontend local apontando explicitamente para staging;
6. checkout PIX real em Asaas Sandbox;
7. reload do checkout pendente sem duplicação:
   - 1 pedido;
   - 1 transação;
   - 0 enrollment antes do pagamento;
8. confirmação Sandbox -> webhook -> worker -> fulfillment:
   - order `paid`;
   - transaction `paid`;
   - enrollment `active`;
9. painel do aluno refletindo `Pago e liberado`;
10. cancelamento administrativo de cobrança pendente pela UI;
11. painel do aluno refletindo `Cobrança encerrada`;
12. nova compra do mesmo curso após cancelamento;
13. nova confirmação Sandbox -> entitlement ativo;
14. solicitação de refund integral pela UI administrativa;
15. resultado real do Sandbox:
   - reversal request `needs_reconciliation`;
   - provider lifecycle `denied`;
   - error `REVERSAL_PROVIDER_REFUND_DENIED`;
   - webhook `PAYMENT_REFUND_DENIED` processado;
   - order permaneceu `paid`;
   - transaction permaneceu `paid`;
   - enrollment permaneceu `active`;
   - UI mostrou `Reconciliação manual necessária`;
   - falso sucesso de refund: **não reportado**.

## Regressão final

### Testes locais

**118/118 PASS**

- financial purchase read domain: 16/16;
- admin financial ops entry: 8/8;
- admin financial ops loader: 6/6;
- course purchase API: 18/18;
- course purchase UI: 15/15;
- course student API: 11/11;
- course student UI: 18/18;
- financial ops admin bootstrap: 10/10;
- financial ops UI: 16/16.

### Emulator

**23/23 PASS**

- financial purchase read service: 7/7;
- financial purchase read functions: 6/6;
- student purchase history service: 6/6;
- student purchase history functions: 4/4.

### Total selecionado do fechamento

**141/141 PASS**

Também validados:

- `node --check functions/main.js`;
- `git diff --check` sem saída;
- working tree limpa ao final da regressão.

## Segurança e invariantes comprovadas

- produção não foi alvo do deploy nem dos smokes do Marco 5.6;
- browser não acessa diretamente `orders`, `payment_transactions`, `payment_webhook_events` ou `financial_reversal_requests`;
- read models financeiros não carregam secrets do Asaas;
- IDs internos do provedor não são expostos na UI sanitizada;
- criação do checkout não concede acesso;
- confirmação financeira server-side é requisito para entitlement;
- reload não duplica pedido/transação;
- reversões administrativas exigem RBAC server-side;
- refund negado não revoga acesso nem é traduzido como refund concluído;
- estado de reconciliação bloqueia nova operação destrutiva pela UI.

## Avisos não bloqueantes observados

1. Firebase CLI informou que existe versão mais recente de `firebase-functions`.
   - Não atualizado durante o Gate 6 para evitar ampliar blast radius.
   - Tratar em hardening dedicado.

2. Functions Emulator avisou que Application Default Credentials estavam disponíveis.
   - Os testes de fechamento usaram projetos `demo-*` e somente emuladores explicitamente selecionados.
   - Nenhuma falha ou evidência de mutação em produção foi observada durante a regressão.
   - Recomenda-se hardening futuro para executar regressões locais com credenciais externas indisponíveis/isoladas quando possível.

## Fora do fechamento

Permanece fora do Marco 5.6:

- produção;
- venda de exame oficial de faixa (Marco 5.7);
- refund parcial automatizado;
- operação manual de chargeback pelo usuário;
- payout/saques;
- migração financeira legada;
- atualização de dependências por hardening;
- SLOs/hardening final de produção (Marco 5.8).

## Decisão de release

O Marco 5.6 está tecnicamente pronto para revisão/merge em `develop-v1.2`, condicionado ao fluxo normal de revisão do PR.

**Não autoriza deploy em produção.**

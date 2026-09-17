# Contrato 5.2 — Administração de regras financeiras e recebedores v1.2

## Status

Planejado para implementação no Marco 5.2.

Este contrato administra configuração financeira canônica. Não cria cobrança, não chama Asaas e não concede entitlement.

## Objetivo

Permitir que a administração da plataforma:

- consulte a configuração financeira de forma sanitizada;
- mantenha a taxa administrativa padrão, inicialmente 10%;
- configure override financeiro de curso;
- configure recebedores e participações do seller pool;
- registre a conta/wallet canônica de um recebedor para o ambiente correto;
- ative/inative overrides sem alterar snapshots históricos;
- audite toda alteração.

## RBAC

No 5.2 podem administrar regras financeiras somente:

- `super_admin`;
- `platform_admin`.

A claim `finance_admin` existe no enum global, mas **não possui hoje fonte autoritativa sincronizada**. Portanto ela não concede permissão no 5.2.

Quando houver governança autoritativa própria para `finance_admin`, o papel poderá ser habilitado em incremento posterior com testes de promoção/revogação.

Instrutor, aluno, suporte e content admin não podem administrar regras financeiras.

## Regra padrão

Documento singleton:

```text
financial_rules/platform-default
```

Contrato:

```js
{
  name: 'Regra padrão da plataforma',
  status: 'active',
  scope: 'platform_default',
  productType: null,
  productId: null,
  platformFeeBps: 1000,
  recipientMode: 'product_owner',
  recipientShares: [],
  version: 1,
  createdBy: '<uid>',
  updatedBy: '<uid>',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

Regras:

1. `recipientMode` da regra padrão permanece `product_owner`;
2. `recipientShares` permanece vazio;
3. somente `platformFeeBps` é configurável no 5.2;
4. ausência do documento não é tratada como configuração persistida;
5. a primeira gravação usa por padrão `1000 bps` quando o administrador inicializa a configuração;
6. mudança efetiva incrementa `version`;
7. gravação idêntica é idempotente e não incrementa versão/auditoria;
8. snapshots já existentes nunca são reescritos.

Antes do checkout 5.3, um preflight obrigatório verificará que a regra padrão está persistida e ativa.

## Override por curso

Cada curso pode possuir no máximo um override canônico ativo.

O ID do documento é determinístico a partir de:

```text
productType + productId
```

O curso armazena o vínculo em:

```text
courses/{courseId}.financialRuleId
```

Um override pode configurar:

- `platformFeeBps`;
- `recipientMode=product_owner|explicit`;
- `recipientShares` quando explicit.

Somente curso canônico existente e pago pode receber override.

O override pode ser preparado em draft/review/published, mas curso arquivado não pode receber nova configuração.

### Ativação

Ativar um override:

1. valida curso;
2. valida regra;
3. valida recebedores;
4. valida readiness local dos recebedores explicit;
5. grava/atualiza a regra;
6. grava `course.financialRuleId`;
7. cria auditoria;
8. tudo ocorre na mesma transação Firestore.

### Inativação

Inativar um override:

1. muda a regra para `inactive`;
2. limpa `course.financialRuleId` se ainda apontar para essa regra;
3. mantém o documento e sua versão para auditoria;
4. futuras compras voltam à regra padrão;
5. snapshots históricos permanecem intactos.

Não existe deleção física de regra financeira no 5.2.

## Conta canônica do recebedor

Nova coleção server-side:

```text
financial_recipient_accounts/{accountId}
```

Ela substitui, para o domínio v1.2, o uso operacional direto de campos legados como:

```text
usuarios.asaas_wallet_id
usuarios.asaas_wallet_id_sandbox
```

Não haverá fallback silencioso do domínio novo para esses campos.

### Identidade

`accountId` é determinístico por:

```text
provider + environment + recipientType + recipientId
```

### Estrutura

```js
{
  recipientType: 'user' | 'organization',
  recipientId: '<canonical-id>',
  provider: 'asaas',
  environment: 'sandbox' | 'production',
  walletId: '<provider-wallet-id>',
  status: 'ready' | 'blocked',
  version: 1,
  createdBy: '<uid>',
  updatedBy: '<uid>',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Significado de readiness

No 5.2, `status=ready` significa **configuração local completa**:

- identidade canônica existe;
- walletId está preenchida;
- ambiente corresponde ao projeto;
- conta não está bloqueada administrativamente.

Não significa confirmação online pelo Asaas, pois o 5.2 não chama o provedor.

O 5.3 poderá adicionar validação/rejeição do provedor antes de criar split.

### Plataforma

O recebedor `platform` não exige documento em `financial_recipient_accounts`: a parcela da plataforma permanece na conta principal do provedor.

### User e organization

- `recipientType=user` exige `usuarios/{recipientId}` existente;
- `recipientType=organization` exige `organizacoes/{recipientId}` existente;
- recipient inexistente falha fechado;
- walletId nunca é aceita como verdade a partir da regra financeira; ela vem do registro canônico de conta.

## Ambiente

O registro de conta é environment-scoped.

Projetos autorizados:

```text
bjj-exams-staging -> sandbox
bjj-exams         -> production
```

Emuladores/testes injetam ambiente explicitamente.

Uma conta sandbox nunca satisfaz readiness production e vice-versa.

Nenhum segredo/token Asaas é armazenado em `financial_recipient_accounts`; walletId é identificador operacional, não credencial.

## Readiness de regra explicit

Para ativar regra `recipientMode=explicit`:

- recipient `platform` é considerado pronto sem wallet;
- cada recipient `user` ou `organization` precisa possuir conta canônica `ready` para o provider/environment corrente;
- todos os recipientShares continuam somando exatamente 10000 bps;
- qualquer recipient faltante/bloqueado falha fechado.

Para `product_owner`, a readiness do proprietário concreto será verificada novamente no checkout 5.3, pois a regra padrão não está vinculada a um produto específico.

## Callables do 5.2

### `obterConfiguracaoFinanceiraV12`

Admin-only.

Retorna visão sanitizada:

- regra padrão;
- se está persistida/ativa;
- versão;
- platformFeeBps;
- informações necessárias para UI administrativa.

Não retorna segredos.

### `atualizarTaxaPadraoFinanceiraV12`

Admin-only.

Entrada aceita apenas:

```text
platformFeeBps
```

O backend ignora/rejeita campos financeiros adicionais.

### `configurarContaRecebedorFinanceiroV12`

Admin-only.

Entrada:

```text
recipientType
recipientId
walletId
status
```

Provider/environment são resolvidos server-side.

### `salvarRegraFinanceiraCursoV12`

Admin-only.

Entrada:

```text
courseId
platformFeeBps
recipientMode
recipientShares
status
```

Identidade do produto, owner e campos do curso são recarregados do Firestore.

### `obterRegraFinanceiraCursoV12`

Admin-only.

Retorna regra sanitizada + readiness dos recebedores.

## Auditoria

Toda mudança efetiva cria `audit_logs`.

Tipos mínimos:

```text
financial.default_rule.updated
financial.recipient_account.created
financial.recipient_account.updated
financial.course_rule.created
financial.course_rule.updated
financial.course_rule.activated
financial.course_rule.deactivated
```

Auditoria registra:

- actorId;
- actorRole;
- entityType;
- entityId;
- before sanitizado;
- after sanitizado;
- timestamp server-side.

Wallet completa não precisa aparecer em audit log; usar valor mascarado ou somente indicador de presença/últimos caracteres.

Chamadas idempotentes sem mudança não criam nova auditoria.

## Views sanitizadas

Callables administrativas podem retornar:

- IDs canônicos;
- percentuais;
- versão/status;
- recipientType/recipientId;
- readiness;
- wallet mascarada.

Não retornar:

- chave Asaas;
- token webhook;
- payload sensível do provedor;
- wallet completa quando a UI não precisar editá-la.

## Firestore Rules

Acesso direto do cliente permanece negado para:

```text
financial_rules
financial_recipient_accounts
orders
payment_transactions
payment_webhook_events
```

Toda leitura/escrita administrativa passa por Functions server-side.

## Compatibilidade e legado

O 5.2 não:

- escreve em `pedidos`;
- escreve em `matriculas`;
- usa `config_financeira.percentual_professor`;
- usa `usuarios.asaas_wallet_id*` como fallback operacional;
- altera snapshots históricos;
- chama Asaas.

Migração de wallets legadas, se necessária, será explícita, auditável e executada por ferramenta própria.

## Casos mínimos de teste

1. super_admin administra financeiro;
2. platform_admin administra financeiro;
3. finance_admin isolado ainda não administra;
4. content_admin não administra;
5. usuário comum não administra;
6. default inicia em 1000 bps;
7. default rejeita campos extras;
8. default idêntico não incrementa version;
9. default alterado incrementa version;
10. audit só nasce em mudança efetiva;
11. conta recipient user exige usuário existente;
12. conta organization exige organização existente;
13. ambiente incompatível falha;
14. wallet vazia não fica ready;
15. conta blocked não satisfaz readiness;
16. platform não exige wallet;
17. explicit exige todas as contas ready;
18. override exige curso pago;
19. override rejeita curso inexistente;
20. override rejeita curso arquivado;
21. ativação liga `course.financialRuleId`;
22. inativação limpa vínculo do curso;
23. override idêntico é idempotente;
24. mudança de override incrementa version;
25. snapshot histórico não é reescrito;
26. cliente continua sem Firestore direto;
27. código 5.2 não importa Asaas helper nem secrets;
28. nenhuma callable cria order/payment/enrollment.

## Critério de conclusão

O Marco 5.2 estará concluído quando:

- contrato estiver versionado;
- RBAC admin estiver coberto por testes;
- regra default puder ser consultada/alterada;
- conta canônica de recebedor estiver implementada;
- override por curso puder ser criado/ativado/inativado;
- readiness local estiver validada;
- auditoria estiver coberta;
- Firestore Emulator comprovar atomicidade;
- Functions Emulator comprovar autorização e payload sanitizado;
- nenhuma chamada Asaas ocorrer;
- nenhum order/payment/enrollment for criado;
- produção permanecer intacta.

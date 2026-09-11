# Testes e Critérios de Aceite — BJJ Exams v1.2

## Pirâmide de testes

### Unitários
- cálculo de taxa e split;
- transições de estado;
- validação de papéis;
- idempotência;
- elegibilidade para curso/exame.

### Integração
Usar Firebase Emulator Suite para:
- Auth + Firestore Rules;
- callable Functions;
- fluxo de matrícula;
- fluxo de vínculos;
- exame;
- emissão de certificado.

### Sandbox externo
Asaas Sandbox para:
- checkout;
- pagamento;
- webhook repetido;
- split;
- estorno;
- falha de webhook;
- conciliação.

### E2E
Casos mínimos:

1. aluno independente compra curso público;
2. aluno independente não acessa curso exclusivo de academia;
3. aluno solicita vínculo e gestor aprova;
4. após vínculo, curso da academia aparece;
5. professor cria sessão de exame;
6. professor só consegue selecionar aluno ativo da própria academia;
7. aluno selecionado recebe cobrança;
8. aluno não selecionado não consegue iniciar prova;
9. webhook duplicado não duplica matrícula/inscrição;
10. aprovação gera certificado válido;
11. revogação invalida certificado público;
12. alteração da taxa de 10% não muda transações antigas.

---

## Segurança

- usuário comum não lê painel financeiro;
- instrutor não altera taxa da plataforma;
- aluno não grava nota;
- aluno não cria certificado;
- URL direta não contorna entitlement;
- usuário de academia A não gerencia academia B;
- secrets não aparecem em Hosting, logs ou respostas;
- webhook inválido retorna erro e não processa evento.

---

## Financeiro

Para cada pedido deve ser possível reconstruir:

- preço original;
- taxa administrativa aplicada;
- regra/versionamento;
- recebedores;
- valores calculados;
- paymentId;
- eventos recebidos;
- split liquidado;
- eventual refund/chargeback.

Nenhuma diferença financeira deve depender de cálculo retroativo usando configuração atual.

---

## Critério de release v1.2

A versão só pode ser promovida para produção quando:

- todos os casos críticos E2E passam em staging;
- Rules têm testes automatizados;
- webhooks são idempotentes;
- backup e restore foram ensaiados;
- Node/runtime e SDK suportados estão em uso;
- não existem secrets no repositório/Hosting;
- migração possui dry-run aprovado;
- observabilidade mínima está ativa;
- existe rollback documentado.

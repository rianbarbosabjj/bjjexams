# Marco 9 — Gate 9.7B1: prontidão de carga em staging e handoff operacional

**Estado: `NO_GO / NO_DEPLOY / NO_ENFORCEMENT / OFFLINE_SYNTHETIC_ONLY`.** Esta entrega NÃO envia requisições ao Firebase, não acessa Cloud Logging, não integra o Asaas Sandbox, não cria pagamentos e não comprova a capacidade operacional. O Marco 9 ainda depende dos dez aceites reais do registro 9.8A.

## Por que este gate existe

O Gate 9.7A validou 24 solicitações fictícias e concorrência limitada no Firestore Emulator, mas isso **não mede Cloud Functions, cold starts, latência ou cobrança**. Antes de qualquer carga real, precisamos de responsáveis, limites aprovados e capacidade de parar rapidamente sem gerar efeitos financeiros ou comprometer provas em andamento.

`config/marco9-staging-load-readiness-v1_2.json` mantém projeto de destino `bjj-exams-staging`, produção `bjj-exams` proibida, `authorization=NOT_GRANTED`, endpoints autorizados vazios e todos os limiares de carga/latência/custo como `null`. Não são inventados valores de SLA nem de orçamento. Mesmo um PR aprovado não muda esses estados. O pré-flight é de **leitura local**, e não requer conta Google Cloud, token Firebase ou chave Asaas.

## Matriz inicial — 8 cenários

| Área | O que validar no futuro exclusivamente em staging | Dependência prévia |
| --- | --- | --- |
| `public_read` | consultas públicas, erros e cache | Hosting/CSP em report-only e monitoração |
| `authenticated_read` | sessão/claims, token expiração e leitura por papéis | App Check registrado; RBAC revisado |
| `organization_membership` | isolamento de academias e credenciais | usuários de teste de duas organizações |
| `exam_lifecycle` | iniciar/responder/finalizar sem duplicidade | provas e gabaritos **fictícios** |
| `certificates` | emissão e idempotência sob retry | certificados sintéticos e cleanup |
| `course_entitlement` | acesso pago/privado e tentativas cruzadas | matrícula fictícia e permissões |
| `checkout_asaas_sandbox_only` | criação idempotente e timeout/retry | somente **Asaas Sandbox** e limites de transações |
| `webhook_reprocess_sandbox_only` | duplicidade, ordem, replay autorizado | tokens/rotas de Sandbox, auditoria de ledger |

Não iniciar cenários financeiros enquanto não houver autorização explícita de Sandbox, circuito para impedir cobranças reais, custo aceito e proteção de idempotência. Os 8 cenários acima são **planejamento**, não execução real.

## Gate fail-closed 9.7B1

`scripts/preflight-marco9-staging-load-v1_2.js` valida offline o manifesto, o registro 9.8A e a pendência RPO/RTO do backup gerenciado. Rejeita qualquer tentativa de afirmar aprovação, inventar limites, adicionar endpoint, permitir projeto produção ou remover um dos oito cenários. Sem alterações em Firebase, Rules, HMAC, TTL ou quotas.

O avaliador `evaluateSyntheticSamples()` é **apenas um modelo determinístico com unidades arbitrárias de teste**, sem rede e sem preço Firebase. O teste automatizado comprova interrupção por cinco critérios: teto de requisições, concorrência, orçamento fictício, taxa de erro e p95 sintético. **Não** fornece SLO real, p99 real, custo cloud, nem controle ativo sobre endpoints do BJJ Exams.

## Handoff para a homologação operacional 9.7B e decisão 9.8B

1. **Autoridade e janela** — designar aprovadores do produto, segurança e operações; registrar autorização delimitada ao Firebase `bjj-exams-staging`, IAM, datas, início/fim, contato de plantão, e cronograma de rollback. Produção não é destino de teste.
2. **Preparação** — confirmar App Check, CSP report-only, Auth/RBAC e conta Asaas Sandbox no ambiente esperado. Provisionar usuários/dados inteiramente fictícios, confirmar nenhuma automação de cobrança/reprocessamento inesperada e um backup/rollback staging validado.
3. **Orçamento e carga** — aprovar perfil de tráfego, total de requisições, concorrência, duração e **orçamento** monetário de Firestore/Functions. Definir máximos e critério de parada por custo, erro, p95, p99, cold starts, disponibilidade e quota; sem metas sugeridas como valores reais antes de observar baseline.
4. **Instrumentação** — medir em Cloud Logging/Monitoring somente agregados sanitizados. Confirmar limites de IAM, LGPD e retenção e ausência de logs de token, CPF, gabarito, corpo financeiro ou identificadores pessoais.
5. **Execução gradual** — validar antes um smoke de leitura e sessão, depois casos limitados de concorrência de exames, certificados e entitlements. Execução financeira só após aceite separado de **Asaas Sandbox**, com teto de eventos, idempotência, reversão e reprocessamento controlado.
6. **Parada imediata e rollback** — qualquer falha de isolamento entre organizações, duplicidade financeira, perda de dados, exposição de informações, excedente de custo ou limiar de latência/erro é critério de interrupção. O rollback real do Hosting/Functions/Rules requer autorização própria, não pode ser presumido a partir dos testes de emulador.
7. **Evidência e aceite** — registrar horários, versão implantada, volume/concorrência, p95/p99/cold starts, custos reais, erro, impacto em Firestore, resultados de idempotência, limpeza dos dados fictícios e a comparação com **RPO/RTO** aprovados. Assinatura humana é obrigatória para Gate **9.8B**; nenhuma conclusão automática em CI concede produção.

## O que este PR NÃO faz

- Não executa comandos de deploy, carga real, Cloud Functions, consultas Firebase, calls HTTP, monitoramento vivo ou pagamento no Asaas Sandbox.
- Não define ou aprova budgets monetários, SLOs, RPO/RTO, estratégia de backup, retenção LGPD, HMAC, App Check/CSP enforcing nem a passagem ao Marco 10.
- Não edita `config/marco9-rc-evidence-v1_2.json`: os dez bloqueios operacionais continuam `NO_REAL_STAGING_ACCEPTANCE_EVIDENCE` e a release continua `NO_GO`.

**Aceite de código:** CI completo (regressão 133/133, Firestore Emulator isolado, npm audit, Gate 9.8A NO_GO e testes 9.7B1) aprovado no HEAD exato. **Aceite operacional 9.7B:** pendente de execução e assinatura em staging.

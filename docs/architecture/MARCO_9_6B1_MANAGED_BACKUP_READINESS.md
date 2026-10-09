# Marco 9 — Gate 9.6B1: evidência preparatória de backup gerenciado e recuperação adversarial

**Estado: `MANAGED_BACKUP_NOT_VERIFIED / RPO_RTO_UNAPPROVED / NO_GO / NO_DEPLOY`.** Este gate NÃO configura backups ou PITR do Firestore, NÃO testa um restore gerenciado real e NÃO prova RPO/RTO. Ele protege o planejamento offline e amplia os testes de falha no **Firestore Emulator** do projeto fictício `demo-bjj-exams-resilience`.

## Parte 1 — preflight explícito de não ativação

O manifesto `config/marco9-managed-backup-readiness-v1_2.json` exige projeto-alvo eventual **`bjj-exams-staging`** e proíbe produção `bjj-exams`. Declara **12 domínios de dependência**: perfis/organizações, provas/questões, certificados, cursos/entitlements, pedidos/ledger, webhooks/idempotência, audit_logs, usuários/claims do Auth, Cloud Storage, Rules/índices/TTL, secrets/config e reconciliação externa Asaas.

O `scripts/preflight-marco9-managed-backup-v1_2.js` é somente de leitura: recusa alterações que afirmem cadastro de backup, destino isolado, autorização, retenção, IAM, segurança de triggers, acesso ao staging, limpeza real ou assinatura humana. `rpoMinutes` e `rtoMinutes` devem permanecer `null` até aprovação formal; nenhum número de SLA/RPO/RTO foi inventado. A alteração de algum desses estados exige gate operacional específico com comprovação, em vez de maquiar o preflight para ficar verde.

## Parte 2 — restauração adversarial no emulador (não no Firebase real)

`tests/marco9-recovery-adversarial-demo-emulator-v1_2.test.js` reaproveita o boundary já testado em 9.6A (`FIRESTORE_EMULATOR_HOST` apenas loopback, três variáveis de projeto `demo-bjj-exams-resilience`, sem service account nem Firebase token). Seus documentos artificiais representam estudante, curso, pedido e exame. Testa:

- Hash SHA-256 do snapshot completo e metadados exatos de coleção, projeto, esquema e IDs; rejeição de documento alterado, lista reordenada ou ampliada, hash falso, projeto de produção/staging e destino indevido **antes de qualquer escrita**.
- Um restore em coleção isolada que já contém um documento deve falhar **sem sobrescrever** o documento nem criar os outros três. Não executa import/export gerenciado.
- Duas solicitações simultâneas de restore da mesma origem para o mesmo destino: uma transação aceita e a segunda falha após verificar o destino ocupado. A resposta e o digest do destino devem coincidir exatamente com o snapshot válido.
- Restauração não altera os quatro documentos da origem. A limpeza final apaga e confere oito caminhos artificiais, inclusive se houver erro.

O resultado é uma simulação sintética de semântica transacional, **não** a garantia de que um backup real pode ser restaurado com downtime, referências, índices e configuração corretos. **`Firestore Emulator` não replica backups gerenciados**, export/import/PITR, IAM cloud, billing, cold starts, notificações ou triggers de ambiente real.

## Dependências para o Gate operacional 9.6B

1. Autorizar formalmente a inspeção do projeto `bjj-exams-staging`, a conta IAM que a executará e custos estimados. Identificar mecanismo real (backup agendado ou PITR/export) e evidência de restore suportado, sem acesso à produção.
2. Definir **RPO/RTO** com o responsável pelo produto e pela segurança com base em tolerância real a perda/indisponibilidade. Nenhuma meta técnica substitui o aceite.
3. Aprovar `retention` e IAM do backup/destino, plano de limpeza e proteção de dados conforme LGPD. **Backup do Firestore não é backup automático de todos os recursos**: incluir separadamente Auth, Cloud Storage, Rules, índices, TTL, secrets, configurações, certificados, webhook ledger e dependências externas.
4. Preparar restauração **isolada e reversível**, garantindo que não reative envio de mensagens, emissão de certificados, replay financeiro ou cobranças Asaas. Qualquer teste de checkout depende de **Asaas Sandbox** e autorização específica.
5. Documentar execução, integridade e contagem, consistência entre domínios, custo, tempos medidos, recuperação de permissões, riscos remanescentes e cleanup. Somente então solicitar o aceite operacional.

## Reprodutibilidade

O CI executa o pré-flight offline e testes de falsificação de aprovação, depois roda a nova prova transacional dentro da **mesma instância demo Firestore Emulator** dos Gates 9.6A e 9.7A. Mantém regressão 133/133, npm audit com zero achados no instante da execução, e matriz 9.8A em `NO_GO`. Nada ativa rate limiting, App Check ou CSP enforcement, nem executa deploy.

**Saídas esperadas:** `MARCO9_GATE_9_6B1_OFFLINE_PREFLIGHT=PASSED`; `MARCO9_GATE_9_6B1_ADVERSARIAL_DEMO=PASSED`; `MARCO9_6B1_CLOUD_MANAGED_BACKUP=NOT_VERIFIED`; `MARCO9_6B1_STAGING_RPO_RTO=UNAPPROVED`; `NO_DEPLOY`; `NO_GO`.

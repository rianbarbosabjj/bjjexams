# Marco 9 — Gate 9.4C3: uuid 11.1.1 / gaxios transitivo sem vulnerabilidades npm reportadas

**Estado do código: correção transitive override proposta para PR, sem deploy.** O CI de experimento em runner isolado resolveu a dependência e executou `npm ci`, `gaxios` CommonJS e `npm audit`: **0 vulnerabilities** (`0 critical`, `0 high`, `0 moderate`, `0 low`), sem atualizar nenhuma das quatro dependências diretas. A comprovação no HEAD definitivo do PR será verificada novamente antes do merge.

## Por que os dois alertas moderados tinham a mesma causa

O `package-lock.json` continha apenas uma instalação de `uuid@9.0.1`, exigida por `gaxios@6.7.1` (`uuid: ^9.0.1`). A dependência `gaxios@6.7.1` era transitiva por `@google-cloud/storage` e seus clientes de autenticação. O advisory público de `uuid` é **GHSA-w5hq-g745-h8pq** (CVE-2026-41907): `v3/v5/v6` não validavam corretamente limites de buffers fornecidos. Versões corrigidas incluem `uuid@11.1.1`, que mantém suporte a **CommonJS**; `uuid@12+` perde CommonJS. Uma vulnerabilidade direta de `uuid` gerou o alerta agregado do `gaxios` dependente.

## Remediação controlada

No root **`functions/package.json`**, foi aplicado o único override `"overrides": {"uuid": "11.1.1"}`. Embora a sintaxe seja global para o pacote `uuid`, o lockfile tinha **somente um exemplar de `uuid`**, portanto o override afeta apenas esse pacote transitive. Não foram usados `--force`, `npm audit fix` automático permanente, novos pacotes diretos, fork não auditado ou alteração major dos Firebase SDKs.

**Alteração exata do lockfile gerado pelo npm:** `node_modules/uuid` de 9.0.1 para 11.1.1 (uma entrada), preservando `resolved=https://registry.npmjs.org/uuid/-/uuid-11.1.1.tgz` e `integrity` SHA-512 fornecido pelo npm. `gaxios@6.7.1` permanece no mesmo major; as outras cópias de `gaxios@7.3.1` não dependem de uuid. `@grpc/grpc-js@1.14.6`, `brace-expansion@2.1.7`, `proxy-addr@2.0.8` continuam corrigidos.

Dependências diretas sem alteração: `axios=1.20.0`, `firebase-admin=14.4.0`, `firebase-functions=7.3.2` e `form-data=4.0.6`.

## Contratos e regressões

`tests/marco9-uuid-override-compat-v1_2.test.js` inspeciona a árvore do lock, o único override, as quatro dependências diretas, os três fixes anteriores e testa com Node os imports CommonJS de `gaxios`, `uuid` e módulos do Firebase Admin, além da geração `v4()` e dos limites dos buffers artificiais para UUID `v3` e `v5`.

O CI segue instalando com `npm ci --prefix functions --ignore-scripts --no-audit --no-fund`, executando 133/133 regressões, verificações de Auth/RBAC, chamadas financeiras simuladas e Firestore Emulator isolado. A auditoria pública posterior ao install é obrigatória; ela só é considerada livre de findings quando `metadata.vulnerabilities.total=0` em um JSON válido. Erro de registry/JSON ou findings novos causa falha explícita; **zero achados em uma data NÃO significa código imune a vulnerabilidades futuras**.

## Limites de liberação

- Os testes não acessam nem fazem deploy no Firebase `bjj-exams-staging` ou no projeto produção `bjj-exams`. Nenhum dado pessoal, Asaas Sandbox/produção, certificado real ou webhook foi processado.
- A auditoria npm é restrita às dependências de produção (`--omit=dev`). Não avalia HTML/CDN, controle de autorização, infraestrutura, políticas de retenção, App Check real ou STRIDE em staging.
- O Gate 9.4C ainda exige revisão manual dos cenários STRIDE e um aceite técnico formal, mesmo após zerar findings npm.
- O Marco 9 mantém `NO_GO`, `NO_DEPLOY` e enforcement desativado: App Check reCAPTCHA Enterprise e CSP staging precisam de homologação, HMAC/TTL não estão ativos, política LGPD pendente, backup gerenciado e `RPO/RTO` não aprovados, teste de carga real e aceite humano ainda abertos.
- Webhook e checkout **Asaas Sandbox** continuam protegidos pelo isolamento anterior. Nenhuma mutação de dados reais foi executada.

**Aceite do Gate de código 9.4C3:** zero findings npm em CI no HEAD exato, compatibilidade CommonJS e regressões completas verdes, sem deploy. O Gate 9.4C operacional e Marco 9 não são encerrados automaticamente.

Referências públicas: https://github.com/advisories/GHSA-w5hq-g745-h8pq ; https://docs.npmjs.com/cli/configuring-npm/package-json/ ; https://github.com/uuidjs/uuid

# Marco 9.4C6 — atualização das dependências em 17/11/2026

## Problema e escopo

A auditoria atual do lockfile integrado em `develop-v1.2` voltou a reportar
8 entradas: 2 altas, 5 moderadas e 1 baixa. A correção atualiza somente
dependências transitivas dentro dos intervalos já aceitos pelos seus pais.
As quatro dependências diretas e o override `uuid: 11.1.1` permanecem iguais.
Não há alterações em funções de negócio, Rules, Hosting, secrets ou IAM.

Base: `356c3c00bcfd81f06d76773fadea332b69589196`.

## Atualizações principais

| Dependência | Antes | Depois |
| --- | --- | --- |
| body-parser | 2.3.0 | 2.4.0 |
| follow-redirects | 1.16.0 | 1.16.3 |
| fast-xml-parser | 5.11.1 | 5.12.1 |
| qs | 6.16.0 | 6.17.1 |
| @google-cloud/firestore | 9.1.0 | 9.4.1 |
| @google-cloud/firestore-api | 0.2.0 | 0.7.1 |
| google-gax | 6.3.0 | 6.17.0 |

O Firebase Admin continua em 14.4.0, cujo intervalo de Firestore é `^9.1.0`.
Firestore 9.4.1 aceita `firestore-api ^0.7.0` e `google-gax ^6.12.1`.
Isso elimina a árvore antiga `firestore-api 0.2.0 -> google-gax 5.0.8 ->
rimraf 5 -> glob 10 -> minimatch 9`, sem forçar versões principais por override.
As dependências auxiliares dessas bibliotecas também são resolvidas no lockfile.

`brace-expansion` deixa de ser necessário com a retirada dessa árvore. Os
contratos históricos dos gates 9.4C2 e 9.4C3 permitem sua ausência; o primeiro
confere que a cadeia antiga inteira está ausente. Os sentinelas instalados
`@grpc/grpc-js 1.14.6`, `proxy-addr 2.0.8` e `uuid 11.1.1` continuam verificados.

## Verificação

- Instalação reproduzível com `npm ci --prefix functions --ignore-scripts` em Node 22.23.2.
- `npm audit --prefix functions --omit=dev --json`: **0 vulnerabilidades reportadas** em 17/11/2026.
- Regressão local: **201/201 arquivos de testes aprovados** em Node 22.23.2
  (88 do Marco 8, 45 dos marcos anteriores, 28 do Marco 9 e 40 de backend).
- Integração Firestore: **23/23 arquivos aprovados** para transações, consultas,
  idempotência, exames, certificados, reversões e migração, em emulador local.
- Segurança no emulador: **4/4 arquivos aprovados** para concorrência do rate
  limiter, recuperação sintética e carga limitada. Usado o endereço local
  `127.0.0.1:8080` exigido pelos contratos e somente projetos `demo-*`.
- Total selecionado: **228/228 arquivos de testes aprovados**. Recuperação e
  carga sintéticas não substituem os exercícios gerenciados de homologação.
- O CI do SHA candidato deve terminar aprovado antes da mesclagem.

Zero alertas no registro npm é uma verificação pontual de dependências, não
atestado de ausência de falhas nem homologação de segurança operacional.

## Estado de liberação

**MARCO9=NO_GO / NO_DEPLOY.** Esta correção não habilita App Check,
rate limiting ou produção. A PR #53 e os aceites operacionais continuam
separados. Após integração, a versão corrigida ainda precisa ser implantada
e validada no staging no escopo aprovado para a próxima etapa.

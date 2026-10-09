# Marco 9 — Gate 9.3B: CSP report-only no Firebase Hosting de staging

**Situação:** `REPORT_ONLY_CONFIGURED_IN_REPOSITORY / NO_DEPLOY / NO_ENFORCEMENT`. A política ainda não foi publicada, o funcionamento em navegadores reais ainda não foi verificado e nenhum relatório automático de violação foi coletado.

## Objetivo e escopo

- A mudança de configuração atua exclusivamente em `firebase.staging-hosting.json`, site `bjj-exams-staging`, pasta gerada `.firebase-hosting-staging` (52 arquivos na allowlist). O `firebase.json` principal não possui Hosting e o projeto de produção `bjj-exams` não é alvo.
- Foi adicionado **somente** `Content-Security-Policy-Report-Only` para `**/*.html` e para a rota inicial `/`. Ambos recebem a mesma política. A regra HTML conserva `Cache-Control: no-store, max-age=0`; a regra JavaScript conserva `Cache-Control: no-cache, max-age=0`.
- **Não há** cabeçalho `Content-Security-Policy` de enforcement, nem mudança nas páginas, scripts, Functions, Auth, RBAC, Asaas, regras ou índices Firestore.
- Esta política é **candidata para diagnóstico**, não uma allowlist validada. A presença do cabeçalho no Git não comprova que ele esteja sendo servido no Hosting real.

## Diretivas propostas

```text
default-src 'self';
script-src 'self' https://www.gstatic.com https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.google.com https://www.recaptcha.net https://recaptcha.google.com;
style-src 'self' https://fonts.googleapis.com;
connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseappcheck.googleapis.com https://southamerica-east1-bjj-exams-staging.cloudfunctions.net https://www.googleapis.com https://www.google.com https://recaptcha.google.com;
img-src 'self' data: blob: https://api.qrserver.com;
font-src 'self' https://fonts.gstatic.com;
frame-src 'self' https://www.google.com https://recaptcha.google.com;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self'
```

**Não foram adicionados** `unsafe-inline`, `unsafe-eval`, asterisco genérico (`*`) ou domínios de produção. A política report-only provavelmente indicará violações de **scripts e estilos inline**, presentes em páginas legadas. Essas violações são esperadas e **não bloquearão a execução** neste modo. Não tratar a política como apta a enforcement até que todos os fluxos passem em homologação.

## Privacidade dos relatórios e observabilidade

- Nesta etapa **não existe** `report-uri`, `report-to`, `Reporting-Endpoints`, webhook receptor nem serviço externo de coleta de CSP. Portanto, **nenhum envio automático de relatórios foi configurado**. O modo report-only é usado inicialmente para análise **manual** de violações no Console/DevTools de navegadores compatíveis, após um deploy de staging autorizado.
- O navegador pode apresentar mensagens de violações no Console. Não registrar URLs completas, cookies, caminhos personalizados, query strings, referrers, amostras de scripts, Firebase ID tokens, pagamento, CPF ou informações de prova no GitHub, no chat ou em sistemas externos. Registrar somente diretiva, classe do recurso, origem sem caminho e contagens agregadas quando apropriado.
- Não afirmar `REPORTING_ENABLED`: sem destino `report-to`/`report-uri`, a coleta persistente de violação não está habilitada. A definição de um receptor com tratamento LGPD, controle de acesso e retenção requer um gate separado.
- `report-only` **não é mecanismo ativo de proteção** contra XSS; a política real deverá ser revista, ajustada e habilitada somente com testes e autorização próprios.

## Gate seguinte 9.3C — smoke controlado (PENDENTE)

1. Conferir projeto `bjj-exams-staging`, artefato 52/52, scripts necessários, e revisar os dois globs de HTML, inclusive acesso à página inicial `/`. Nenhum deploy em produção.
2. Após autorização **separada e explícita** para o ambiente staging, publicar somente a configuração/artefato aprovado. Antes disso, a política continua apenas versionada.
3. Abrir DevTools → Network e confirmar o header **`Content-Security-Policy-Report-Only`** nas respostas da home e das páginas HTML; confirmar que não existe `Content-Security-Policy` de enforcement. Conferir `Cache-Control` das páginas e JavaScript.
4. No Console/DevTools, observar as diretivas diagnosticadas em navegação real: login/Auth, catálogo de cursos, estudante/exame, professor, certificado/QR/PDF, console e checkout **Asaas Sandbox**. Validar `script-src`, `style-src`, `connect-src`, `img-src`, `font-src`, `frame-src` e permissões necessárias para reCAPTCHA.
5. O App Check real do Gate 9.1C2B ainda depende da chave reCAPTCHA Enterprise cadastrada no Firebase staging. **Não presumir** que suas chamadas e frames tenham sido homologados. Não ligar enforcement App Check nem rate limiting nesta etapa.
6. Registrar apenas totais sanitizados de violações e riscos/compatibilidade. Confirmar ausência de regressões e preparar reversão: remover os cabeçalhos report-only do arquivo staging, gerar novamente o Hosting allowlist, revalidar e efetuar novo deploy **somente mediante autorização**.
7. Em gate posterior, migrar JS/CSS inline gradualmente ou aplicar hashes/nonces seguros, avaliar terceiros/CDNs e revisar a política final antes de propor `Content-Security-Policy` obrigatória.

## Aceite deste PR

- CI: 133/133 regressões, contratos anteriores, testes Firestore Emulator em projeto fictício, inventário CSP dos 52 arquivos e teste específico de 11 diretivas.
- Regra `Cache-Control` e arquivos do frontend inalterados. `Content-Security-Policy` obrigatória ausente; `report-uri`/`report-to` inexistentes.
- `CSP_REPORT_ONLY=CONFIGURED_NOT_DEPLOYED`; `REPORT_COLLECTION=NOT_CONFIGURED`; `CSP_ENFORCEMENT=NOT_ENABLED`; `PRODUCTION_ACCESS=NOT_RUN`.

Referências oficiais: https://firebase.google.com/docs/hosting/full-config#configure_headers ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only ; https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider

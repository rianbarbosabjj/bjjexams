# Marco 9 — Lote conjunto 9.1C2B / 9.3C: kit de homologação do navegador em staging

**Situação: TOOLKIT_READY / NO_DEPLOY / NO_ENFORCEMENT / NO_GO.** A conclusão deste PR não constitui cumprimento operacional dos Gates 9.1C2B e 9.3C. Não houve acesso HTTP a staging, cadastro de reCAPTCHA Enterprise, publicação de Hosting nem validação de clientes reais.

## Por que testar App Check + CSP no mesmo lote?

Os sete fluxos com inicialização opt-in do App Check (login, catálogo, cursos, aluno, professor, exame e shell administrativo) já estão preparados para receber uma **site key Web pública** apenas no artefato Hosting gerado. O cabeçalho CSP `Content-Security-Policy-Report-Only` foi versionado para `**/*.html` e `/`, mas não publicado.

A injeção no HTML usa `<script>window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__ = ...</script>` imediatamente antes do runtime Firebase. Esse trecho inline, assim como outros scripts e estilos legados, deve produzir avisos de `script-src` quando a política report-only sem `unsafe-inline` estiver de fato servida. Isso **não deve bloquear** o fluxo no modo report-only. Não usar os avisos como justificativa automática para inserir `unsafe-inline` na CSP final. Antes de enforcement, revisar hashes, nonces ou migração de scripts e fazer smoke visual funcional.

## Ferramenta 9.3C — HTTP público read-only, opt-in explícito

`scripts/probe-staging-http-security-v1_2.js` inspeciona somente respostas HTML públicas, sem executar JavaScript. Exige autorização explícita na linha de comando, recusa CI e aceita exclusivamente `https://bjj-exams-staging.web.app` ou `https://bjj-exams-staging.firebaseapp.com`, sem barra final, porta, parâmetros ou usuário/senha.

É um **GET seguro, sem credenciais nem cookies**, em sete caminhos fixos (`/`, `/login.html`, `/catalogo.html`, `/cursos.html`, `/painel_aluno.html`, `/exame.html`, `/admin_shell_v1_2.html`). Nunca envia token Auth ou App Check, nem faz POST, não segue redirecionamento e usa timeout por requisição. Não lê HTML de resposta: cancela o corpo. Apenas compara o cabeçalho `Content-Security-Policy-Report-Only` com a versão exata do JSON local; confere ausência de CSP obrigatória/receptor de relatórios e cache HTML esperado. O relatório expõe somente rotas públicas fixas e estados sanitizados, nunca conteúdo da página, cookies, headers brutos, URLs completas, stack traces ou dados pessoais.

**A ferramenta NÃO valida login, backend, tokens App Check, reCAPTCHA, cookies reais, certificados, checkout ou a CSP no navegador.** Mesmo quando obtiver 7/7 cabeçalhos esperados, sua saída permanece `releaseDecision=NO_GO`, `manualBrowserValidation=PENDING` e `realAppCheckTokenValidation=PENDING`.

### Uso operacional futuro — SOMENTE com autorização de leitura em staging

No terminal local, com o repositório atualizado e sem variáveis de credenciais exportadas:

```powershell
node scripts/probe-staging-http-security-v1_2.js --probe-staging https://bjj-exams-staging.web.app --ack-staging-authorization
```

Essa ação faz requisições GET públicas **quando executada pelo operador**. Não é executada no CI nem neste PR. Nenhuma ação de deploy está embutida. O resultado será `HEADERS_MATCH_VERSIONED_POLICY` somente se o Hosting real já estiver servindo a versão esperada. Caso contrário, registrar o status sanitizado e investigar — **não contornar a comparação nem fingir publicação**.

## Homologação real conjunta — sequência autorizada, ainda pendente

1. **Registro da chave:** conferir projeto Google Cloud/Firebase `bjj-exams-staging`, domínios staging e Web appId; criar/registrar uma chave score-based reCAPTCHA Enterprise para App Check, sem ativar enforcement. Não compartilhar a site key no chat ou Git por conveniência; tokens e secrets nunca devem ser compartilhados.
2. **Preparar Hosting:** gerar artefato 52/52 com `node scripts/build-staging-hosting-v1_2.js`; verificar artefato limpo, e depois inserir a chave pública nas sete páginas via `scripts/prepare-staging-appcheck-sitekey-v1_2.js` seguindo `docs/architecture/MARCO_9_1C2_STAGING_KEY_PREFLIGHT.md`. Não injetar chave falsa em ambiente real.
3. **Autorizar publicação:** revisão do projeto, conta IAM, arquivos exatos e plano de rollback; deploy específico do Hosting **exclusivamente staging** somente em gate operacional separado. Este PR não chama Firebase CLI para publicar.
4. **Verificar cabeçalhos:** executar o probe read-only, confirmar no DevTools → Network da home e HTML `Content-Security-Policy-Report-Only` e ausência de `Content-Security-Policy` enforcing; verificar cache e sem receptores `report-to`/`report-uri` ou `Reporting-Endpoints`.
5. **Validar navegador:** testar fluxo anônimo/catalogo, login Firebase Auth, aluno/prova, professor, cursos, certificado/QR/PDF, console administrativo e checkout **Asaas Sandbox**. Em DevTools → Console, anotar apenas diretiva CSP, origem (sem caminho/query) e frequência; confirmar scripts inline esperados e dependências Firebase/reCAPTCHA. Nunca copiar código de resposta, token, CPF, gabarito ou payload financeiro.
6. **Comprovar App Check:** observar inicialização do SDK, refresh, `X-Firebase-AppCheck` sem expor valor, comportamento de clientes com token ausente/inválido/expirado (emulador/staging apropriado); exportar **apenas** logs autorizados do projeto staging e analisá-los offline com `scripts/analyze-appcheck-staging-logs-v1_2.js`, mantendo enforcement desligado.
7. **Riscos e rollback:** registrar falhas sanitizadas por página, endpoints funcionais e controle responsável; se houver regressão, reverter apenas o artefato/header staging à versão anterior aprovada, validar novamente e realizar qualquer deploy corretivo só com autorização. Não alterar `main`, `bjj-exams` produção, segredos ou webhooks externos.

## Aceite de código e pendências

CI roda somente mocks dos sete GETs: caminho e domínio fixos, HEADERS_MATCH, cache divergente, CSP ausente, CSP obrigatória inesperada, destino de reporting, redirecionamento e falha de rede; testa que produção e URLs suspeitas são recusadas e que os sete bootstraps App Check estão nos arquivos-fonte. Testes prévios (133/133 regressões, emulador e Gate 9.8A NO_GO) continuam obrigatórios.

**Status real dos gates:** `9.1C2B=REQUIRES_REAL_ENTERPRISE_REGISTRATION_AND_BROWSER_SMOKE`; `9.3C=REQUIRES_AUTHORIZED_STAGING_HOSTING_AND_DEVTOOLS`; `9.1D=NOT_ENABLED`; `9.3D=NOT_ENABLED`; `NO_DEPLOY`; `NO_ENFORCEMENT`; `NO_GO`.

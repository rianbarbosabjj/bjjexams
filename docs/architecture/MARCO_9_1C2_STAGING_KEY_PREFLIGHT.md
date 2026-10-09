# Marco 9 — Gate 9.1C2A: preparação da chave pública para Hosting staging

**Status:** `CODE_READY_ONLY`. Nenhuma chave real foi cadastrada, nenhum deploy foi feito e não há homologação real do App Check. O gate 9.1C2B continua pendente.

## Escopo e proteção

- Branch derivada da `develop-v1.2` no commit `bbf9b62a808c5689e70ca614edeef834a599bdf6` (PR #26, Gate 9.1C1).
- Projeto permitido **exclusivamente**: `bjj-exams-staging`, site do Firebase Hosting `bjj-exams-staging`; produção `bjj-exams` não deve ser acessada nem receber deploy.
- A chave **Web site key pública** do reCAPTCHA Enterprise deve ser cadastrada no App Check do app web de staging. Ela NÃO é uma API key secreta nem um token App Check. Nunca colocar a chave secreta de integração, token de sessão, chave Asaas ou credenciais Google Cloud no script.
- `scripts/prepare-staging-appcheck-sitekey-v1_2.js` modifica somente sete páginas `.html` **na pasta gerada** `.firebase-hosting-staging`, copiadas e auditadas pelo builder de 52 arquivos. Ele não altera arquivos-fonte, não introduz novos arquivos publicados, não cria serviço externo e não executa deploy.
- O script exige a variável de ambiente `BJJ_EXAMS_STAGING_APPCHECK_SITE_KEY`, formato ASCII compatível com chaves web, staging Hosting oficial e artefato recém-gerado/idêntico ao repositório.
- A injeção cria `window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__` imediatamente **antes** do script `js/firebase-runtime-v1_2.js` em: login, catálogo, cursos, aluno, professor, exame, shell administrativo.
- A chave pública aparecerá no HTML publicado quando um deploy futuro de staging for autorizado. Isso é normal para site keys Web; dados confidenciais e tokens App Check nunca devem ser inseridos no HTML.

## Cadastro externo (pendente; operador com acesso aos consoles)

1. Acessar [Google Cloud Console — Fraud Defense / reCAPTCHA Enterprise](https://console.cloud.google.com/security/recaptcha) e selecionar o projeto **`bjj-exams-staging`**; conferir a seleção antes de criar qualquer recurso.
2. Se necessário habilitar a API reCAPTCHA Enterprise no **mesmo** projeto. Criar uma **chave Web score-based** (sem checkbox/challenge), autorizando `bjj-exams-staging.web.app` e `bjj-exams-staging.firebaseapp.com`. Não cadastrar `localhost` em chave que será publicada em ambiente real.
3. No [Firebase Console — App Check](https://console.firebase.google.com/), selecionar o projeto **`bjj-exams-staging`**, abrir **Security → App Check → Apps**, localizar o aplicativo web correto (conferir Firebase `appId`), registrar usando **reCAPTCHA Enterprise** e informar a Web site key criada.
4. Não habilitar `enforceAppCheck: true` nas Functions, não marcar enforcement no console, não alterar Auth, regras ou APIs financeiras. Deixar TTL e limiar de risco nos valores padrão enquanto coleta evidência real.
5. Guardar o valor da site key em local apropriado para uso operacional temporário, nunca em `.env` versionado, histórico compartilhado, issue, mensagem pública ou PR.

## Preparar artefato local no PowerShell (sem deploy)

Em `C:\Users\rian.oliveira\Desktop\BJJ Exams_repo` após atualizar `develop-v1.2`:

```powershell
$ErrorActionPreference = 'Stop'
git status --short
git branch --show-current
node --version
node scripts/build-staging-hosting-v1_2.js
node tests/staging-hosting-artifact-v1_2.test.js

# Somente a CHAVE PÚBLICA Web score-based emitida pelo Google Cloud staging.
# Preferir entrada interativa; não versionar, imprimir nem salvar em transcript.
$Key = Read-Host 'Chave pública reCAPTCHA Enterprise do staging'
$env:BJJ_EXAMS_STAGING_APPCHECK_SITE_KEY = $Key
try {
  node scripts/prepare-staging-appcheck-sitekey-v1_2.js
  if ($LASTEXITCODE -ne 0) { throw 'APP_CHECK_STAGING_PREPARATION_FAILED' }
} finally {
  Remove-Item Env:BJJ_EXAMS_STAGING_APPCHECK_SITE_KEY -ErrorAction SilentlyContinue
  Remove-Variable Key -ErrorAction SilentlyContinue
}
```

Resultado esperado: `APP_CHECK_STAGING_KEY_INJECTION=7/7`, `APP_CHECK_STAGING_ARTIFACT=PREPARED_NOT_DEPLOYED`, `APP_CHECK_ENFORCEMENT=NOT_ENABLED`.

**ATENÇÃO:** o teste `staging-hosting-artifact-v1_2.test.js` valida arquivos idênticos e deve rodar **antes** da injeção. Após a injeção, o artefato deixa de ser byte-idêntico apenas nas sete páginas permitidas. Para descartar a preparação ou reutilizar os testes 52/52, executar novamente o builder; ele regenera o artefato limpo. **A preparação local não equivale a deploy.**

## Próximo gate 9.1C2B — homologação real, ainda bloqueada

- Obter registro real da Web app de staging no Firebase App Check e da site key (nenhuma prova recebida neste momento).
- Revisar o artefato, função de inicialização e os domínios autorizados, e liberar **separadamente** um deploy seletivo de staging, sem tocar produção.
- Realizar navegação real: catálogo público, curso, login, aluno/exame, professor, certificação, administração; compras apenas Asaas Sandbox, callback webhook com token próprio.
- Exportar logs somente de `bjj-exams-staging` e analisá-los **offline** com `scripts/analyze-appcheck-staging-logs-v1_2.js` (Gate 9.1C1). Não publicar exportação bruta.
- Confirmar proporção dos eventos `VALID`, `MISSING` e `INVALID` e cobertura de clientes; não ativar enforcement neste gate. O Gate 9.1D dependerá de autorização específica e rollback.

## Testes do PR

`tests/marco9-appcheck-hosting-injection-v1_2.test.js` usa chave **fictícia**, valida ausência/má-formação, staging-only, zero alteração em fonte, exclusividade às sete páginas, proteção contra dupla injeção e restauração da allowlist 52/52. O workflow de CI mantém as 133 regressões dos marcos anteriores, os contratos de App Check 9.1A–9.1C1 e este novo teste, **sem credenciais nem deploy**.

## Referências oficiais

- [Firebase — App Check Web com reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
- [Firebase — Monitorar métricas do App Check para Cloud Functions](https://firebase.google.com/docs/app-check/monitor-functions-metrics)

**Estado final máximo deste PR:** `GATE_9_1C2A=CODE_READY`, `REAL_SITE_KEY=NOT_VERIFIED`, `STAGING_DEPLOY=NOT_RUN`, `ENFORCEMENT=NOT_ENABLED`.

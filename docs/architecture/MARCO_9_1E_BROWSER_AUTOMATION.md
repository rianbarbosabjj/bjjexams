# Marco 9.1E — Playwright local no staging

**Estado: PREPARED_NOT_EXECUTED_LIVE / PR #53 DRAFT / MARCO9=NO_GO.**

Objetivo: automatizar quatro operações administrativas de leitura no
https://bjj-exams-staging.web.app, sem deploy e sem escritas de negócio.
O teste comprova status HTTP e presença de App Check/Auth no navegador;
a validação de tokens ausentes/inválidos pelo backend continua pendente.

## Componentes

- tools/marco9-browser/runner.cjs — modo --login ou --run.
- tools/marco9-browser/package.json — playwright-core fixado em 1.64.0,
  Chrome instalado no Windows (channel chrome), sem baixar outro navegador.
- tests/marco9-appcheck-browser-automation-v1_2.test.js — testes offline
  e sem dependências novas no GitHub Actions.
- Perfil do navegador: %LOCALAPPDATA%\BJJExams\marco9-browser\chrome-profile.
  Perfil contém cookies e dados de sessão, deve permanecer privado no
  computador do operador; nunca anexar ao chat, GitHub ou CI.
- Relatório sanitizado: %LOCALAPPDATA%\BJJExams\marco9-browser\reports\last-report.json.
  Inclui somente status HTTP, booleans de presença dos cabeçalhos, estado
  de rota e resultado geral. Não salva tokens, e-mails, cookies, corpos
  de resposta/requisição, screenshots, HAR ou conteúdo das tabelas.

## Pré-requisitos e execução

Node.js 22+ e Google Chrome instalado. Conta administrativa temporária
no staging. Usar apenas um worktree isolado atualizado para o SHA do
PR aprovado no CI. A cópia local original fixada em ad35e52... é
anterior ao runner e precisa ser atualizada de forma controlada.

Execute no PowerShell, no worktree atualizado e limpo:

    $Novo = "$HOME\Desktop\BJJ Exams_PR53_Marco9"
    npm install --prefix "$Novo\tools\marco9-browser" --ignore-scripts --no-audit --no-fund
    node "$Novo\tests\marco9-appcheck-browser-automation-v1_2.test.js"
    node "$Novo\tools\marco9-browser\runner.cjs" --login
    node "$Novo\tools\marco9-browser\runner.cjs" --run

No modo --login, digitar usuário e senha apenas na janela Chrome
aberta e pressionar ENTER no terminal quando concluir. A automação
não conhece a senha. A sessão local será reutilizada no modo --run
até expirar, quando será preciso repetir --login.

## Matriz de execução

| Callable | Acionamento | Critério |
| --- | --- | --- |
| obterContextoAdministrativoV12 | bootstrap do painel | HTTP 200, Auth e App Check |
| listarPessoasOperacionaisV12 | activate("people") | HTTP 200, headers e rota pronta/vazia |
| listarOrganizacoesOperacionaisV12 | activate("organizations") | HTTP 200, headers e rota pronta/vazia |
| listarCursosOperacionaisV12 | activate("courses") | HTTP 200, headers e rota pronta/vazia |

A automação bloqueia requisições a Cloud Functions fora do staging,
Hosting da produção e caminhos de Firestore da produção. Não aciona
botões de mutação ou endpoints de ações e nunca faz deploy/merge.

Resultado AUTOMATED_STAGING_SMOKE=PASS significa somente que quatro
chamadas autorizadas funcionaram com cabeçalhos presentes. Não prova
a verificação de token pelo backend, a rejeição de MISSING/INVALID,
RBAC do professor ou o rollback operacional.

## Segurança, limitações e STOP

- Login falhou, conta sem autorização, rota incompleta, HTTP inesperado
  ou App Check ausente: REVIEW_REQUIRED, sem repetição destrutiva.
- Nunca colar credenciais na linha de comando ou ChatGPT. Não utilizar
  qualquer token anteriormente divulgado para automação.
- Não expor o perfil Chrome local nem o relatório com outros dados.
  Caso não precise mais da sessão, sair da conta e fechar o Chrome
  de teste antes de excluir apenas a pasta do perfil acima.
- Não executar testes negativos no backend protegido sem autorização
  separada, janela de monitoramento e plano de rollback específico.
- Produção bjj-exams permanentemente fora do escopo deste PR.

## Evidência disponível antes da primeira execução Playwright

- Cloud Builds 4/4 SUCCESS; revisões anteriores 4/4 Ready;
- Hosting 7/7 com SDK e chave pública;
- navegador: SDK inicializado e token App Check disponível;
- execução real com Playwright: AINDA NÃO REALIZADA;
- PR #53 em rascunho, sem deploy, sem merge, MARCO9=NO_GO.

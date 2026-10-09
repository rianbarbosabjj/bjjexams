# Marco 9 — Gates 9.1C2C e 9.3C1: aceite offline de artefato App Check/CSP e rollback local

**Estado: LOCAL_HOSTING_ARTIFACT_VERIFIED / NO_GO / NO_DEPLOY / NO_ENFORCEMENT.** Estes dois subgates não concluem os gates operacionais 9.1C2B (App Check reCAPTCHA Enterprise real) e 9.3C (CSP em Hosting staging). Não houve cadastro de chave, teste DevTools, publicação Firebase, contato com staging ou alteração Asaas Sandbox.

## Objetivo

O kit de Hosting anterior gerava 52 arquivos de uma allowlist e injetava uma chave pública nas sete páginas de bootstrap do App Check. O novo `scripts/verify-staging-hosting-artifact-v1_2.js` produz **evidência de equivalência e rollback determinístico** entre a fonte no repositório e o artefato gerado. O script funciona somente em arquivos locais e não executa Firebase CLI, não lê segredos, não realiza rede nem usa permissões de deploy.

## Invariantes verificadas

- `firebase.json` principal deve continuar sem `hosting`; configuração isolada `firebase.staging-hosting.json` aponta para site exato `bjj-exams-staging` e diretório `.firebase-hosting-staging`.
- CSP aceita exclusivamente a política `Content-Security-Policy-Report-Only` idêntica no `/` e em `**/*.html`; bloqueia qualquer `Content-Security-Policy` enforcing, `report-to`, `Reporting-Endpoints`, `unsafe-eval`, `unsafe-inline` e destino de Cloud Functions produção.
- O diretório de saída deve conter **exatamente os 52 arquivos allowlist**, sem arquivos extras, arquivos ausentes, symlinks ou itens especiais.
- Em modo pristine, todo byte de cada arquivo gerado deve coincidir com a fonte. Em modo App Check, exatamente **7 páginas** contêm a injeção equivalente à criada pelo preparador existente, e as outras 45 ficam idênticas. Nenhuma chave pública real é escrita em Git, log ou artefato permanente de CI.
- Hash SHA-256 determinístico dos 52 caminhos e conteúdo original permite comparar estado antes de injeção, após injeção sintética e após **rollback por rebuild**. Esse hash é de **arquivos locais normalizados**, não de uma versão de Hosting efetivamente publicada.
- Uma alteração em página injetada, JavaScript não relacionado, arquivo extra/ausente ou symlink deve causar falha, sem prosseguir para qualquer suposta aprovação.

## Teste completo sem credenciais

`tests/marco9-staging-artifact-rollout-v1_2.test.js` chama `build()` 52/52, valida pristine, injeta uma site key **SINTÉTICA**, valida sete bootstraps e CSP report-only, simula alterações indevidas e objetos desconhecidos, reconstrói o artefato e exige a igualdade do hash. O bloco `finally` regenera a saída pristine e verifica que todos os 52 arquivos-fonte permaneceram iguais. A chave falsa não deve aparecer em logs, código-fonte nem relatório do validador.

A execução termina com `MARCO9_GATE_9_1C2C_9_3C1_ARTIFACT_ROLLBACK=PASSED`, `NO_DEPLOY` e decisão `NO_GO`, mesmo se todos os testes passarem. O CI mantém a regressão anterior 133/133, isolamento do Firestore Emulator, auditoria npm e matriz RC sem liberação.

### Verificação local do artefato pristine

```powershell
node scripts/build-staging-hosting-v1_2.js
node scripts/verify-staging-hosting-artifact-v1_2.js --verify-pristine
```

O modo injected só é exposto como função interna de teste (`inspectStagingArtifact({siteKey})`), após validação de entrada; nenhum comando de deploy ou publicação está incorporado. A ferramenta verifica somente o artefato em disco, não a instalação no serviço de Hosting.

## Plano operacional futuro, ainda não autorizado

1. Registrar a site key pública de reCAPTCHA Enterprise no App Check **somente** do projeto `bjj-exams-staging`, validar domínios e aplicativo Web; não habilitar enforcement.
2. Fazer backup/versionamento aprovado da versão anterior do Hosting staging e registrar dono, escopo de deploy, janela e plano de rollback; nunca tentar reverter produção.
3. Após autorização específica, gerar o artefato com site key real **fora do Git** e revisar a lista de 52 arquivos, CSP report-only, URLs e diferenças esperadas. O teste local sintético não prova que a site key real foi registrada.
4. Autorizar em outra etapa a publicação **exclusiva** do Hosting staging. Essa autorização não é concedida por merge de PR.
5. Confirmar com DevTools o cabeçalho `Content-Security-Policy-Report-Only` e as violações de scripts inline sem quebrar fluxos; verificar App Check / reCAPTCHA Enterprise, Auth, exames, certificados, checkout **Asaas Sandbox** e console administrativo. Não registrar tokens, payloads financeiros, CPFs ou gabaritos.
6. Se houver regressão, executar rollback **real de Hosting** somente com autorização de staging e validar no navegador. Reconstrução do artefato local não é rollback cloud e não restaura dados/Functions.

**Status real:** `9.1C2B=OPERATIONAL_STAGING_REGISTRATION_PENDING`, `9.3C=OPERATIONAL_BROWSER_SMOKE_PENDING`, `9.1D=NOT_ENABLED`, `9.3D=NOT_ENABLED`, `NO_GO`, `NO_DEPLOY`, `NO_ENFORCEMENT`.

# IAM de Callable Functions - BJJ Exams v1.2

## Objetivo

Registrar o requisito operacional de invocacao das Firebase Callable Functions Gen2 do BJJ Exams durante a transicao para a arquitetura v1.2.

## Contexto validado

Em 14/09/2026, resolverPerfilUsuario foi validada no ambiente de staging:

- Projeto: bjj-exams-staging
- Regiao: southamerica-east1
- Plataforma: Cloud Functions Gen2
- Runtime: Node.js 22
- Servico Cloud Run: resolverperfilusuario

A Function utiliza onCall e mantem autenticacao de aplicacao por meio de requireAuth(request).

Existem duas camadas distintas de controle:

1. Cloud Run IAM permite que a requisicao HTTP alcance a Callable Function.
2. Firebase Authentication e requireAuth(request) controlam o acesso funcional.

## Particularidade do firebase-functions 7.3.2

Na versao firebase-functions 7.3.2, a opcao invoker declarada diretamente em onCall nao e serializada no manifesto efetivo da Callable Function.

Por isso, invoker: public nao deve ser tratado como fonte de verdade para resolverPerfilUsuario.

O binding de invocacao da Function Gen2 deve ser tratado como configuracao operacional de infraestrutura.

## Configuracao validada em staging

Somente no projeto bjj-exams-staging, resolverPerfilUsuario possui o binding:

- member: allUsers
- role: roles/run.invoker

Esse binding nao torna o conteudo da operacao anonimamente acessivel.
O handler continua exigindo Firebase Authentication atraves de requireAuth(request).

## Aplicacao pelo Cloud Shell

Antes de qualquer alteracao, confirmar o projeto:

    gcloud config get-value project

O resultado deve ser exatamente:

    bjj-exams-staging

Aplicacao do binding:

    gcloud functions add-invoker-policy-binding resolverPerfilUsuario \
      --region=southamerica-east1 \
      --project=bjj-exams-staging \
      --member=allUsers \
      --quiet

## Verificacao do Cloud Run

    gcloud run services get-iam-policy resolverperfilusuario \
      --region=southamerica-east1 \
      --project=bjj-exams-staging

Deve existir binding equivalente a:

    members:
    - allUsers
    role: roles/run.invoker

## Smoke obrigatorio

Requisicao anonima deve retornar:

- HTTP 401
- Content-Type application/json
- Firebase status UNAUTHENTICATED

Isso comprova que a requisicao chegou ao handler e foi recusada pela autenticacao da aplicacao.

Requisicao autenticada deve retornar HTTP 200 e encontrado=true.

Depois da renovacao do ID Token, as Global Claims devem corresponder ao papel autoritativo do usuario.

## Evidencia validada no Marco 2

- ANON_STATUS=401
- ANON_FIREBASE_STATUS=UNAUTHENTICATED
- PUBLIC_INVOKER_PRIVATE_HANDLER=OK
- AUTH_STATUS=200
- ENCONTRADO=True
- PAPEL=aluno
- FONTE=usuarios
- MIGRADO=False
- CLAIM_SUPER_ADMIN=False
- CLAIM_PLATFORM_ADMIN=False
- REMOTE_CLAIMS_MATCH_ROLE=OK
- REMOTE_CONTRACT_IDEMPOTENT=True

## Regras operacionais

- Nunca executar esta configuracao em bjj-exams durante o desenvolvimento do Marco 2.
- Nunca executar em bjj-maneger.
- Um redeploy de Function existente nao deve ser considerado suficiente para recriar o binding IAM.
- Se a Function for excluida e recriada, o IAM deve ser novamente verificado.
- IAM e Firebase Authentication sao controles independentes.
- Qualquer futura promocao para producao exige validacao especifica e deliberada.

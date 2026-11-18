# BJJ Exams — auditoria e plano de entrada em operação

> Versão para repositório público. Os resultados e o plano de operação foram preservados. Identificadores de contas sintéticas, caminhos locais e IDs de recuperação foram omitidos.

Data: 17/11/2026 • Escopo: BJJ Exams v1.2

## Progresso da execução — 17/11/2026

**Etapa 1 concluída no código:** [PR #54](https://github.com/rianbarbosabjj/bjjexams/pull/54)
integrada à `develop-v1.2`, commit `e9706e9e345f6ead4662dc0dd598b190a69f5a0a`.
A auditoria passou de 8 entradas para **0 vulnerabilidades reportadas**.
Foram aprovados **228/228 arquivos de testes selecionados**: 201 locais,
23 de integração Firestore e 4 de segurança em emulador. O CI do SHA
`302fc243c38b9b00f5a182082bf0448d2a25fa31` também terminou aprovado.

**Etapa 2 em andamento:** a PR #53 recebeu a base corrigida e passou a
`a0e7bf0c4701845cc34374464f2ed96bf46a95fa`, com **203/203 arquivos locais
aprovados** e novo CI aprovado. Continua em rascunho. O operador executou
os blocos 02 e 03 no Windows: projeto e configuração web conferidos, conta
temporária identificada pelos marcadores de teste, senha sincronizada com
a credencial protegida local, login aprovado e permissões preservadas.
A evidência recebida registra `ACCESS_RECOVERY=PASS`, sem exibição de senha
ou tokens, sem escrita Firestore e sem deploy. Não é necessário repetir
a redefinição de senha.

**Quatro consultas autenticadas aprovadas:** o operador executou
`BJJ_Exams_04_Leituras_Admin_20261117.ps1` e enviou a saída com
`ADMIN_READS_PASSED=4/4` e `AUTHENTICATED_READS=PASS`. Contexto administrativo,
pessoas, organizações e cursos responderam HTTP 200 e passaram nas
checagens previstas, sem redefinição de senha, escrita de negócio ou deploy.
O teste não enviou App Check: não comprova o comportamento do navegador nem
a validação de tokens pelo backend.

**Teste no navegador com provedor de depuração aprovado:** após a correção
05A, o operador concluiu o bloco 05. A sessão administrativa ficou pronta;
as quatro funções responderam HTTP 200 com `APPCHECK_HEADER=true` e
`AUTH_HEADER=true`. Pessoas e cursos ficaram em `route-ready`; organizações
em `route-empty`, estado aceito para uma listagem vazia. O SDK ficou pronto,
o token ficou disponível e os resultados finais foram
`AUTOMATED_STAGING_SMOKE=PASS` e `BROWSER_APPCHECK_DEBUG=PASS`.
O registro temporário foi removido: `TEMP_DEBUG_REGISTRATION=DELETED`.
Não houve deploy, merge, redefinição de senha ou escrita de negócio nesse
ensaio. O resultado comprova o fluxo com o **provedor de depuração**;
não comprova o reCAPTCHA normal nem a rejeição de tokens pelo backend.

**Provedor normal aprovado:** o operador executou o bloco 06 em perfil
distinto, com `APP_CHECK_DEBUG_MODE=OFF`. As quatro funções responderam
HTTP 200 com Auth e App Check presentes; pessoas e cursos ficaram prontos,
e organizações retornou a listagem vazia aceita. Houve
`APP_CHECK_PROVIDER=STANDARD_PROVIDER`, SDK pronto, token disponível,
`AUTOMATED_STAGING_SMOKE=PASS` e `BROWSER_STANDARD_PROVIDER=PASS`.
Não houve cadastro de token de depuração, alteração de senha, escrita de
negócio, merge ou deploy. Está comprovado o fluxo atual das quatro leituras
com o provedor normal. Naquele bloco ainda não tinham sido testadas a
rejeição de tokens pelo backend, as permissões do professor ou a recuperação.
As evidências posteriores dos blocos 09B e 10 estão registradas abaixo.

**Cópia protegida da implantação atual capturada:** o operador executou o
bloco 07. Projeto confirmado, função ACTIVE/GEN_2/nodejs22, revisão
`obtercontextoadministrativov12-00001-zok` com 100% do tráfego e políticas
IAM lidas. O pacote implantado contém o arquivo principal e package-lock.
Os dois arquivos protegidos foram gravados e descriptografados novamente,
com `LOCAL_DECRYPTION_INTEGRITY=PASS` e `PILOT_RECOVERY_COPY=CAPTURED`.
Não houve alteração de configuração, dados de negócio, deploy ou merge.

- Bundle local: `20261117T153802Z-id-local-reservado`.
- SHA-256 do pacote de código: `FDB29B3AD131F674F4E885E3DEC2914DB0CDEBF05116E6A77162EA2DAF58B9FA`.
- SHA-256 da configuração capturada: `03CD673213E0BCFE408A8A0942D992E1862A8CAC571553ABEDC59A806CD9A742`.

A cópia fica protegida por DPAPI CurrentUser no Windows do operador.
Ela preserva o pacote efetivamente implantado sem presumir correspondência
com uma versão Git. A restauração do código/configuração foi comprovada depois no bloco 09B, em função temporária; a recuperação de dados permanece separada.

**Bloco 08 concluído após a correção 08A:** o operador confirmou a
integridade do comando original e do corrigido, reaproveitou o clone local
e exportou o pacote com LF. Os hashes do lockfile e do módulo administrativo
coincidiram com os blobs exigidos. A saída final confirmou
`RECOVERY_DRILL_LOCAL_PREPARATION=PASS` e `RECOVERY_DRILL_PERMISSIONS=PASS`.
As permissões de projeto e o actAs das contas declaradas de execução e build
retornaram verdadeiros. Não houve concessão de papéis, escrita de negócio,
implantação ou merge nessa preparação.

| Evidência local do operador | Valor |
| --- | --- |
| Plano | `id-local-reservado` |
| Função temporária planejada | `funcao-temporaria-de-recuperacao` |
| Commit candidato | `a0e7bf0c4701845cc34374464f2ed96bf46a95fa` |
| Árvore Functions | `290865aa22d50eb027759dfde22daae1804f55a6` |
| SHA-256 do ZIP candidato efetivamente gerado | `B56D3B874FDC9F2E27F8B2A5E7719F74732E56213C327AF60B8839E54FE20A29` |
| Limites preparados | Mínimo 0, máximo 1 instância; até 2 implantações |
| Concessão pública planejada | Nenhuma |
| Alterações planejadas nas quatro funções existentes | Nenhuma |

A divergência anterior foi reproduzida com a exportação de uma subárvore
Git e `core.autocrlf=true`. A correção fixou `core.autocrlf=false` e
`core.eol=lf` no comando de exportação, mantendo os hashes exigidos.
A configuração global real do Git do operador não foi alterada.

Hashes dos comandos completos normalizados em LF, sem espaços externos:

- 08 enviado inicialmente: `5FD784EC2C601E231F98D530C17CEC49584590169270B58B1B885792AAED369F`.
- 08 corrigido e executado pela preparação 08A: `136D1E8A5EEF46792D13C88E3740F84E20F625B833D13DEBCAF0F943284B4CB5`.

**Bloco 09 — implementação entregue e ensaio interrompido:** usa os arquivos do plano
acima e a cópia protegida 07, com hashes e destinos fixos. Cria somente a
função temporária privada no staging com a versão candidata, testa ausência
e invalidade do App Check e republica o ZIP preservado na mesma função.
A restauração usa `buildConfig.source`, `serviceConfig.environmentVariables`
e `serviceConfig.allTrafficOnLatestRevision` na máscara de atualização.
Um marcador temporário de ambiente permite conferir a volta à configuração
preparada. As demais opções de execução vêm da cópia capturada, com nome,
privacidade e capacidade adaptados ao ensaio: mínimo 0, máximo 1 instância
e concorrência 1. Isso não é uma reprodução das capacidades de produção.

O bloco confere o SHA-256 do código restaurado por novo download gerenciado,
o runtime, contas de serviço, opções verificadas do build e ambiente,
revisão pronta com 100% do tráfego e leitura autenticada HTTP 200 no destino
restaurado. Depois remove a função temporária e verifica sua ausência e a
do serviço associado. Compara versões e tráfego das quatro funções
existentes antes e depois. Não grava dados de negócio, altera senha, concede
invocação pública ou mescla PR. Os arquivos temporários de fonte e imagens
de build seguem o faturamento e a política de retenção do projeto; a remoção
da função não implica exclusão desses artefatos.

Um arquivo de execução sem credenciais registra o estado sob bloqueio local.
Se o bloco for repetido após interrupção, ele só retoma limpeza e conferência,
sem reenviar implantações. A limpeza exige projeto, nome e marcador do plano,
data de criação compatível e UID do serviço quando já registrado. Não trata
uma resposta incerta de criação como prova de remoção.

Validação local do bloco 09: análise no parser nativo PowerShell 7.5.4;
fluxo simulado de criação, restauração, releitura por hash, resposta HTTP e
remoção; bloqueio de destinos diferentes, URLs assinadas falsas, vínculo
IAM público, UID divergente e marcador de propriedade divergente; recusa
de concluir limpeza após criação de resultado desconhecido; sanitização
dos erros; transporte HTTP local com UTF-8, upload binário sem vazamento
do header OAuth e redirecionamento bloqueado. Os cenários passaram.
O teste local não utilizou credenciais reais nem APIs de nuvem. DPAPI,
gcloud no Windows e os builds foram posteriormente comprovados na execução
09B pelo operador, registrada abaixo. A PR #53 permanece em rascunho e
`MARCO9=NO_GO`.

**Resultado real do bloco 09 recebido do operador:** o comando executado
coincidiu integralmente com o arquivo entregue, após normalização de linhas
(SHA-256 `EE17A65C10BA608E19098D57B2A5A001486AE980AEC8D1A2294AA4CECE48C8B6`).
Os arquivos preparados e o escopo passaram, assim como o login da conta
sintética. A execução parou em `CREATE_PRIVATE_CANDIDATE`, com o código
sanitizado `RECOVERY_DRILL_REQUIRES_REVIEW`. Foi registrada uma submissão
de implantação. O trecho de limpeza aguardou a operação, removeu a função
temporária e conferiu as quatro funções existentes:

- `TEMPORARY_FUNCTION_REMOVAL=PASS`.
- `ORIGINAL_FUNCTIONS_VERSION_AND_TRAFFIC=UNCHANGED_4_OF_4`.
- `DEPLOYMENTS_SUBMITTED=1`.
- `CLOUD_RECOVERY_DRILL=REVIEW_REQUIRED`.

A saída do bloco 09, isoladamente, não comprovava implantação candidata pronta.
O diagnóstico 09A posterior confirmou a conclusão da criação e das etapas BUILD
e SERVICE, com build SUCCESS. Não houve teste HTTP da candidata nem rejeição de
App Check, restauração do pacote, restauração da configuração ou leitura
funcional no destino restaurado. A limpeza concluída não deve ser apresentada como ensaio
de restauração aprovado. Não houve implantação nas funções originais,
concessão pública, redefinição de senha, merge ou escrita de negócio.
**Causa identificada pelo bloco 09A:** PowerShell 5.1.22621.6133;
`Save-BjjJournal`, linha 50, `System.IO.IOException`, HRESULT `80070497`.
A linha usa `IO.File.Replace`. O código Win32 1175 (`0x497`) significa que
não foi possível remover o arquivo a ser substituído. A evidência identifica
a falha de substituição do registro local; não determina por que o sistema
de arquivos impediu essa substituição. Não há evidência de falha do build.

**Bloco 09A executado, com coleta aprovada:** captura os
registros de erro ainda disponíveis na mesma sessão PowerShell e emite
somente tipos de exceção, HRESULT, nomes de funções e números de linha.
Correlaciona as linhas com o comando 09 de hash conhecido quando disponível.
Lê o registro local de execução, consulta até três páginas de 100 operações
na região do staging e seleciona apenas a função temporária desse plano.
Emite estados, códigos numéricos, categorias fechadas e estados/exit codes
de etapas do build associado quando identificado. Confere a ausência da
função e do serviço. Não imprime mensagens brutas, argumentos, headers,
valores de credenciais, variáveis de ambiente ou registros de outras funções.
Não envia novas implantações nem altera configurações.

A análise no PowerShell nativo e os cenários offline do diagnóstico passaram:
travas de projeto/destino, seleção da função correta, estado de operação e
build, ausência de recursos, encadeamento de exceções e supressão de valores
sensíveis inseridos nas respostas simuladas. A execução real 09A confirmou:

- Um erro local, associado exclusivamente a `Save-BjjJournal` e à linha 50.
- Registro de criação aceita, uma implantação, limpeza aprovada e as quatro funções existentes preservadas.
- Duas operações relacionadas, CREATE e DELETE, concluídas com código de erro 0.
- CREATE: BUILD e SERVICE completos; build SUCCESS e três etapas SUCCESS/exit code 0.
- Função temporária ausente e serviço ausente ou marcado como excluído.
- `FAILURE_DIAGNOSIS_COLLECTION=PASS`, sem implantação ou escrita de configuração.

**Bloco 09B preparado para retomar o ensaio:** recupera o comando 09 do
histórico pelo SHA-256 integral já conferido e substitui a gravação com
`File.Replace` por registros numerados em arquivos novos. Cada registro é
escrito com Flush(true), conferido por SHA-256 e concluído com renomeação para
um nome novo. Os arquivos anteriores não são reescritos. O leitor confere
plano, função e sequência, ignora arquivos pendentes e recusa sequência
ambígua. A gravação tenta novamente apenas a renomeação local, com limite
pequeno; não repete uma chamada de implantação por falha de rede.

A retomada cria um novo plano e nome de função temporária, copiando o ZIP
candidato já verificado e o modelo protegido. Mantém os hashes das fontes e
a cópia 07. Exige o registro de limpeza do ensaio anterior e confere novamente
sua ausência na nuvem antes das implantações. Executa 30 gravações/leituras de
teste no Windows do operador antes de iniciar qualquer build. Um apontador
local persistente identifica essa única nova tentativa. Se o bloco 09B for
repetido, usa o mesmo plano; o executor retoma limpeza e conferência quando
já existe registro de execução, preservando o limite de duas implantações
nessa tentativa. O ensaio anterior teve uma implantação e já foi removido.

SHA-256 do executor corrigido canônico, antes de trocar o ID e o nome pelo
novo plano: `693F43466269072A364088057792E3E7F0D072DDE30F789BFE8BFEB8CEAAAE6F`.
O comando calcula e mostra também o hash do executor com os IDs efetivos.

Validação local 09B aprovada em PowerShell nativo: reconstrução do executor
pelo patch com hash integral; 30 gravações imutáveis e releituras; preservação
dos arquivos anteriores; retomada da sequência após reinício; tratamento de
registro em objeto JSON; descarte de arquivo pendente e recusa de sequência
duplicada. A simulação do fluxo completo de criação, restauração, releitura
por hash, HTTP e remoção também passou, com as travas de destino, IAM e UID
já verificadas. Não houve chamadas reais à nuvem nesses testes locais.
**Execução real 09B aprovada no Windows:** 30 gravações locais passaram antes
dos builds. O operador enviou `CLOUD_RECOVERY_DRILL=PASS`, com duas
implantações nessa tentativa. A candidata ficou pronta e a privacidade IAM
foi conferida; os casos App Check ausente e inválido retornaram 401. A função
temporária recebeu depois o pacote preservado, a configuração preparada
foi restaurada, o novo download gerenciado coincidiu com o SHA-256 original
e a leitura autenticada retornou HTTP 200. A função foi removida, e as
quatro funções existentes permaneceram sem alteração de versão ou tráfego.

| Evidência do ensaio 09B | Valor |
| --- | --- |
| Plano efetivo | `id-local-reservado` |
| Função temporária removida | `funcao-temporaria-de-recuperacao` |
| Executor efetivo normalizado | `61CA6B8C04CF23182BB771DAAED130F8AC5E5C3567EC287F92585121B7D9FC8F` |
| Código restaurado | `FDB29B3AD131F674F4E885E3DEC2914DB0CDEBF05116E6A77162EA2DAF58B9FA` |
| Leitura funcional após restauração | HTTP 200 / PASS |
| Limpeza | `TEMPORARY_FUNCTION_REMOVAL=PASS` |
| Versões/tráfego originais | `UNCHANGED_4_OF_4` |

O resultado comprova recuperação do código/configuração no escopo da função
temporária. Não comprova recuperação Firestore/Auth/Storage, teste com App
Check válido ou enforcement já publicado nas quatro funções existentes.
Não houve redefinição de senha, escrita de negócio, merge ou concessão de
invocação pública.

**Bloco 10 entregue e executado para o piloto real de App Check:** altera somente
`obterContextoAdministrativoV12`, no staging. Reutiliza os auxiliares de
persistência e de recuperação do executor 09B cujo hash efetivo foi aprovado
no Windows, a candidata `a0e7bf0c4701845cc34374464f2ed96bf46a95fa` e a cópia
protegida 07. Confere código/configuração anteriores e o navegador antes da
implantação. O PATCH atualiza código, tráfego para a última revisão e rótulos
de rastreio, removendo o rótulo de hash Firebase que ficaria desatualizado.
Não altera políticas IAM nem publica frontend ou outras funções.

O navegador reutiliza o perfil normal de staging e exige a conta sintética
administradora. Se necessário, solicita login manual com a senha local
copiada para a área de transferência. A matriz faz chamadas reais com Auth
+ App Check válido (200), App Check ausente (401), App Check inválido (401)
e Auth ausente com App Check válido (401). Os valores de tokens ficam no
contexto da página; apenas estados e contratos booleanos voltam ao Node e
aos relatórios. Não grava cookies, corpos de resposta ou valores de headers.

Com a matriz aprovada e as outras três funções preservadas, mantém o piloto
ativo nessa única função. Em caso de falha após a submissão, tenta retornar
ao pacote e aos rótulos preservados, com verificação de propriedade por
marcador/hash, configuração e IAM, releitura por hash e consulta autenticada
HTTP 200. O limite é de duas implantações no piloto, contando o retorno se
necessário; uma repetição utiliza os registros e não reenvia a candidata.
Exclusão de função e alterações em outro destino são bloqueadas.

Validação local do bloco 10: parser PowerShell nativo e sintaxe JavaScript;
matriz de headers e contratos; relatório sem tokens, UID ou mensagens
privadas; fluxo de sucesso, repetição sem deploy, falha na matriz com
restauração, repetição após restauração e travas de destino/DELETE/POST
indevido. Os testes simulados passaram e não chamaram APIs reais de nuvem.
SHA-256 do auxiliar JavaScript normalizado:
`ECE38BA20588805C4CAA653168E784B331B0ABEF22701C1ACB008DF526065941`.
**Execução real do bloco 10 aprovada:** o comando recebido coincide com o
arquivo entregue, após normalização de linhas. Houve uma implantação da
função existente `obterContextoAdministrativoV12`, no staging, mantendo o
piloto ativo. A pré-checagem no navegador retornou HTTP 200. Depois da
implantação, o provedor normal aprovou a matriz abaixo, com respostas e
contratos conferidos no navegador:

| Cenário real do piloto | HTTP | Resultado |
| --- | --- | --- |
| Administrador + App Check válido | 200 | PASS |
| Administrador + App Check ausente | 401 | PASS |
| Administrador + App Check inválido | 401 | PASS |
| Auth ausente + App Check válido | 401 | PASS |

Saída: `STAGING_CONTEXT_APPCHECK_PILOT=PASS`,
`BACKEND_VALID_MISSING_INVALID=PASS` e
`OTHER_FUNCTIONS_VERSION_AND_TRAFFIC=UNCHANGED_3_OF_3`.
Não houve retorno à versão anterior, escrita de negócio, redefinição de
senha, alteração de IAM ou merge. Os tokens não foram devolvidos ao Node.

**Bloco 11 preparado — professor com provedor normal:** não foi localizada
uma credencial anterior de professor nos registros disponíveis. O bloco
prepara uma conta sintética exclusiva e um único perfil `usuarios` no
staging, identificados por GUID, UID/e-mail e marcadores de propriedade.
Gera a senha aleatória e salva a credencial protegida no Windows antes da
criação; não redefine senhas nem altera contas existentes. Não concede
nenhum dos cinco papéis administrativos. As criações são registradas
antes da submissão; repetição reutiliza os recursos conferidos e não reenvia
criação de resultado desconhecido. Criação do perfil não sobrescreve um
documento existente.

Pasta de controle do operador: `pasta local protegida`.
Mantém `professor.credential.xml`, registros locais de execução, identificadores
da conta sintética e um perfil separado do Chrome para os próximos testes e
limpeza posterior. Não anexar credencial, perfil do Chrome ou tokens ao chat.
O teste não cria academia, curso, venda ou vínculo de professor.

O navegador confere projeto, identidade e ausência de papéis administrativos
no token renovado. Espera professor + App Check válido HTTP 403,
ausente/inválido HTTP 401 e sem Auth HTTP 401, sempre sem contexto exposto.
Depois repete a matriz administrativa aprovada e compara versões/tráfego
das quatro funções. Nenhum deploy, alteração de IAM ou merge no bloco 11.

Validação local aprovada: parser PowerShell nativo; JavaScript; matriz e
privacidade do relatório; cinco papéis administrativos indevidos, identidade
e projeto incorretos; criação, releitura e repetição sem duplicação;
propriedade divergente, resultados desconhecidos sem nova submissão e
bloqueio de PATCH/DELETE/PUT, produção e destinos alheios. Somente simulações,
sem APIs reais de nuvem. SHA-256 do JavaScript normalizado:
`BF574E24FA2AB48A21051A2F7A64CF41432573F25DAE856AEB27098D20A9D295`.
**Execução real do bloco 11 interrompida na sessão do navegador:** a conta
sintética e o perfil foram preparados, sem papéis administrativos, e o login
REST por senha passou. O comando recebido coincide com o arquivo entregue:
SHA-256 normalizado `5D25362424787EEBBE9D5670F344954AAC9F017DD0F5C1126A06ED378BE24E3E`.
Conta sintética: `identificador reservado`;
fixture `id-local-reservado`, UID com prefixo
`m9-professor-20261117-` seguido desse identificador.

O Chrome retornou `PROFESSOR_SESSION_MISMATCH` antes das chamadas HTTP da
matriz de professor. A checagem administrativa posterior também não foi
executada. Essa mensagem agrupava presença de usuário, correspondência de
e-mail, verificação de e-mail e hash do UID; a saída ainda não identifica
qual campo divergiu. Não comprova falha da senha, que já havia passado no
login REST. Não houve nova implantação, redefinição de senha ou merge.
Os dados sintéticos preparados e a credencial protegida foram mantidos.

**Bloco 11A preparado para diagnóstico e retomada da mesma conta:** valida o
comando 11 anterior por hash e exige o registro dessa fixture específica,
com criação de Auth e perfil já confirmadas e credencial local existente.
Atualiza a checagem para esperar `authStateReady()`, reler o usuário com
`reload()` e emitir códigos distintos para usuário ausente, e-mail divergente,
e-mail não verificado e UID divergente. Mantém todas as exigências de
identidade, verificação de e-mail, projeto e ausência de papéis administrativos;
não redefine nem força o estado de verificação do e-mail.

A retomada bloqueia os endpoints de criação de usuário e de perfil: sua
allowlist administrativa admite somente GET nos destinos previstos e POST
de lookup e download da fonte existente. Não grava Firestore, não altera
Auth/IAM/configuração de Functions e não faz deploy. Salva os executores
original e corrigido localmente para retomada. O bloco 11 disponibilizado
recebeu essa versão corrigida; a versão inicial continua no histórico.

- SHA-256 do JavaScript corrigido normalizado: `1BCF6EEECABAF3A5DB8F9F65BB036D5DE52BCDA08198267386989270112593D6`.
- SHA-256 do executor corrigido normalizado: `408F9D4F9FAAE1ECAE0D3DF1932BFAF8758A690C2DB1B7371F7FB7FC7896705D`.

Validação local 11A aprovada: reconstrução exata a partir do comando inicial,
parser PowerShell nativo, sintaxe JavaScript, espera do estado inicial,
simulação de atributo local atualizado por reload, erros separados de sessão,
preservação das travas de identidade/papéis, matriz e privacidade, e bloqueio
real do adaptador simulado para criação de Auth/perfil, PATCH, PUT, DELETE e
produção. Nenhuma API real de nuvem foi chamada nesses testes locais.
**Resultado real do 11A:** a conferência do comando enviado passou nesta
auditoria, mas a execução no Windows parou em `VALIDATE_PREVIOUS_11_COMMAND`,
com `PREVIOUS_11_COMMAND_NOT_FOUND_OR_CHANGED`. O executor não encontrou no
histórico uma entrada com o hash exigido nem uma cópia local correspondente.
Não chegou a executar a correção, abrir o Chrome ou repetir a matriz. Registrou
`NEW_SYNTHETIC_ACCOUNTS=NONE`, `FIRESTORE_WRITES=NONE`, `PASSWORD_RESET=NONE`
e `DEPLOY=NONE`. A causa específica da divergência de sessão continua aberta.

**Bloco 11B preparado — execução direta:** entrega o executor completo,
independente de `Get-History` ou da cópia do comando 11. Reutiliza somente
os auxiliares locais já conferidos por hash nos blocos 05 e 09B, a cópia
local da ferramenta de navegador, os registros da fixture existente e sua
credencial protegida. Exige explicitamente a fixture
`id-local-reservado`, criação anterior de Auth/perfil confirmada
e hash de referência das quatro funções. Recusa registro ou credencial
ausente; foram removidos os caminhos de criação de conta, perfil e senha.

O JavaScript é o mesmo da correção 11A, com espera da inicialização,
reload e erros separados de sessão. O bloco continua exigindo identidade
correta, e-mail verificado e ausência de papéis administrativos. As chamadas
administrativas permitem somente GET nos destinos previstos e POST de
lookup e download da fonte. Não altera configurações de Auth, Firestore,
IAM ou Functions, nem executa deploy. Após a matriz do professor, revalida
o administrador e as versões/tráfego das quatro funções.

Validação local 11B aprovada: parser PowerShell nativo; vínculo com a fixture
exata; recusa de estado incompleto, usuário ausente, papéis ou perfil indevidos;
leituras repetidas sem criar recursos; bloqueio de criação de Auth/perfil,
PATCH/PUT/DELETE e produção; ausência de dependência do histórico e de exportação
de credencial; igualdade byte a byte do JavaScript com o auxiliar 11A já testado.
Sem chamadas reais de nuvem. SHA-256 normalizado do executor direto:
`35194BB0070CAF568E64C4ECEB477FD709C6CA644C52E698012B315C8A7876C7`.
**Execução real do 11B recebida:** comando conferido integralmente contra o
arquivo entregue. O histórico deixou de ser uma dependência. Registro da
fixture, conta sem papéis administrativos e login por senha passaram. O
navegador parou em `PROFESSOR_STAGING_APP_NOT_FOUND`, ainda antes da matriz
HTTP de professor e da rechecagem administrativa. Não houve criação de
conta, gravação Firestore, alteração de conta ou implantação. O resultado
identifica ausência da instância esperada no caminho usado pela ferramenta;
não demonstra senha incorreta nem comprova sozinho um defeito do painel.

A leitura pública atual de `painel_professor.html` confirmou imports Firebase
10.8.0, carregamento de `firebase-runtime-v1_2.js`, chave pública App Check e
exposição de `window.__BJJ_EXAMS_AUTH__`. O runtime usa
`ReCaptchaEnterpriseProvider`. A mesma chave pública está no shell
administrativo. Nenhuma dessas leituras públicas autentica uma sessão real.

**Bloco 11C preparado — teste isolado de backend no navegador:** a ferramenta
abre no Chrome uma página local interceptada no domínio de staging, sem
publicá-la no Hosting. Carrega os módulos Firebase 10.8.0 e cria explicitamente
um app nomeado, sem procurar o app padrão do painel. Confere o projeto,
número, appId e a chave pública efetivamente publicada; usa o provedor normal
reCAPTCHA Enterprise e Auth com persistência em memória. O e-mail é fixo e
somente leitura. O operador cola a senha protegida e clica em
`Entrar e executar teste`; a continuação é automática, sem ENTER no terminal.

Após login, a página confere identidade por hash do UID, verificação de e-mail,
projeto/issuer do token renovado e ausência dos cinco papéis administrativos.
Lê somente o próprio perfil por REST, com Auth e App Check válidos, e confere
os marcadores sintéticos e o papel professor. A matriz espera 403 para professor
com token válido e 401 para App Check ausente/inválido e sem Auth. Corpos,
senhas e tokens não são incluídos no relatório. As rotas bloqueiam produção,
outras Functions, escrita Firestore e operações de alteração/criação de conta;
OPTIONS é permitido somente nos destinos de leitura/chamada previstos para CORS.

O PowerShell confere os auxiliares locais por hash, a fixture existente e sua
credencial protegida. Captura metadados das quatro Functions antes/depois e
revalida o administrador com a ferramenta normal já aprovada. Somente grava
relatórios e registros locais; nenhuma alteração de configuração de nuvem,
conta, dados de negócio ou deploy. O resultado mede a matriz de permissões do
backend; a interface e a jornada completa do painel de professor permanecem
separadas: `PROFESSOR_PORTAL_UI=NOT_TESTED`.

Validação local 11C aprovada: sintaxe JavaScript e parser PowerShell nativo;
simulação de DOM, SDK e HTTP para inicialização explícita, entrada manual,
limpeza do campo de senha, perfil próprio, matriz, privacidade, papéis/UID/
projeto incorretos, chave publicada e travas de rede; leitura dos metadados,
detecção de mudança de UID de serviço, escopo GET e recusa de conta/fixture
divergente. Esses testes usaram simulações; a execução real no Chrome do
operador continua necessária.

- SHA-256 do JavaScript normalizado: `D82430BC1746972571B7210BB9C7B920A08429F6AA4482FB6B1B97318A4E06B0`.
- SHA-256 do executor normalizado: `F9A87A0973B64E0D4EB904CA5E10F1C396430C5914E126365D55A811AB8EF2CE`.

O operador executou o 11C. A execução parou ao obter o App Check do provedor
normal (`HARNESS_STANDARD_APPCHECK_UNAVAILABLE`), antes da matriz HTTP. Os
blocos Casa 03 e Casa 04 concluíram a validação no computador de casa.

Referências do SDK: [Auth.authStateReady](https://firebase.google.com/docs/reference/js/auth.auth#authauthstateready)
e [User.reload](https://firebase.google.com/docs/reference/js/auth.user#userreload).

**Casa 03 e Casa 04 concluídos em homologação.** O Casa 03 comprovou a
sessão do administrador temporário e a consulta HTTP 200. No Casa 04, o
operador confirmou a reemissão da credencial da conta sintética existente
de professor e o perfil próprio respondeu HTTP 200. Com sessões Firebase
distintas e o App Check do provedor normal, `obterContextoAdministrativoV12`
passou nos oito casos da matriz.

| Cenário | Administrador | Professor |
| --- | ---: | ---: |
| Auth e App Check válidos | 200 | 403 |
| App Check ausente | 401 | 401 |
| App Check inválido | 401 | 401 |
| Auth ausente | 401 | 401 |

A saída confirmou `PROFESSOR_RBAC=PASS`, mesma versão e tráfego das quatro
funções, e nenhuma credencial exibida. A jornada completa do painel de
professor segue pendente. A PR #53 permanece em rascunho no commit
`a0e7bf0c4701845cc34374464f2ed96bf46a95fa`, com o CI concluído com sucesso.

**Casa 05 concluído no computador de casa.** O script executado corresponde
ao bloco revisado. O SHA-256 do pacote candidato baixado do piloto passou.
O Windows salvou e reabriu com DPAPI as cópias de código, configuração e
IAM das três funções restantes. Os três arquivos de código contêm
`package-lock.json`. Cada função estava com 100% do tráfego na revisão da
tabela. A segunda leitura confirmou versão, tráfego e IAM nas quatro
funções. Pacote local `id-local-reservado`, com
`COPIAS_PROTEGIDAS_AMPLIACAO=PASS` e `DEPLOY=NONE`.

| Função | Revisão registrada | Cópia protegida |
| --- | --- | --- |
| `listarPessoasOperacionaisV12` | `listarpessoasoperacionaisv12-00001-juw` | Conferida |
| `listarOrganizacoesOperacionaisV12` | `listarorganizacoesoperacionaisv12-00001-wad` | Conferida |
| `listarCursosOperacionaisV12` | `listarcursosoperacionaisv12-00001-dih` | Conferida |

Usar o mesmo perfil do Windows para abrir esse pacote. A conferência das
cópias de código e configuração foi concluída. A recuperação gerenciada
dos dados de Firestore, Auth e Storage segue como aceite independente.

**Próxima implantação autorizada — Pessoas.** A PR #53 permanece em
rascunho. A execução 44082300676 do GitHub Actions passou no commit
`a0e7bf0c4701845cc34374464f2ed96bf46a95fa`. Seis arquivos de testes
direcionados à listagem de Pessoas, App Check e navegador passaram em
rechecagem local com Node.js 24.22.1 e as dependências do mesmo lockfile.

1. Usar o pacote candidato conferido para atualizar somente a função
   `listarPessoasOperacionaisV12` em `bjj-exams-staging`, região
   `southamerica-east1`. Revalidar o pacote protegido, o hash do backup e
   a revisão de origem no Windows imediatamente antes da alteração.
2. Atualizar a função existente pela API gerenciada de Cloud Functions v2
   com máscara explícita e verificar o hash da fonte implantada, configuração,
   IAM e tráfego. Conferir versão e tráfego das outras três funções.
3. Validar no navegador com contas sintéticas e provedor normal. Esperado
   em Pessoas: administrador com Auth e App Check válidos HTTP 200,
   professor com os dois válidos HTTP 403, e HTTP 401 com App Check ausente,
   inválido ou sem Auth. Conferir a listagem e acompanhar erros e latência
   no staging, com registro agregado de status.
4. Se a validação falhar após a mudança e o estado confirmar a implantação
   desse lote, restaurar o código e a configuração anteriores de Pessoas
   com a cópia protegida, conforme autorização. Verificar o hash restaurado,
   a configuração, o tráfego e a leitura administrativa.

O responsável autorizou em 17/11/2026 a implantação individual de Pessoas
em homologação e a restauração dessa função se a validação falhar. O executor
`BJJ_Exams_Casa_06_Implantar_App_Check_Pessoas_20261117.ps1` está preparado
para o mesmo perfil Windows que gerou o Casa 05. SHA-256 do arquivo:
`9EE0871CF9004FF770DA8CF0CE2B898365D0455CEBAE225F4A436DB1B2E82EC0`.

O executor reabre o pacote `id-local-reservado` e confirma
a revisão de origem e a política de tráfego antes de chamar o Chrome. Depois
do aceite inicial, aplica a atualização com escopo restrito à função de
Pessoas e confere a fonte, a configuração e o IAM. O relatório HTTP registra
somente status, latência e resultados. Em caso de falha, a restauração do
pacote anterior depende de confirmação de término da operação e da identidade
da revisão desse lote. Em situação ambígua, o registro local permite retomar
a verificação sem reenviar a implantação. O retorno usa o backup de Pessoas,
revalida o hash e repete a leitura administrativa.

A sintaxe PowerShell e Node.js passou. As simulações aprovaram 15 cenários
do executor e 8 do navegador.

**Casa 06 executado até a validação inicial.** A saída do Windows
corresponde ao executor revisado e confirma `COPIAS_CASA05_REABERTAS=PASS`.
O Chrome parou no controle de administrador (`ADMIN_CONTROL`), antes do
teste de professor, com `APPCHECK_THROTTLED`. O resumo preservou o código
do SDK e omitiu o status HTTP que originou a pausa. A tentativa encerrou em
`CHROME_ANTES_DA_IMPLANTACAO`, `DEPLOY=NONE` e
`RETORNO_PESSOAS=NAO_NECESSARIO`. O pedido de atualização e o envio da
fonte ficam depois desse controle e ficaram fora da execução observada.

**Casa 06A concluído.** As leituras no Windows confirmaram a revisão
`listarpessoasoperacionaisv12-00001-juw` e a ausência do registro local de
solicitação de implantação. A identidade web de `bjj-exams-staging`, a
correspondência entre chave publicada e configuração do App Check, a
modalidade score do reCAPTCHA Enterprise e o domínio autorizado passaram.

| Troca reCAPTCHA Enterprise no projeto | Contagem | Última amostra UTC |
| --- | ---: | --- |
| HTTP 200 | 1 | 18/11/2026 00:04:08 |
| HTTP 403 | 1 | 18/11/2026 01:38:58 |

A amostra HTTP 403 corresponde a 17/11/2026 às 22h38min58s em São Paulo,
na janela em que o Casa 06 reportou `APPCHECK_THROTTLED`. O Monitoring
apresenta contagens do projeto. O motivo individual da recusa segue em
aberto. A execução terminou com `NOVA_TROCA_APPCHECK=NONE` e `DEPLOY=NONE`.

**Casa 06B concluído.** O operador leu o registro App Check com HTTP 200 e
confirmou limiar atual `0.5`. O Cloud Logging respondeu HTTP 200 para a
janela de 18/11/2026 entre 01h36min58s e 01h40min58s UTC. Retornaram zero
avaliações visíveis para a chave com o domínio de staging ou sem hostname.
A causa individual do 403 segue em aberto. A coleta terminou com
`NOVA_TROCA_APPCHECK=NONE` e `DEPLOY=NONE`.

**Casa 06C preparado para retomar Pessoas com evidência do provedor.** O
código do Firebase JS SDK 10.8.0 confirma uma pausa de 24 horas no provedor
para erros HTTP 403 e 404. O executor adota a amostra de 17/11 às 22h38min58s
em São Paulo como referência e programa o reteste para depois de 18/11 às
22h38min58s, horário de São Paulo. Antes desse horário, confere e guarda
localmente o script Casa 06 original pelo SHA-256. Caso já exista um pedido
de implantação registrado, o fluxo de retomada original pode ser usado para
acompanhar ou restaurar a função.

O operador confirmou a preparação local em 17/11. O Windows retornou
`CASA06_ORIGINAL_VERIFICADO=PASS` e
`CASA06C=PREPARADO_AGUARDANDO_INTERVALO_SDK`. O marco exibido foi
`RETESTE_APOS_UTC=2026-11-19T01:38:58Z`, equivalente a 18/11 às
22h38min58s no horário de Brasília. A execução reportou
`NOVA_TROCA_APPCHECK=NONE` e `DEPLOY=NONE`.

No reteste, o executor observa a troca feita pelo provedor normal no Chrome
e imprime o código HTTP e, quando fornecidos, o status RPC, o motivo
reconhecido e a espera indicada pelo SDK. Ele preserva a validação das
contas sintéticas e o escopo de implantação e retorno de
`listarPessoasOperacionaisV12` em homologação. O Casa 06C passou em oito
simulações PowerShell e três checagens do observador e do SDK em Node.js.
A validação real do provedor e a implantação autorizada continuam
pendentes. `MARCO9=NO_GO`.

**18/11/2026 — Preparo do computador do trabalho.** O diagnóstico
confirmou Windows PowerShell 5.1, Node.js 24.14.1, npm, Chrome e leitura
do projeto `bjj-exams-staging` com o gcloud. O bloco de preparo conferiu
os três arquivos de navegador e o Playwright 1.64.0. O Casa 05 gerou e
reabriu no perfil do trabalho as cópias protegidas de Pessoas,
Organizações e Cursos. A revisão de Pessoas permaneceu
`listarpessoasoperacionaisv12-00001-juw`. A revisão, o tráfego e o IAM
das quatro funções foram reconferidos durante a coleta.

| Computador | Pacote Casa 05 validado | Próxima evidência |
| --- | --- | --- |
| Casa | `id-local-reservado` | Reteste de Pessoas pelo Casa 06C após 22h38min58s de 18/11, em Brasília |
| Trabalho | `id-local-reservado` | Importar as credenciais neste perfil e confirmar as duas contas pelo bloco 03 |

A execução no trabalho retornou `FERRAMENTAS_TRABALHO=PASS`,
`COPIA_RECUPERACAO_TRABALHO=PASS` e `DEPLOY=NONE`. A abertura
do arquivo de credencial do administrador no diagnóstico foi confirmada.
A senha ainda precisa passar pelo Firebase Auth do trabalho. O arquivo local
do professor estava ausente no diagnóstico.

**Preparo do Casa 06C no trabalho confirmado.** O Windows reabriu as
cópias protegidas de Pessoas e conferiu os hashes antes de preparar o
executor vinculado a este pacote. A execução registrou
`COPIAS_TRABALHO_REABERTAS=PASS`, `CASA06C_TRABALHO_LOCAL=PREPARADO`,
`CREDENCIAIS_TRANSFERIDAS_ARQUIVOS=PENDENTES` e `DEPLOY=NONE`. A
importação e o teste das duas contas no Firebase Auth são as próximas
evidências para retomar Pessoas pelo computador do trabalho.

Registro da preparação dos blocos 05 e 05A:
O bloco prepara a ferramenta existente da PR #53 em pasta local própria,
com hashes dos cinco arquivos conferidos contra o SHA aprovado no CI.
Usa o modo de depuração existente, cadastra um token temporário apenas
no App Check de homologação e tenta removê-lo ao encerrar. Um registro
local sem segredos permite retomar a limpeza após interrupção. O OAuth
administrativo não é transmitido ao processo do navegador. O login
permanece manual; o relatório contém apenas estados e presença de headers.
A sintaxe e nove cenários simulados de criação/limpeza passaram. Na execução
real do operador, o bloco parou em `REVIEWED_TOOL_FILES`, com
`REVIEWED_TOOL_HASH_MISMATCH`, antes de instalar a dependência, obter OAuth,
cadastrar o token ou abrir o navegador. O log não identifica qual arquivo
divergiu. A investigação identificou um erro no hash fornecido para
`tools/marco9-browser/run-staging.ps1`: a cópia de trabalho usa CRLF por
`.gitattributes`, mas o blob Git e o download raw usam LF. O hash da cópia
CRLF foi indevidamente usado para conferir os bytes LF do download.
O SHA-256 correto do blob original é
`9BE184F55916A527515EF986A22EE5B5BE92567003584848E950A4DB9A61696B`.
Os outros quatro hashes conferem com seus blobs; não houve alteração de
código do produto nem necessidade de remover a conferência de integridade.

Foi preparado `BJJ_Exams_05A_Reparar_Ferramenta_20261117.ps1`: valida por
SHA-256 o comando 05 recebido no histórico da mesma janela do PowerShell,
corrige a constante do hash CRLF para o hash LF e uma aspa faltando no
comando gcloud colado. Confere também o SHA-256 do comando após essas duas
correções, salva uma cópia local corrigida e retoma o mesmo teste, mantendo
a conferência dos cinco arquivos. O bloco 05 salvo também recebeu o hash
LF correto e o log por arquivo. O operador executou a correção, confirmou
integridade 5/5 e concluiu o ensaio de depuração descrito acima. O provedor
normal reCAPTCHA foi aprovado depois no bloco 06. O piloto de enforcement no
backend passou posteriormente no bloco 10, no escopo de uma única função.

**Pendência operacional adicional:** aviso de 17/11/2026 do Google informa
risco de suspensão do `bjj-exams-staging` por problema no faturamento.
A situação atual do meio de pagamento precisa ser conferida no console;
a mensagem não comprova que a suspensão já ocorreu nem que a pendência
continue após eventual regularização.

A correção foi integrada ao repositório. A atualização dessas dependências
nas Functions implantadas e a validação operacional ainda fazem parte das
etapas seguintes. O Marco 9 continua **NO_GO**.

## Parecer

O BJJ Exams possui o núcleo de cursos, financeiro, exames oficiais, certificados e administração implementado. Há validações anteriores em homologação e os testes locais selecionados passaram novamente nesta auditoria. O projeto permanece no **Marco 9, com liberação NO_GO**. A preparação e a publicação de produção pertencem ao **Marco 10**, ainda pendente.

A correção das vulnerabilidades identificadas foi integrada à versão de desenvolvimento. A conclusão depende de publicar essa base no escopo aprovado de homologação, encerrar a validação de segurança e recuperação, preparar explicitamente a v1.2 para produção e validar a operação completa. O código contém barreiras que restringem funcionalidades a homologação; a promoção exige alterações controladas e testes dessas configurações.

## 1. O que foi conferido agora

| Verificação | Resultado em 17/11/2026 |
| --- | --- |
| Repositório | `rianbarbosabjj/bjjexams` |
| Versão integrada de desenvolvimento | `develop-v1.2`, SHA `e9706e9e345f6ead4662dc0dd598b190a69f5a0a`, após integração da PR #54 em 17/11/2026 |
| Branch principal | `main`, SHA `0cb7a6c2a81d0d0066de8e4a5d1b84c058f6b4ef`, de 18/09/2026; diferente da v1.2 integrada |
| Histórico de PRs | 54 PRs: 52 mescladas, uma encerrada sem merge e uma aberta |
| PR aberta | #53, em rascunho, SHA `a0e7bf0c4701845cc34374464f2ed96bf46a95fa`, com a base de dependências atualizada em 17/11/2026 |
| Teste automatizado da PR #53 | Última execução do GitHub Actions aprovada nesse SHA |
| Testes | Correção de dependências: **228/228 arquivos aprovados**; PR #53 atualizada: **203/203 arquivos locais aprovados**, com Node.js 22.23.2 |
| Frontend de homologação | **52/52 arquivos públicos responderam HTTP 200 e correspondem aos bytes do código de desenvolvimento**, descontada a injeção prevista da chave pública App Check em sete páginas |
| Catálogo público de homologação | Callable respondeu HTTP 200; retornou dois cursos cujos títulos indicam dados de teste |
| Quatro leituras administrativas sem login | Todas responderam HTTP 401 / `UNAUTHENTICATED` |
| Conta administrativa temporária | Saída do bloco 03 executado pelo operador: `PASSWORD_LOGIN=PASS`, `ADMIN_PERMISSIONS=PRESERVED` e `ACCESS_RECOVERY=PASS` |
| Quatro leituras administrativas com login | Saída do bloco 04 executado pelo operador: **4/4 HTTP 200**, contratos de resposta aprovados; App Check não enviado |
| Quatro leituras no navegador com App Check de depuração | Bloco 05 após correção 05A: **4/4 HTTP 200**, Auth e App Check presentes, SDK pronto, token disponível e resultado aprovado |
| Limpeza do token temporário | `TEMP_DEBUG_REGISTRATION=DELETED`, confirmado na saída do operador |
| Provedor normal | Bloco 06 executado pelo operador: **4/4 HTTP 200**, Auth e App Check presentes; SDK pronto e token disponível; `BROWSER_STANDARD_PROVIDER=PASS` |
| Cópia da função piloto | Bloco 07: código/configuração anteriores preservados e hashes conferidos; cópia mantida após o piloto |
| Recuperação cloud de código/configuração | Bloco 09B: fonte restaurada com o hash preservado, leitura HTTP 200, função temporária removida e quatro funções existentes preservadas |
| Enforcement do contexto administrativo | Bloco 10: administrador + token válido HTTP 200; ausente/inválido e sem Auth HTTP 401; piloto mantido em staging e outras três funções preservadas |
| Professor com App Check válido | Casa 04: professor HTTP 403, administrador HTTP 200 com o mesmo App Check, demais casos HTTP 401. Matriz 8/8 aprovada no contexto administrativo |
| Pontos de retorno das outras três funções | Casa 05: três cópias protegidas reabertas e conferidas, versões, tráfego e IAM estáveis nas quatro funções durante a captura |
| CSP em homologação | Cabeçalho `Content-Security-Policy-Report-Only` presente nas páginas consultadas |
| Domínio comercial | `https://exams.bjjdigital.com.br/` responde HTTPS/HTTP 200 e mantém a home de pré-lançamento |
| Frontend no domínio comercial | Login, curso e painel do aluno ainda apresentam a implementação antiga apontada para `bjj-exams`; os recursos novos `admin_shell_v1_2.html` e `js/firebase-runtime-v1_2.js` retornaram 404 |
| Endereço Firebase de produção | `https://bjj-exams.web.app/` e os caminhos consultados retornaram 404; isso é distinto da disponibilidade do domínio comercial, que respondeu normalmente |
| Auditoria atual das dependências destinadas à produção | **0 vulnerabilidades reportadas no lockfile corrigido**; atualização das Functions implantadas ainda pendente |
| Pré-verificação de release existente | Continua retornando `NO_GO`, Marco 9 incompleto e Marco 10 não autorizado |

O teste de 52 arquivos comprova a correspondência do **frontend de homologação**. A correspondência entre o código-fonte e todas as revisões de Cloud Functions implantadas continua sem comprovação atual. As respostas HTTP 401 comprovam a recusa de chamadas administrativas anônimas; não comprovam enforcement App Check.

### Composição dos testes executados

| Grupo | Arquivos aprovados |
| --- | ---: |
| Regressão do Marco 8 | 88/88 |
| Regressão dos marcos anteriores selecionada pelo workflow | 45/45 |
| Contratos locais do Marco 9 | 28/28 |
| Testes locais de backend sem dependência de emulador | 40/40 |
| Total | **201/201** |

Essas contagens são de arquivos/rotinas de teste, cada qual podendo conter vários casos. Nesta auditoria não foram repetidos os testes dependentes de emulador nem jornadas autenticadas com contas reais de homologação. Os testes de produção, pagamentos reais, restauração e carga também não foram executados. A cópia auditada do repositório terminou sem alterações em arquivos versionados.

## 2. O que já foi construído

| Área | Entrega existente | Limite para a entrada em operação |
| --- | --- | --- |
| Identidade e academias | Autenticação, papéis administrativos, vínculos institucionais e ferramentas de migração | Revisar contas, claims e migração dos dados efetivamente presentes em produção |
| Cursos | Catálogo público, cursos de academia, criação pelo instrutor, revisão/moderação, módulos, aulas, proteção de conteúdo, matrícula e progresso | Revalidar os fluxos completos na versão final e preparar o catálogo inicial |
| Financeiro | Checkout PIX de cursos, cobrança de exames, pedidos, histórico, split, snapshots financeiros e webhooks idempotentes | Integração canônica atual está orientada ao Asaas Sandbox; produção requer configuração e suporte explícitos |
| Regras comerciais | Taxa padrão de 10%, administrada pela plataforma, com regras versionadas | Conferir recebedores, distribuição e valores da configuração de lançamento |
| Reversões | Cancelamento, solicitação de estorno, chargeback e reconciliação | Há registro de teste Sandbox de estorno negado tratado corretamente; isso não equivale a comprovar estorno concluído em produção |
| Exames oficiais | Sessão da academia, seleção de alunos elegíveis, cobrança individual, início/retomada, respostas e resultado no servidor | Revalidar a jornada com os modelos oficiais e dados finais; as funções canônicas estão restritas a homologação/emulador |
| Certificados oficiais de exame | Emissão, unicidade, validação pública, revogação e auditoria | Validar emissão, apresentação, consulta e revogação no ambiente final |
| Administração | Pessoas, organizações, cursos, exames, questões, certificados, pedidos e console financeiro/operacional | Novas superfícies possuem restrições explícitas a homologação |
| Segurança | Regras de acesso, controles por papel, sanitização de logs, App Check no cliente, mecanismo de limitação de chamadas e CSP em observação | Completar ativação seletiva, testes reais, retenção, recuperação e aceite operacional |

Os marcos de cursos e financeiro estão representados pelas PRs #1 a #18; execução oficial dos exames, pela #19; certificados, pela #20; console operacional, pela #21. As PRs posteriores concentram a preparação de segurança e correções de homologação.

O registro de fechamento do Marco 5.6 documenta compra PIX Sandbox, retomada sem duplicação, confirmação via webhook e liberação de acesso. Também registra cancelamento e o tratamento de estorno negado com reconciliação necessária. Esse histórico deve integrar a evidência final, com nova regressão sobre a versão de lançamento.

### Pontos de escopo que precisam ficar explícitos

- A jornada canônica de exame v1.2 gera resultado e elegibilidade para certificado; ela não atualiza automaticamente a faixa atual do perfil. Existe comportamento diferente no legado. O procedimento de graduação e o caminho oficial devem ser definidos na transição.
- O certificado canônico auditado é o de exame oficial. A existência de recursos legados não deve ser interpretada como validação de todas as modalidades de certificação na v1.2.
- O pagamento implementado e documentado nesta etapa é PIX. A comunicação de lançamento deve refletir os meios efetivamente liberados.

## 3. Bloqueios e pendências concretas

### 3.1 Dependências — correção integrada pela PR #54

O levantamento inicial encontrou as oito entradas abaixo. A PR #54 atualizou as dependências transitivas dentro dos intervalos suportados, preservou as quatro dependências diretas e o override uuid e eliminou a árvore antiga google-gax 5 / rimraf / glob / minimatch. A auditoria do lockfile corrigido passou a reportar zero vulnerabilidades.

| Pacote | Severidade reportada |
| --- | --- |
| `body-parser` | Alta |
| `follow-redirects` | Alta |
| `glob` | Moderada |
| `google-gax` | Moderada |
| `minimatch` | Moderada |
| `qs` | Moderada |
| `rimraf` | Moderada |
| `fast-xml-parser` | Baixa |

As oito entradas eram o resultado anterior à correção, incluindo dependências afetadas de forma transitiva; não são necessariamente oito CVEs independentes. A atualização controlada, a instalação reproduzível, a regressão selecionada e o CI já passaram. A implantação e a validação real da base corrigida continuam nas próximas etapas.

Referências dos avisos altos conferidos: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828) e [follow-redirects](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8). A presença no lockfile não comprova exploração no BJJ Exams.

### 3.2 PR #53 e App Check

A PR prepara enforcement apenas para quatro funções administrativas. Continua em rascunho, com instrução explícita de não mesclar nem publicar nesta etapa. O CI atual está aprovado.

Os registros anteriores incluem SDK inicializado e token disponível no Chrome normal, quatro revisões baseline prontas e builds concluídos, além de recusa do reCAPTCHA no perfil automatizado. A execução atual comprovou a automação completa com o provedor de depuração: quatro leituras HTTP 200 com Auth e App Check presentes, rotas prontas/vazias, SDK pronto e token disponível. O token temporário foi removido ao encerrar.

O bloco 06 comprovou o provedor normal nas quatro leituras com Auth e App Check presentes. O bloco 07 conferiu a cópia protegida da função piloto, e o 09B comprovou a recuperação do código e da configuração em uma função temporária. O bloco 10 habilitou a exigência de App Check no contexto administrativo. O Casa 04 concluiu a matriz de oito casos para administrador e professor nessa função em homologação. O Casa 05 conferiu as cópias de retorno das três funções restantes.

O histórico já encerrou uma investigação de metadados de proveniência sem conseguir associar todas as fontes implantadas a um SHA Git. A pendência prática é preparar um mecanismo comprovável de recuperação e uma implantação rastreável. Repetir as mesmas consultas de metadados não fecha essa lacuna.

### 3.3 Demais controles do Marco 9

O mecanismo de limitação de chamadas permanece desabilitado no código integrado. A preparação de chave HMAC, expiração dos contadores e calibração existe, mas o aceite operacional não está comprovado. A CSP já está publicada em modo de observação no staging; faltam revisão de violações, compatibilidade e decisão sobre aplicação obrigatória. Backup/restauração gerenciados, carga real controlada, retenção dos logs e aceite operacional continuam pendentes.

O manifesto de release ainda enumera dez gates operacionais sem aceite. Parte de seus campos é uma fotografia antiga: por exemplo, ele informa CSP não publicada, enquanto a leitura HTTP atual comprovou o cabeçalho. É necessário consolidar as evidências novas em um registro próprio de aceite; aprovar esse pré-flight valida suas travas, não transforma seus campos em diagnóstico atualizado da nuvem.

#### 18/11/2026 — Revisão local da compatibilidade da CSP

A análise usou o commit `a0e7bf0c4701845cc34374464f2ed96bf46a95fa` da PR #53. O inventário conferiu os 52 arquivos permitidos para o Hosting, com 16 HTML, 35 JavaScript e uma imagem. Nos HTML de origem, foram encontrados 28 blocos de script embutidos, 16 blocos de estilo, 41 atributos `style` e 234 manipuladores de eventos definidos no próprio HTML. Passaram os quatro testes locais de inventário, política em observação, preparação do release e verificação do pacote com retorno à versão anterior. O preparo com uma chave pública sintética também foi validado nas sete páginas previstas.

| Ponto verificado no código | Impacto se a política atual passar a bloquear | Ajuste ou evidência para o aceite |
| --- | --- | --- |
| Configuração do App Check inserida em script no HTML de sete páginas durante a preparação do pacote | A diretiva `script-src` bloquearia a execução do script que fornece a configuração ao runtime | Carregar a configuração pública em arquivo da própria origem, antes do runtime. Validar o empacotamento e os verificadores que hoje esperam o script no HTML. |
| Quill no painel do professor | `script-src` e `style-src` impediriam o carregamento do editor e do seu CSS pelo CDN atual | Conferir a versão e a origem adotadas e validar o editor na jornada do professor. |
| Consulta de CEP no cadastro e vídeos na sala de aula | A origem do ViaCEP está fora de `connect-src` e a do player do YouTube está fora de `frame-src` | Exercitar o preenchimento por CEP e a reprodução com dados de teste. Ajustar as origens conforme os recursos que a aplicação precisa carregar. |
| Scripts, estilos e eventos inseridos diretamente nas páginas | A aplicação obrigatória pode impedir ações ou alterar a apresentação das telas | Priorizar as jornadas de login, administração, professor e aluno e validar as interações afetadas antes de restringir o carregamento. |

**Ensaio local concluído no Chrome do computador do trabalho.** O operador confirmou `CSP_ENSAIO_LOCAL=PASS` em 18/11. A página foi servida em loopback e usou um valor sintético no trecho de configuração comum às sete páginas.

| Cenário no Chrome | Evidência | Resultado observado |
| --- | --- | --- |
| CSP em observação e script no HTML | `CSP_OBSERVACAO_SCRIPT_HTML=1` | O script executou |
| CSP obrigatória e script no HTML | `CSP_OBRIGATORIA_SCRIPT_HTML=0` | O script foi bloqueado |
| CSP obrigatória e script em arquivo da mesma origem | `CSP_OBRIGATORIA_ARQUIVO_LOCAL=1` | O script executou |

**Variante de empacotamento preparada em código.** A cópia de trabalho local `fix/marco9-csp-public-config-20261118` usa como base `e9706e9e345f6ead4662dc0dd598b190a69f5a0a`. A opção `--external-config` gera um único JavaScript da mesma origem e coloca sua referência antes do runtime nas sete páginas, totalizando 53 arquivos no pacote preparado. A opção `--verify-external-config` confere a referência, a chave e a lista exata de arquivos. Passaram nove arquivos de testes e a verificação dos comandos de linha de comando. Foram também verificadas a rejeição do arquivo alterado ou ausente e a recuperação do pacote limpo diante de falha simulada.

O novo formato é opt-in porque o auxiliar usado no fluxo atual de Pessoas extrai a chave do HTML. Antes de publicar a variante, adapte esse consumidor e valide as jornadas em homologação. O ensaio local comprovou a execução do script sintético sob a política. O aceite do App Check com o provedor real e o da CSP nas jornadas de homologação continuam pendentes.

### 3.4 Preparação de produção ainda exige implementação

Há restrições a staging nos exports de exames, certificados e administração, na ligação dos segredos do checkout e webhook e em APIs do frontend. A API de compras recusa o ambiente de produção. O arquivo Firebase principal não contém uma configuração de Hosting para a publicação da v1.2.

O Marco 10 deve implementar a configuração de produção por superfície, preservar a separação dos ambientes e testar os exports esperados, os clientes, os segredos e os webhooks. Uma publicação direta do código atual não habilita a operação completa.

### 3.5 Home, termos e preparação do negócio

- A home comercial permanece em pré-lançamento. O botão “Avise-me” exibe uma mensagem no navegador e não possui, no código observado, persistência do e-mail informado.
- Os termos publicados, datados de maio, descrevem consumo de créditos pré-pagos do professor/academia. Esse texto diverge da cobrança individual do exame adotada na jornada canônica v1.2.
- Os termos e a privacidade precisam ser alinhados às regras comerciais finais, provedores efetivamente usados, canais de atendimento, dados tratados e retenção definida. A localização real de cada serviço deve ser conferida antes de atualizar a informação de armazenamento.
- O catálogo de staging consultado retornou dados de teste. A existência de cursos, questões, modelos de prova, recebedores e contas administrativas prontos para lançamento em produção ainda precisa ser comprovada.
- A migração deve definir a convivência com o legado e impedir a abertura de novas operações por caminhos antigos incompatíveis, preservando os históricos necessários.

## 4. Ordem proposta para concluir

| Etapa | Trabalho | Evidência de conclusão |
| --- | --- | --- |
| 1. Atualizar a base — concluída no código | PR #54 integrada à develop-v1.2 | Auditoria com 0 alertas, 228/228 arquivos de testes aprovados e CI aprovado |
| 2. Encerrar o trabalho da PR #53 | Piloto e matriz de papéis aprovados no contexto administrativo, cópias de retorno conferidas. Ampliar o App Check nas três funções restantes, começando por Pessoas, com autorização por função | Quatro funções homologadas com as permissões previstas e retorno preparado por função |
| 3. Completar segurança operacional | Calibrar limitação de chamadas, revisar CSP, Rules, acessos e logs e definir retenção | Controles testados sem quebrar os fluxos legítimos; resultados registrados |
| 4. Comprovar recuperação e capacidade | Fazer backup/restauração em destino isolado e carga limitada no staging | Integridade e limpeza conferidas; tempos de recuperação, limites de erro, latência e custo atendidos |
| 5. Fechar a homologação do produto | Repetir as jornadas críticas abaixo na versão candidata e resolver desvios | Relatório consolidado de aceite do Marco 9 |
| 6. Preparar o Marco 10 | Implementar configuração de produção, ensaiar migração, preparar Asaas, recebedores, webhook, conteúdo inicial, termos, home e monitoramento | Versão de produção concreta e revisável, migração ensaiada e plano de retorno verificável |
| 7. Publicar e validar | Após a aprovação da versão e do escopo de produção, publicar e executar a validação mínima dos fluxos críticos | Cadastro, acesso, compra, confirmação, exame, resultado e certificado funcionando; monitoramento ativo |

As atividades do Marco 9 podem ser agrupadas por dependência e evidência, como nos lotes acima. Os dez gates existentes não exigem dez novos PRs. A decisão de publicar deve ocorrer quando a versão, as configurações, a migração e o plano de retorno estiverem preparados para revisão.

### Jornadas mínimas para o aceite final

| Cenário | Resultado exigido |
| --- | --- |
| Aluno independente acessa curso público | Cadastro e acesso funcionam sem vínculo obrigatório com academia |
| Curso exclusivo de academia | Usuário sem vínculo é bloqueado inclusive por URL direta |
| Solicitação e aprovação de vínculo | Somente responsáveis autorizados aprovam o aluno correto |
| Publicação de curso | Conteúdo, moderação, preço, propriedade e acesso seguem a regra aprovada |
| Compra PIX e retomada | Recarregar a página não duplica pedido nem concede acesso antecipado |
| Pagamento, webhook e split | Confirmação libera o produto correto e a repetição do evento não duplica efeitos financeiros ou acadêmicos |
| Cancelamento, estorno e chargeback | Estado exibido corresponde ao provedor e a liberação/revogação segue a confirmação do servidor |
| Seleção para exame | Professor seleciona apenas aluno ativo e elegível de sua academia |
| Aluno não selecionado | Não consegue pagar/iniciar a prova oficial por manipulação do cliente |
| Prova | Retomada, prazo, respostas e correção respeitam o contrato; outro usuário não acessa a tentativa |
| Certificado | Aprovado elegível emite uma vez; reprovado e resultado inconsistente não emitem; revogado é identificado na validação pública |
| Regras comerciais e papéis | Alterar a taxa padrão não modifica vendas antigas; professor não altera a taxa da plataforma nem opera outra academia |

## 5. O que permanece sem comprovação atual

Esta auditoria utilizou código, registros anteriores, estado atual do GitHub, testes locais, arquivos públicos, chamadas de leitura sem login e as saídas dos diagnósticos executados pelo operador no Windows. O bloco 03 confirmou acesso à conta temporária e preservação de permissões; o bloco 04 comprovou quatro consultas administrativas autenticadas por HTTP; o bloco 05 após a correção 05A comprovou as quatro leituras no navegador com o provedor de depuração e a remoção do token temporário; o bloco 06 comprovou as mesmas quatro leituras com o provedor normal. Não houve acesso direto do assistente à administração autenticada Firebase/Google Cloud ou Asaas.

Continuam necessárias evidências atuais de: versões/configurações do backend implantado, contas administrativas definitivas, Rules e índices efetivamente publicados, segredos e recebedores de produção, estado do provedor, enforcement, logs e alertas, migração, recuperação, carga e jornada autenticada completa. A conta temporária aprovada não substitui esses critérios.

A data de lançamento depende dos aceites em aberto. O Casa 06B encerrou a busca histórica de uma avaliação para o HTTP 403. O próximo passo é **retestar o provedor normal com o Casa 06C e, se os controles passarem, aplicar a ampliação autorizada em `listarPessoasOperacionaisV12`**. Na sequência, concluir Organizações e Cursos, fechar os demais aceites do Marco 9 e preparar o Marco 10.

## Referências para retomada

- [Repositório BJJ Exams](https://github.com/rianbarbosabjj/bjjexams)
- [PR #53 — preparação administrativa App Check](https://github.com/rianbarbosabjj/bjjexams/pull/53)
- [Execução aprovada da PR #53 atualizada](https://github.com/rianbarbosabjj/bjjexams/actions/runs/44082300676)
- [Atualização de uma função existente na API do Cloud Functions v2](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch)
- [Monitoramento de uso por API no Google Cloud](https://docs.cloud.google.com/apis/docs/monitoring)
- [Registros de avaliações do reCAPTCHA Enterprise](https://docs.cloud.google.com/recaptcha/docs/platform-logging)
- [Política de repetição de App Check no Firebase JS SDK 10.8.0](https://github.com/firebase/firebase-js-sdk/blob/firebase%4010.8.0/packages/app-check/src/providers.ts#L285-L327)
- [Plano de implementação v1.2](https://github.com/rianbarbosabjj/bjjexams/blob/356c3c00bcfd81f06d76773fadea332b69589196/docs/architecture/IMPLEMENTATION_PLAN_V1_2.md)
- [Critérios de aceite v1.2](https://github.com/rianbarbosabjj/bjjexams/blob/356c3c00bcfd81f06d76773fadea332b69589196/docs/architecture/TEST_ACCEPTANCE_V1_2.md)
- [Handoff operacional do Marco 9](https://github.com/rianbarbosabjj/bjjexams/blob/356c3c00bcfd81f06d76773fadea332b69589196/docs/architecture/MARCO_9_8B_OPERATIONAL_ACCEPTANCE_HANDOFF.md)
- [Fechamento de compra e operação financeira em staging](https://github.com/rianbarbosabjj/bjjexams/blob/356c3c00bcfd81f06d76773fadea332b69589196/docs/architecture/MARCO_5_6_CLOSURE.md)
- [Homologação](https://bjj-exams-staging.web.app/catalogo.html)
- [Domínio comercial](https://exams.bjjdigital.com.br/)

A PR #54 foi integrada conforme a autorização existente. O bloco 03 recuperou o acesso da conta sintética de administrador. O bloco 09 submeteu uma implantação temporária, interrompida por erro local. A retomada 09B submeteu duas implantações temporárias, comprovou a restauração e removeu a função de teste, preservando as quatro existentes. O bloco 10 implantou e homologou o piloto do contexto no staging. O Casa 04 comprovou a matriz de autorização em homologação após as tentativas 11A, 11B e 11C. O Casa 05 confirmou as três cópias protegidas. A PR #53 segue em rascunho. O Casa 06 foi interrompido antes de atualizar Pessoas. O Casa 06A confirmou a revisão e a configuração e registrou o HTTP 403. O Casa 06B consultou a janela do erro e retornou zero avaliações visíveis. O Casa 06C está pronto para o reteste com evidência direta do provedor.

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$ProjectId = "bjj-exams-staging"
)

$ErrorActionPreference = "Stop"

$ExpectedProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$AllowedBranch = "feature/marco5b-financial-rules-admin"
$ExpectedFirebaseCli = "15.28.1"

$Functions = @(
    "obterConfiguracaoFinanceiraV12",
    "atualizarTaxaPadraoFinanceiraV12",
    "configurarContaRecebedorFinanceiroV12",
    "salvarRegraFinanceiraCursoV12",
    "obterRegraFinanceiraCursoV12"
)

function Assert-Equal {
    param(
        [string]$Name,
        $Actual,
        $Expected
    )

    if ($Actual -ne $Expected) {
        throw "$Name inválido. Esperado='$Expected'; recebido='$Actual'."
    }
}

if ($ProjectId -eq $ProductionProject) {
    throw "Execução bloqueada: produção não pode ser alvo deste precheck."
}

Assert-Equal -Name "TARGET_PROJECT" -Actual $ProjectId -Expected $ExpectedProject

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível identificar a branch Git."
}
Assert-Equal -Name "GIT_BRANCH" -Actual $branch -Expected $AllowedBranch

$status = (& git -C $RepoRoot status --short 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível verificar o working tree."
}
if ($status) {
    throw "Working tree precisa estar limpo antes do deploy staging."
}

$head = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
$remoteHead = (& git -C $RepoRoot rev-parse "origin/$AllowedBranch" 2>$null).Trim()

if (-not $head -or -not $remoteHead) {
    throw "Não foi possível resolver HEAD local/remoto."
}

Assert-Equal -Name "LOCAL_REMOTE_HEAD" -Actual $head -Expected $remoteHead

$firebasercPath = Join-Path $RepoRoot ".firebaserc"
if (-not (Test-Path $firebasercPath)) {
    throw ".firebaserc ausente."
}

$firebaserc = Get-Content $firebasercPath -Raw | ConvertFrom-Json

Assert-Equal -Name "FIREBASE_DEFAULT_ALIAS" -Actual $firebaserc.projects.default -Expected $ExpectedProject
Assert-Equal -Name "FIREBASE_STAGING_ALIAS" -Actual $firebaserc.projects.staging -Expected $ExpectedProject
Assert-Equal -Name "FIREBASE_PRODUCTION_ALIAS" -Actual $firebaserc.projects.production -Expected $ProductionProject

$packagePath = Join-Path $RepoRoot "functions\package.json"
$package = Get-Content $packagePath -Raw | ConvertFrom-Json
Assert-Equal -Name "FUNCTIONS_NODE_ENGINE" -Actual $package.engines.node -Expected "22"

$cliOutput = & npm exec --yes --package="firebase-tools@$ExpectedFirebaseCli" -- firebase --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Firebase CLI não pôde ser executado: $($cliOutput -join ' ')"
}
$cliVersion = ($cliOutput -join "").Trim()
Assert-Equal -Name "FIREBASE_CLI" -Actual $cliVersion -Expected $ExpectedFirebaseCli

$projectsOutput = & npm exec --yes --package="firebase-tools@$ExpectedFirebaseCli" -- firebase projects:list --json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível confirmar acesso Firebase ao staging: $($projectsOutput -join ' ')"
}

$projectsJson = ($projectsOutput -join [Environment]::NewLine) | ConvertFrom-Json
$projects = @()
if ($projectsJson.result) {
    $projects = @($projectsJson.result)
}
elseif ($projectsJson.projects) {
    $projects = @($projectsJson.projects)
}

$stagingProject = @(
    $projects | Where-Object {
        $_.projectId -eq $ExpectedProject
    }
)

if ($stagingProject.Count -ne 1) {
    throw "Projeto staging '$ExpectedProject' não foi encontrado exatamente uma vez em firebase projects:list."
}

$mainPath = Join-Path $RepoRoot "functions\main.js"
$functionsPath = Join-Path $RepoRoot "functions\src\finance\financial-admin-functions.js"
$servicePath = Join-Path $RepoRoot "functions\src\finance\financial-admin-service.js"

$main = [System.IO.File]::ReadAllText($mainPath)
$financialFunctions = [System.IO.File]::ReadAllText($functionsPath)
$financialService = [System.IO.File]::ReadAllText($servicePath)

foreach ($fn in $Functions) {
    if (-not $financialFunctions.Contains($fn)) {
        throw "Function esperada não encontrada no módulo financeiro: $fn"
    }
}

if (-not $main.Contains("createFinancialAdminFunctions")) {
    throw "functions/main.js não compõe createFinancialAdminFunctions."
}

$rules = [System.IO.File]::ReadAllText((Join-Path $RepoRoot "firestore.rules"))

if (-not $rules.Contains("match /financial_recipient_accounts/{accountId}")) {
    throw "Firestore Rules não contêm financial_recipient_accounts."
}

foreach ($forbidden in @("ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "asaas-helpers")) {
    if ($financialFunctions.Contains($forbidden) -or $financialService.Contains($forbidden)) {
        throw "Dependência Asaas proibida no 5.2 encontrada: $forbidden"
    }
}

Write-Host "MARCO5B_STAGING_DEPLOY_PRECHECK=OK"
Write-Host "TARGET_PROJECT=$ExpectedProject"
Write-Host "PRODUCTION_ACCESS=FORBIDDEN"
Write-Host "FINANCIAL_RUNTIME_EXPECTED=sandbox"
Write-Host "FUNCTIONS_COUNT=$($Functions.Count)"
Write-Host "FUNCTIONS_NODE_ENGINE=$($package.engines.node)"
Write-Host "FIREBASE_CLI=$cliVersion"
Write-Host "LOCAL_REMOTE_HEAD_MATCH=True"
Write-Host "WORKTREE_CLEAN=True"
Write-Host "ASAAS_CALLS_IN_5_2=False"

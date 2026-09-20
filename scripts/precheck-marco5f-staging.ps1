$ErrorActionPreference = "Stop"

$TargetProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$ExpectedBranch = "feature/marco5f-purchase-ui-ops"
$ExpectedFirebaseCli = "15.28.1"
$ApiSecretName = "ASAAS_API_KEY"
$WebhookSecretName = "ASAAS_WEBHOOK_TOKEN"
$ExpectedApiKeyPrefix = '$aact_hmlg_'

$CheckoutFunction = "iniciarCheckoutCursoV12"
$StudentStatusFunction = "obterStatusCompraCursoV12"
$StudentHistoryFunction = "listarComprasCursosAlunoV12"
$AdminReadFunction = "listarOperacoesFinanceirasCursosV12"
$CancelFunction = "cancelarCobrancaPendenteV12"
$RefundFunction = "solicitarEstornoIntegralV12"
$IngressFunction = "webhookAsaasPagamentosV12"
$WorkerFunction = "processarWebhookPagamentoV12"

if ($TargetProject -eq $ProductionProject) {
    throw "Projeto alvo nao pode ser producao."
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $process = Start-Process `
            -FilePath $FilePath `
            -ArgumentList $Arguments `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $stdout = if (Test-Path $stdoutPath) { [System.IO.File]::ReadAllText($stdoutPath).Trim() } else { "" }
        $stderr = if (Test-Path $stderrPath) { [System.IO.File]::ReadAllText($stderrPath).Trim() } else { "" }

        if ($process.ExitCode -ne 0) {
            throw "Processo falhou (exit $($process.ExitCode)): $FilePath $($Arguments -join ' ')`nSTDERR: $stderr"
        }

        return [PSCustomObject]@{
            Stdout = $stdout
            Stderr = $stderr
            ExitCode = $process.ExitCode
        }
    }
    finally {
        Remove-Item $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-FirebaseCli {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    $argumentList = @(
        "exec",
        "--yes",
        "--package=firebase-tools@$ExpectedFirebaseCli",
        "--",
        "firebase"
    ) + $Arguments
    return Invoke-CapturedProcess -FilePath $npmCommand.Source -Arguments $argumentList
}

function Invoke-GCloud {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $gcloudCommand = Get-Command gcloud.cmd -ErrorAction Stop
    return Invoke-CapturedProcess -FilePath $gcloudCommand.Source -Arguments $Arguments
}

function Assert-FileContains {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    if (-not (Test-Path $Path)) {
        throw "Arquivo ausente: $Path"
    }
    $content = [System.IO.File]::ReadAllText((Resolve-Path $Path))
    if (-not $content.Contains($Text)) {
        throw "Conteudo obrigatorio ausente em ${Path}: $Text"
    }
}

function Assert-FileNotContains {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    if (-not (Test-Path $Path)) {
        throw "Arquivo ausente: $Path"
    }
    $content = [System.IO.File]::ReadAllText((Resolve-Path $Path))
    if ($content.Contains($Text)) {
        throw "Conteudo proibido encontrado em ${Path}: $Text"
    }
}

function Assert-EnabledSecret {
    param([Parameter(Mandatory = $true)][string]$SecretName)

    $description = Invoke-GCloud -Arguments @(
        "secrets", "describe", $SecretName,
        "--project=$TargetProject",
        "--format=value(name)"
    )
    if (-not $description.Stdout) {
        throw "Secret $SecretName nao encontrado em staging."
    }

    $enabled = Invoke-GCloud -Arguments @(
        "secrets", "versions", "list", $SecretName,
        "--project=$TargetProject",
        "--filter=state=ENABLED",
        "--limit=1",
        "--format=value(name)"
    )
    if (-not $enabled.Stdout) {
        throw "Secret $SecretName nao possui versao ENABLED em staging."
    }
}

$branch = (git branch --show-current).Trim()
if ($branch -ne $ExpectedBranch) {
    throw "Branch incorreta. Esperado: $ExpectedBranch; atual: $branch"
}

$status = @(git status --porcelain)
if ($status.Count -ne 0) {
    throw "Working tree precisa estar limpa antes do precheck staging."
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
    throw "HEAD local diverge do remoto. Local: $localHead; remoto: $remoteHead"
}

$firebaseRc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
if ($firebaseRc.projects.default -ne $TargetProject) {
    throw "Projeto default precisa permanecer em staging."
}
if ($firebaseRc.projects.staging -ne $TargetProject) {
    throw "Alias staging nao aponta para $TargetProject."
}
if ($firebaseRc.projects.production -ne $ProductionProject) {
    throw "Alias production inesperado."
}

$functionsPackage = Get-Content "functions/package.json" -Raw | ConvertFrom-Json
if ([string]$functionsPackage.engines.node -ne "22") {
    throw "functions/package.json precisa manter Node 22."
}

foreach ($name in @("BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE", "BJJ_EXAMS_FAKE_ASAAS_AUTO_CONFIRM")) {
    $value = [string][Environment]::GetEnvironmentVariable($name)
    if ($value.Trim().ToLowerInvariant() -eq "true") {
        throw "$name nao pode estar habilitado no precheck staging."
    }
}

if (-not [string]::IsNullOrWhiteSpace([string]$env:BJJ_EXAMS_WEBHOOK_TOKEN)) {
    throw "BJJ_EXAMS_WEBHOOK_TOKEN local deve estar ausente; staging usa Secret Manager."
}

$stagingEnvPath = "functions/.env.$TargetProject"
if (Test-Path $stagingEnvPath) {
    $stagingEnv = Get-Content $stagingEnvPath -Raw
    if ($stagingEnv -match '(?im)^\s*BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE\s*=\s*true\s*$') {
        throw "Arquivo $stagingEnvPath habilita provider fake."
    }
    if ($stagingEnv -match '(?im)^\s*BJJ_EXAMS_FAKE_ASAAS_AUTO_CONFIRM\s*=\s*true\s*$') {
        throw "Arquivo $stagingEnvPath habilita auto confirm fake."
    }
    if ($stagingEnv -match '(?im)^\s*ASAAS_ENV\s*=\s*production\s*$') {
        throw "Arquivo $stagingEnvPath referencia ASAAS_ENV=production."
    }
}

Assert-FileContains -Path "functions/src/finance/financial-checkout-functions.js" -Text $CheckoutFunction
Assert-FileContains -Path "functions/src/finance/financial-purchase-read-functions.js" -Text $StudentStatusFunction
Assert-FileContains -Path "functions/src/finance/financial-purchase-read-functions.js" -Text $StudentHistoryFunction
Assert-FileContains -Path "functions/src/finance/financial-purchase-read-functions.js" -Text $AdminReadFunction
Assert-FileContains -Path "functions/src/finance/financial-reversal-admin-functions.js" -Text $CancelFunction
Assert-FileContains -Path "functions/src/finance/financial-reversal-admin-functions.js" -Text $RefundFunction
Assert-FileContains -Path "functions/src/finance/financial-webhook-functions.js" -Text $IngressFunction
Assert-FileContains -Path "functions/src/finance/financial-webhook-functions.js" -Text $WorkerFunction
Assert-FileContains -Path "functions/main.js" -Text "financialPurchaseReadFunctions = webhookRuntimeAllowed"
Assert-FileContains -Path "functions/main.js" -Text "financialReversalAdminFunctions = webhookRuntimeAllowed"
Assert-FileContains -Path "functions/main.js" -Text "firebaseProjectId === STAGING_PROJECT_ID"
Assert-FileContains -Path "functions/main.js" -Text "ASAAS_API_KEY"
Assert-FileContains -Path "functions/main.js" -Text "ASAAS_WEBHOOK_TOKEN"
Assert-FileContains -Path "functions/src/finance/asaas-checkout-provider-factory.js" -Text "https://api-sandbox.asaas.com/v3"
Assert-FileContains -Path "cursos.html" -Text "course-purchase-ui-v1_2.js"
Assert-FileContains -Path "cursos.html" -Text "purchase-production-blocked"
Assert-FileContains -Path "js/course-student-ui-v1_2.js" -Text "Compras e pagamentos"
Assert-FileContains -Path "js/course-student-ui-v1_2.js" -Text "api.listMyPurchases(25, apiOptions())"
Assert-FileNotContains -Path "js/course-purchase-ui-v1_2.js" -Text "providerPaymentId"
Assert-FileNotContains -Path "js/course-student-ui-v1_2.js" -Text "payment_transactions"
Assert-FileContains -Path "firestore.rules" -Text "match /orders/{orderId}"
Assert-FileContains -Path "firestore.rules" -Text "match /payment_transactions/{transactionId}"
Assert-FileContains -Path "firestore.rules" -Text "allow read, write: if false;"

$firebaseVersion = (Invoke-FirebaseCli -Arguments @("--version")).Stdout.Trim()
if ($firebaseVersion -ne $ExpectedFirebaseCli) {
    throw "Firebase CLI inesperada. Esperado: $ExpectedFirebaseCli; atual: $firebaseVersion"
}

$projectsJson = (Invoke-FirebaseCli -Arguments @("projects:list", "--json")).Stdout
if (-not $projectsJson) {
    throw "firebase projects:list nao retornou JSON."
}
$projects = $projectsJson | ConvertFrom-Json
$projectIds = @($projects.result | ForEach-Object { [string]$_.projectId })
if ($projectIds -notcontains $TargetProject) {
    throw "Projeto staging nao esta acessivel pela Firebase CLI: $TargetProject"
}

Assert-EnabledSecret -SecretName $ApiSecretName
Assert-EnabledSecret -SecretName $WebhookSecretName

$apiValueResult = Invoke-GCloud -Arguments @(
    "secrets", "versions", "access", "latest",
    "--secret=$ApiSecretName",
    "--project=$TargetProject"
)
$apiValue = [string]$apiValueResult.Stdout
try {
    if (-not $apiValue.StartsWith($ExpectedApiKeyPrefix)) {
        throw "ASAAS_API_KEY de staging nao possui prefixo Sandbox esperado."
    }
}
finally {
    $apiValue = $null
    $apiValueResult = $null
}

$webhookValueResult = Invoke-GCloud -Arguments @(
    "secrets", "versions", "access", "latest",
    "--secret=$WebhookSecretName",
    "--project=$TargetProject"
)
$webhookValue = [string]$webhookValueResult.Stdout
try {
    if ([string]::IsNullOrWhiteSpace($webhookValue) -or $webhookValue.Length -lt 32) {
        throw "ASAAS_WEBHOOK_TOKEN de staging e ausente ou curto demais."
    }
}
finally {
    $webhookValue = $null
    $webhookValueResult = $null
}

Write-Output "MARCO5F_STAGING_PRECHECK=OK"
Write-Output "TARGET_PROJECT=$TargetProject"
Write-Output "PRODUCTION_ACCESS=FORBIDDEN"
Write-Output "FINANCIAL_RUNTIME_EXPECTED=sandbox"
Write-Output "FINANCIAL_FUNCTIONS_EXPECTED=8"
Write-Output "FUNCTIONS_NODE_ENGINE=22"
Write-Output "FIREBASE_CLI=$firebaseVersion"
Write-Output "LOCAL_REMOTE_HEAD_MATCH=True"
Write-Output "WORKTREE_CLEAN=True"
Write-Output "CHECKOUT_PROVIDER_FAKE=False"
Write-Output "FAKE_AUTO_CONFIRM=False"
Write-Output "ASAAS_API_SECRET_ENABLED=True"
Write-Output "ASAAS_WEBHOOK_SECRET_ENABLED=True"
Write-Output "ASAAS_API_KEY_PREFIX=sandbox-compatible"
Write-Output "WEBHOOK_SECRET_MIN_LENGTH_OK=True"
Write-Output "PURCHASE_READ_RUNTIME_STAGING_ONLY=True"
Write-Output "REVERSAL_ADMIN_RUNTIME_STAGING_ONLY=True"
Write-Output "CANONICAL_FINANCIAL_COLLECTIONS_CLIENT_LOCKED=True"
Write-Output "SECRET_VALUE_PRINTED=False"
Write-Output "FIREBASE_PROJECT_ACCESS=OK"
Write-Output "STAGING_WRITE_PERFORMED=False"

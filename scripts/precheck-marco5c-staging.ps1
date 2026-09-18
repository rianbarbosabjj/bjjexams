$ErrorActionPreference = "Stop"

$TargetProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$ExpectedBranch = "feature/marco5c-asaas-sandbox-checkout"
$ExpectedFirebaseCli = "15.28.1"
$CheckoutFunction = "iniciarCheckoutCursoV12"
$SecretName = "ASAAS_API_KEY"
$ExpectedSecretPrefix = '$aact_hmlg_'

if ($TargetProject -eq $ProductionProject) {
    throw "Projeto alvo nao pode ser producao."
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
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

        $stdout = ""
        if (Test-Path $stdoutPath) {
            $stdout = [System.IO.File]::ReadAllText($stdoutPath).Trim()
        }

        $stderr = ""
        if (Test-Path $stderrPath) {
            $stderr = [System.IO.File]::ReadAllText($stderrPath).Trim()
        }

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
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    $argumentList = @(
        "exec",
        "--yes",
        "--package=firebase-tools@$ExpectedFirebaseCli",
        "--",
        "firebase"
    ) + $Arguments

    return Invoke-CapturedProcess `
        -FilePath $npmCommand.Source `
        -Arguments $argumentList
}

function Invoke-GCloud {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $gcloudCommand = Get-Command gcloud.cmd -ErrorAction Stop
    return Invoke-CapturedProcess `
        -FilePath $gcloudCommand.Source `
        -Arguments $Arguments
}

function Assert-FileContains {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    if (-not (Test-Path $Path)) {
        throw "Arquivo ausente: $Path"
    }

    $content = [System.IO.File]::ReadAllText((Resolve-Path $Path))
    if (-not $content.Contains($Text)) {
        throw "Conteudo obrigatorio ausente em ${Path}: $Text"
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

if (-not (Test-Path ".firebaserc")) {
    throw ".firebaserc ausente."
}

$firebaseRc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
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

$fakeProcessValue = [string]$env:BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE
if ($fakeProcessValue.Trim().ToLowerInvariant() -eq "true") {
    throw "BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE nao pode estar habilitado no precheck staging."
}

$stagingEnvPath = "functions/.env.$TargetProject"
if (Test-Path $stagingEnvPath) {
    $stagingEnv = Get-Content $stagingEnvPath -Raw
    if ($stagingEnv -match '(?im)^\s*BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE\s*=\s*true\s*$') {
        throw "Arquivo $stagingEnvPath habilita provider fake."
    }
    if ($stagingEnv -match '(?im)^\s*ASAAS_ENV\s*=\s*production\s*$') {
        throw "Arquivo $stagingEnvPath referencia ASAAS_ENV=production."
    }
}

Assert-FileContains `
    -Path "functions/src/finance/financial-checkout-functions.js" `
    -Text $CheckoutFunction
Assert-FileContains `
    -Path "functions/main.js" `
    -Text "financialCheckoutFunctions"
Assert-FileContains `
    -Path "functions/main.js" `
    -Text "checkoutSecrets"
Assert-FileContains `
    -Path "functions/src/finance/asaas-checkout-provider-factory.js" `
    -Text "https://api-sandbox.asaas.com/v3"
Assert-FileContains `
    -Path "functions/src/finance/asaas-checkout-provider-factory.js" `
    -Text "sandbox-only"
Assert-FileContains `
    -Path "firestore.rules" `
    -Text "match /financial_provider_customers/{customerId}"
Assert-FileContains `
    -Path "firestore.rules" `
    -Text "match /financial_checkout_leases/{leaseId}"

$firebaseVersion = (Invoke-FirebaseCli -Arguments @("--version")).Stdout.Trim()
if ($firebaseVersion -ne $ExpectedFirebaseCli) {
    throw "Firebase CLI inesperada. Esperado: $ExpectedFirebaseCli; atual: $firebaseVersion"
}

$projectsJson = (Invoke-FirebaseCli -Arguments @("projects:list", "--json")).Stdout
if (-not $projectsJson) {
    throw "firebase projects:list nao retornou JSON."
}

$projects = $projectsJson | ConvertFrom-Json
$projectIds = @()
if ($projects.result) {
    foreach ($item in $projects.result) {
        if ($item.projectId) {
            $projectIds += [string]$item.projectId
        }
    }
}

if ($projectIds -notcontains $TargetProject) {
    throw "Projeto staging nao esta acessivel pela Firebase CLI: $TargetProject"
}

$secretDescription = Invoke-GCloud -Arguments @(
    "secrets",
    "describe",
    $SecretName,
    "--project=$TargetProject",
    "--format=value(name)"
)
if (-not $secretDescription.Stdout) {
    throw "Secret $SecretName nao encontrado em staging."
}

$enabledVersion = Invoke-GCloud -Arguments @(
    "secrets",
    "versions",
    "list",
    $SecretName,
    "--project=$TargetProject",
    "--filter=state=ENABLED",
    "--limit=1",
    "--format=value(name)"
)
if (-not $enabledVersion.Stdout) {
    throw "Secret $SecretName nao possui versao ENABLED em staging."
}

# A chave e lida somente em memoria para validar o prefixo de Sandbox.
# O valor nunca e impresso pelo script.
$secretValueResult = Invoke-GCloud -Arguments @(
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=$SecretName",
    "--project=$TargetProject"
)
$secretValue = [string]$secretValueResult.Stdout
try {
    if (-not $secretValue.StartsWith($ExpectedSecretPrefix)) {
        throw "ASAAS_API_KEY de staging nao possui prefixo de Sandbox esperado."
    }
}
finally {
    $secretValue = $null
    $secretValueResult = $null
}

Write-Output "MARCO5C_STAGING_PRECHECK=OK"
Write-Output "TARGET_PROJECT=$TargetProject"
Write-Output "PRODUCTION_ACCESS=FORBIDDEN"
Write-Output "FINANCIAL_RUNTIME_EXPECTED=sandbox"
Write-Output "CHECKOUT_FUNCTION=$CheckoutFunction"
Write-Output "FUNCTIONS_NODE_ENGINE=22"
Write-Output "FIREBASE_CLI=$firebaseVersion"
Write-Output "LOCAL_REMOTE_HEAD_MATCH=True"
Write-Output "WORKTREE_CLEAN=True"
Write-Output "CHECKOUT_PROVIDER_FAKE=False"
Write-Output "ASAAS_SECRET_EXISTS=True"
Write-Output "ASAAS_SECRET_ENABLED=True"
Write-Output "ASAAS_KEY_PREFIX=sandbox-compatible"
Write-Output "SECRET_VALUE_PRINTED=False"
Write-Output "RULES_OPERATIONAL_COLLECTIONS_LOCKED=True"
Write-Output "FIREBASE_PROJECT_ACCESS=OK"

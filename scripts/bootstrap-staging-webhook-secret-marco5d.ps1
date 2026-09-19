$ErrorActionPreference = "Stop"

$TargetProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$ExpectedBranch = "feature/marco5d-webhook-fulfillment"
$ExpectedFirebaseCli = "15.28.1"
$SecretName = "ASAAS_WEBHOOK_TOKEN"
$AllowVariable = "BJJ_EXAMS_ALLOW_STAGING_WEBHOOK_SECRET_WRITE"

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

        $stdout = if (Test-Path $stdoutPath) {
            [System.IO.File]::ReadAllText($stdoutPath).Trim()
        } else { "" }
        $stderr = if (Test-Path $stderrPath) {
            [System.IO.File]::ReadAllText($stderrPath).Trim()
        } else { "" }

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

function Test-SecretExists {
    try {
        $result = Invoke-GCloud -Arguments @(
            "secrets", "describe", $SecretName,
            "--project=$TargetProject",
            "--format=value(name)"
        )
        return -not [string]::IsNullOrWhiteSpace($result.Stdout)
    }
    catch {
        return $false
    }
}

function Test-EnabledVersionExists {
    if (-not (Test-SecretExists)) { return $false }
    $result = Invoke-GCloud -Arguments @(
        "secrets", "versions", "list", $SecretName,
        "--project=$TargetProject",
        "--filter=state=ENABLED",
        "--limit=1",
        "--format=value(name)"
    )
    return -not [string]::IsNullOrWhiteSpace($result.Stdout)
}

$branch = (git branch --show-current).Trim()
if ($branch -ne $ExpectedBranch) {
    throw "Branch incorreta. Esperado: $ExpectedBranch; atual: $branch"
}

$status = @(git status --porcelain)
if ($status.Count -ne 0) {
    throw "Working tree precisa estar limpa antes do bootstrap do secret."
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
    throw "HEAD local diverge do remoto. Faça pull antes do bootstrap."
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

$firebaseVersion = (Invoke-FirebaseCli -Arguments @("--version")).Stdout.Trim()
if ($firebaseVersion -ne $ExpectedFirebaseCli) {
    throw "Firebase CLI inesperada. Esperado: $ExpectedFirebaseCli; atual: $firebaseVersion"
}

$projectsJson = (Invoke-FirebaseCli -Arguments @("projects:list", "--json")).Stdout
$projects = $projectsJson | ConvertFrom-Json
$projectIds = @($projects.result | ForEach-Object { [string]$_.projectId })
if ($projectIds -notcontains $TargetProject) {
    throw "Projeto staging nao esta acessivel pela Firebase CLI: $TargetProject"
}

if (Test-EnabledVersionExists) {
    Write-Output "MARCO5D_STAGING_WEBHOOK_SECRET_BOOTSTRAP=ALREADY_READY"
    Write-Output "TARGET_PROJECT=$TargetProject"
    Write-Output "SECRET_NAME=$SecretName"
    Write-Output "SECRET_ENABLED=True"
    Write-Output "SECRET_VALUE_PRINTED=False"
    Write-Output "DATA_WRITES_PERFORMED=False"
    Write-Output "PRODUCTION_ACCESS=NOT_RUN"
    exit 0
}

$allow = [string][Environment]::GetEnvironmentVariable($AllowVariable)
if ($allow.Trim().ToLowerInvariant() -ne "true") {
    throw "$SecretName ainda nao possui versao ENABLED. Para criar em staging, defina $AllowVariable=true somente durante esta execucao."
}

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$tempPath = [System.IO.Path]::GetTempFileName()
try {
    $rng.GetBytes($bytes)
    $token = ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    if ($token.Length -ne 64) {
        throw "Falha ao gerar token criptografico."
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempPath, $token, $utf8NoBom)

    Invoke-FirebaseCli -Arguments @(
        "functions:secrets:set", $SecretName,
        "--data-file", $tempPath,
        "--project", $TargetProject
    ) | Out-Null
}
finally {
    $token = $null
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($rng) { $rng.Dispose() }
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-EnabledVersionExists)) {
    throw "Secret foi criado/atualizado, mas nenhuma versao ENABLED foi encontrada."
}

Write-Output "MARCO5D_STAGING_WEBHOOK_SECRET_BOOTSTRAP=OK"
Write-Output "TARGET_PROJECT=$TargetProject"
Write-Output "SECRET_NAME=$SecretName"
Write-Output "SECRET_ENABLED=True"
Write-Output "SECRET_VALUE_PRINTED=False"
Write-Output "DATA_WRITES_PERFORMED=True"
Write-Output "PRODUCTION_ACCESS=NOT_RUN"

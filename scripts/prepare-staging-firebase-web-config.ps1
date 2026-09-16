param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$ProjectId = "bjj-exams-staging",
    [string]$WebAppId = "1:206338587822:web:d870ac4cf23b6a1b6f813f"
)

$ErrorActionPreference = "Stop"

$ExpectedProject = "bjj-exams-staging"
$OutputPath = Join-Path $RepoRoot "js\firebase-config.local.json"

if ($ProjectId -ne $ExpectedProject) {
    throw "Execução bloqueada: este script só prepara configuração para $ExpectedProject."
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível identificar a branch Git."
}

if ($branch -ne "feature/marco4a4-authenticated-ui") {
    throw "Execução bloqueada na branch '$branch'. Use feature/marco4a4-authenticated-ui."
}

$ignored = & git -C $RepoRoot check-ignore -q "js/firebase-config.local.json"
if ($LASTEXITCODE -ne 0) {
    throw "Proteção ausente: js/firebase-config.local.json precisa estar ignorado pelo Git."
}

# O Firebase CLI pode escrever mensagens informativas de progresso em stderr.
# Em Windows PowerShell, com ErrorActionPreference=Stop, isso pode virar um
# NativeCommandError mesmo quando o comando termina com exit code 0.
# Executamos somente esta chamada com Continue, descartamos stderr e validamos
# explicitamente o exit code antes de usar qualquer dado retornado.
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if ($npxCommand) {
        $sdkConfig = & $npxCommand.Source firebase-tools@15.28.1 apps:sdkconfig WEB $WebAppId --project $ProjectId 2>$null
    } else {
        $sdkConfig = & npx firebase-tools@15.28.1 apps:sdkconfig WEB $WebAppId --project $ProjectId 2>$null
    }
    $firebaseCliExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($firebaseCliExitCode -ne 0) {
    throw "Falha ao obter a configuração oficial do app Web de staging (exit code $firebaseCliExitCode)."
}

if (-not $sdkConfig) {
    throw "Firebase CLI não retornou configuração para o app Web de staging."
}

$text = ($sdkConfig -join "`n")

function Read-ConfigField {
    param(
        [string]$Name,
        [bool]$Required = $true
    )

    $escaped = [regex]::Escape($Name)
    $match = [regex]::Match(
        $text,
        ('(?:"{0}"|{0})\s*:\s*"([^"]+)"' -f $escaped)
    )

    if (-not $match.Success) {
        if ($Required) {
            throw "Campo obrigatório '$Name' não encontrado na configuração Firebase."
        }
        return $null
    }

    return $match.Groups[1].Value
}

$config = [ordered]@{
    apiKey = Read-ConfigField "apiKey"
    authDomain = Read-ConfigField "authDomain"
    projectId = Read-ConfigField "projectId"
    storageBucket = Read-ConfigField "storageBucket" $false
    messagingSenderId = Read-ConfigField "messagingSenderId" $false
    appId = Read-ConfigField "appId"
}

$measurementId = Read-ConfigField "measurementId" $false
if ($measurementId) {
    $config.measurementId = $measurementId
}

if ($config.projectId -ne $ExpectedProject) {
    throw "Configuração bloqueada: esperado projectId '$ExpectedProject', recebido '$($config.projectId)'."
}

if ($config.appId -ne $WebAppId) {
    throw "Configuração bloqueada: App ID retornado não corresponde ao app Web oficial de staging."
}

$json = $config | ConvertTo-Json -Depth 3
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, $json + [Environment]::NewLine, $utf8NoBom)

$parsed = Get-Content -Raw -Encoding UTF8 $OutputPath | ConvertFrom-Json
if ($parsed.projectId -ne $ExpectedProject) {
    Remove-Item $OutputPath -Force -ErrorAction SilentlyContinue
    throw "Validação pós-gravação falhou."
}

& git -C $RepoRoot check-ignore -q "js/firebase-config.local.json"
if ($LASTEXITCODE -ne 0) {
    Remove-Item $OutputPath -Force -ErrorAction SilentlyContinue
    throw "Arquivo local não está protegido pelo .gitignore."
}

Write-Host "STAGING_FIREBASE_WEB_CONFIG=READY"
Write-Host "TARGET_PROJECT=$ExpectedProject"
Write-Host "WEB_APP_ID_MATCH=True"
Write-Host "LOCAL_CONFIG_GIT_IGNORED=True"
Write-Host "SENSITIVE_CONFIG_VALUES_PRINTED=False"
Write-Host "PRODUCTION_ACCESS=NOT_RUN"
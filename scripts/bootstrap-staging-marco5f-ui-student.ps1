param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

$ExpectedProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$ExpectedBranch = "feature/marco5f-purchase-ui-ops"
$ConfigPath = Join-Path $RepoRoot "js\firebase-config.local.json"

function Fail([string]$Message) {
    throw $Message
}

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function New-TestCpf {
    do {
        $digits = @()
        1..9 | ForEach-Object { $digits += Get-Random -Minimum 0 -Maximum 10 }
    } while (($digits | Select-Object -Unique).Count -eq 1)

    function Get-CheckDigit([int[]]$Base) {
        $sum = 0
        for ($i = 0; $i -lt $Base.Count; $i++) {
            $sum += $Base[$i] * ($Base.Count + 1 - $i)
        }
        $mod = ($sum * 10) % 11
        if ($mod -eq 10) { return 0 }
        return $mod
    }

    $digits += Get-CheckDigit $digits
    $digits += Get-CheckDigit $digits
    return ($digits -join "")
}

function To-FirestoreValue($Value) {
    if ($null -eq $Value) {
        return @{ nullValue = $null }
    }
    if ($Value -is [bool]) {
        return @{ booleanValue = $Value }
    }
    if ($Value -is [int] -or $Value -is [long]) {
        return @{ integerValue = [string]$Value }
    }
    if ($Value -is [DateTime]) {
        return @{ timestampValue = $Value.ToUniversalTime().ToString("o") }
    }
    return @{ stringValue = [string]$Value }
}

function To-FirestoreFields([hashtable]$Data) {
    $fields = @{}
    foreach ($entry in $Data.GetEnumerator()) {
        $fields[$entry.Key] = To-FirestoreValue $entry.Value
    }
    return $fields
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $ExpectedBranch) {
    Fail "Branch inválida. Esperado: $ExpectedBranch; atual: $branch"
}

$status = @(& git -C $RepoRoot status --porcelain)
if ($status.Count -ne 0) {
    Fail "Working tree precisa estar limpa."
}

$localHead = (& git -C $RepoRoot rev-parse HEAD).Trim()
$remoteHead = (& git -C $RepoRoot rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
    Fail "HEAD local diverge de origin/$ExpectedBranch. Execute git pull --ff-only antes."
}

if (-not (Test-Path $ConfigPath)) {
    Fail "Config local de staging ausente. Execute scripts/prepare-staging-firebase-web-config.ps1 primeiro."
}

$config = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json
if ([string]$config.projectId -ne $ExpectedProject) {
    Fail "Configuração local não aponta para $ExpectedProject."
}
if ([string]$config.projectId -eq $ProductionProject) {
    Fail "Produção bloqueada."
}
if ([string]::IsNullOrWhiteSpace([string]$config.apiKey)) {
    Fail "Firebase Web API key de staging ausente."
}

$project = (& gcloud.cmd projects describe $ExpectedProject --format="value(projectId)" 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $project -ne $ExpectedProject -or $project -eq $ProductionProject) {
    Fail "Projeto staging não confirmado no gcloud."
}

Write-Host "Digite uma senha temporária para o aluno de smoke (mínimo 8 caracteres)."
$securePassword = Read-Host -AsSecureString "Senha"
$password = Convert-SecureStringToPlainText $securePassword
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 8) {
    Fail "Senha precisa ter pelo menos 8 caracteres."
}

$runId = "{0}-{1}" -f ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
$email = "bjjexams-marco5f-ui-$runId@example.test"
$cpf = New-TestCpf
$now = [DateTime]::UtcNow

$signUpUri = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$([Uri]::EscapeDataString([string]$config.apiKey))"
$signUpBody = @{
    email = $email
    password = $password
    returnSecureToken = $true
} | ConvertTo-Json -Compress

$signed = $null
try {
    $signed = Invoke-RestMethod `
        -Method Post `
        -Uri $signUpUri `
        -ContentType "application/json" `
        -Body $signUpBody
}
finally {
    $password = $null
    $securePassword = $null
}

$uid = [string]$signed.localId
$idToken = [string]$signed.idToken
if ([string]::IsNullOrWhiteSpace($uid) -or [string]::IsNullOrWhiteSpace($idToken)) {
    Fail "Firebase Auth não retornou uid/idToken."
}

$accessToken = (& gcloud.cmd auth print-access-token 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accessToken)) {
    Fail "Não foi possível obter access token do gcloud."
}

$headers = @{
    Authorization = "Bearer $accessToken"
    "Content-Type" = "application/json"
}

function Put-FirestoreDocument([string]$Path, [hashtable]$Data) {
    $segments = $Path.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
    $encodedPath = $segments -join '/'
    $uri = "https://firestore.googleapis.com/v1/projects/$ExpectedProject/databases/(default)/documents/$encodedPath"
    $body = @{ fields = (To-FirestoreFields $Data) } | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -Body $body | Out-Null
}

$profile = @{
    nome = "BJJ Exams Smoke UI 5.6"
    email = $email
    cpf = $cpf
    telefone = "61999990000"
    tipo_usuario = "aluno"
    status_conta = "ativo"
    sistema_origem = "bjj_exams"
    smokeTest = $true
    smokeRunId = $runId
    createdAt = $now
    updatedAt = $now
}

$student = @{
    nome = "BJJ Exams Smoke UI 5.6"
    email = $email
    cpf = $cpf
    telefone = "61999990000"
    tipo_usuario = "aluno"
    status_conta = "ativo"
    status_vinculo = "sem_equipe"
    exame_habilitado = $false
    pontos_rola = 0
    sistema_origem = "bjj_exams"
    smokeTest = $true
    smokeRunId = $runId
    createdAt = $now
    updatedAt = $now
}

try {
    Put-FirestoreDocument "usuarios/$uid" $profile
    Put-FirestoreDocument "alunos/$uid" $student
}
catch {
    try {
        $deleteBody = @{ idToken = $idToken } | ConvertTo-Json -Compress
        Invoke-RestMethod `
            -Method Post `
            -Uri "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$([Uri]::EscapeDataString([string]$config.apiKey))" `
            -ContentType "application/json" `
            -Body $deleteBody | Out-Null
    }
    catch {}
    throw
}

Write-Output "MARCO5F_UI_STUDENT_BOOTSTRAP=OK"
Write-Output "TARGET_PROJECT=$ExpectedProject"
Write-Output "PRODUCTION_ACCESS=NOT_RUN"
Write-Output "STUDENT_EMAIL=$email"
Write-Output "STUDENT_UID=$uid"
Write-Output "CANONICAL_USER_PROFILE_CREATED=True"
Write-Output "STUDENT_PROFILE_CREATED=True"
Write-Output "PASSWORD_PRINTED=False"
Write-Output "FIREBASE_API_KEY_PRINTED=False"
Write-Output "ACCESS_TOKEN_PRINTED=False"

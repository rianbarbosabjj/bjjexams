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

& git -C $RepoRoot fetch --quiet origin $ExpectedBranch 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "Não foi possível atualizar a referência remota da branch."
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

Write-Host "Digite uma senha temporária para o administrador de smoke (mínimo 8 caracteres)."
$securePassword = Read-Host -AsSecureString "Senha"
$password = Convert-SecureStringToPlainText $securePassword
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 8) {
    $password = $null
    $securePassword = $null
    Fail "Senha precisa ter pelo menos 8 caracteres."
}

$runId = "{0}-{1}" -f ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
$email = "bjjexams-marco5f-admin-$runId@example.test"
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
    try {
        $deleteBody = @{ idToken = $idToken } | ConvertTo-Json -Compress
        Invoke-RestMethod `
            -Method Post `
            -Uri "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=$([Uri]::EscapeDataString([string]$config.apiKey))" `
            -ContentType "application/json" `
            -Body $deleteBody | Out-Null
    }
    catch {}
    Fail "Não foi possível obter access token do gcloud."
}

$oauthHeaders = @{
    Authorization = "Bearer $accessToken"
    "Content-Type" = "application/json"
    "x-goog-user-project" = $ExpectedProject
}

$firestoreHeaders = @{
    Authorization = "Bearer $accessToken"
    "Content-Type" = "application/json"
}

function Put-FirestoreDocument([string]$Path, [hashtable]$Data) {
    $segments = $Path.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
    $encodedPath = $segments -join '/'
    $uri = "https://firestore.googleapis.com/v1/projects/$ExpectedProject/databases/(default)/documents/$encodedPath"
    $body = @{ fields = (To-FirestoreFields $Data) } | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Method Patch -Uri $uri -Headers $firestoreHeaders -Body $body | Out-Null
}

function Remove-FirestoreDocument([string]$Path) {
    $segments = $Path.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
    $encodedPath = $segments -join '/'
    $uri = "https://firestore.googleapis.com/v1/projects/$ExpectedProject/databases/(default)/documents/$encodedPath"
    try {
        Invoke-RestMethod -Method Delete -Uri $uri -Headers @{ Authorization = "Bearer $accessToken" } | Out-Null
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }
}

$customAttributes = @{ super_admin = $true } | ConvertTo-Json -Compress
$claimBody = @{
    localId = $uid
    emailVerified = $true
    customAttributes = $customAttributes
} | ConvertTo-Json -Compress

$userProfile = @{
    nome = "BJJ Exams Smoke Admin UI 5.6"
    email = $email
    tipo_usuario = "superadmin"
    status_conta = "ativo"
    sistema_origem = "bjj_exams"
    smokeTest = $true
    smokeRunId = $runId
    createdAt = $now
    updatedAt = $now
}

$superAdminProfile = @{
    nome = "BJJ Exams Smoke Admin UI 5.6"
    email = $email
    tipo_usuario = "superadmin"
    status_conta = "ativo"
    ativo = $true
    sistema_origem = "bjj_exams"
    smokeTest = $true
    smokeRunId = $runId
    createdAt = $now
    updatedAt = $now
}

$userProfileCreated = $false
$superAdminProfileCreated = $false
$claimSet = $false

try {
    $claimUri = "https://identitytoolkit.googleapis.com/v1/projects/$ExpectedProject/accounts:update"
    $claimResult = Invoke-RestMethod `
        -Method Post `
        -Uri $claimUri `
        -Headers $oauthHeaders `
        -Body $claimBody

    if ([string]$claimResult.localId -ne $uid) {
        Fail "Identity Toolkit não confirmou o UID ao aplicar o claim super_admin."
    }
    $claimSet = $true

    Put-FirestoreDocument "usuarios/$uid" $userProfile
    $userProfileCreated = $true

    Put-FirestoreDocument "super_admins/$uid" $superAdminProfile
    $superAdminProfileCreated = $true
}
catch {
    try {
        if ($superAdminProfileCreated) { Remove-FirestoreDocument "super_admins/$uid" }
        if ($userProfileCreated) { Remove-FirestoreDocument "usuarios/$uid" }
    }
    catch {}

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
finally {
    $accessToken = $null
    $idToken = $null
    $claimBody = $null
    $customAttributes = $null
}

Write-Output "MARCO5F_UI_ADMIN_BOOTSTRAP=OK"
Write-Output "TARGET_PROJECT=$ExpectedProject"
Write-Output "PRODUCTION_ACCESS=NOT_RUN"
Write-Output "ADMIN_EMAIL=$email"
Write-Output "ADMIN_UID=$uid"
Write-Output "SUPER_ADMIN_CLAIM_SET=$([string]$claimSet)"
Write-Output "CANONICAL_USER_PROFILE_CREATED=$([string]$userProfileCreated)"
Write-Output "SUPER_ADMIN_PROFILE_CREATED=$([string]$superAdminProfileCreated)"
Write-Output "PASSWORD_PRINTED=False"
Write-Output "FIREBASE_API_KEY_PRINTED=False"
Write-Output "ACCESS_TOKEN_PRINTED=False"

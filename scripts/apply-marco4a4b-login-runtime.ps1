param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

function Assert-Contains {
    param(
        [string]$Content,
        [string]$Needle,
        [string]$Description
    )

    if (-not $Content.Contains($Needle)) {
        throw "Marco 4A.4b login: marcador ausente: $Description"
    }
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Marco 4A.4b login: não foi possível identificar a branch Git."
}

if ($branch -ne "feature/marco4a4-authenticated-ui") {
    throw "Marco 4A.4b login: execução bloqueada na branch '$branch'."
}

$loginPath = Join-Path $RepoRoot "login.html"
if (-not (Test-Path $loginPath)) {
    throw "Marco 4A.4b login: login.html não encontrado."
}

$content = Get-Content -Raw -Encoding UTF8 $loginPath
$content = $content.Replace("`r`n", "`n")

$alreadyApplied =
    $content.Contains('js/firebase-runtime-v1_2.js') -and
    $content.Contains('await window.BjjExamsFirebaseRuntime.loadConfig') -and
    (-not $content.Contains('const firebaseConfig = {'))

if ($alreadyApplied) {
    Write-Host "MARCO4A4B_LOGIN_RUNTIME_PATCH=ALREADY_APPLIED"
    Write-Host "LOCALHOST_PRODUCTION_CONFIG=AUTO_BLOCKED"
    exit 0
}

$legacyFirebaseBlock = @'
        const firebaseConfig = {
          apiKey: "AIzaSyDMYhKseehy_V0bmotTo63WPJgcsz4sFwI",
          authDomain: "bjj-exams.firebaseapp.com",
          projectId: "bjj-exams",
          storageBucket: "bjj-exams.firebasestorage.app",
          messagingSenderId: "682125845998",
          appId: "1:682125845998:web:bf58e915a2860bc79e5aff"
        };
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
'@
$legacyFirebaseBlock = $legacyFirebaseBlock.Replace("`r`n", "`n")

$runtimeFirebaseBlock = @'
        const firebaseConfig = await window.BjjExamsFirebaseRuntime.loadConfig({
            hostname: window.location.hostname
        });
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
'@
$runtimeFirebaseBlock = $runtimeFirebaseBlock.Replace("`r`n", "`n")

$moduleMarker = '    <script type="module">'

Assert-Contains $content $legacyFirebaseBlock "configuração Firebase legada"
Assert-Contains $content $moduleMarker "script module do login"

$content = $content.Replace($legacyFirebaseBlock, $runtimeFirebaseBlock)
$content = $content.Replace(
    $moduleMarker,
    "    <script src=`"js/firebase-runtime-v1_2.js`"></script>`n$moduleMarker"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($loginPath, $content, $utf8NoBom)

$verify = Get-Content -Raw -Encoding UTF8 $loginPath
$verify = $verify.Replace("`r`n", "`n")

$checks = [ordered]@{
    RUNTIME_CONFIG = $verify.Contains('js/firebase-runtime-v1_2.js')
    RUNTIME_LOADER = $verify.Contains('await window.BjjExamsFirebaseRuntime.loadConfig')
    HARDCODED_PRODUCTION_INIT_REMOVED = -not $verify.Contains('const firebaseConfig = {')
    ROLE_ROUTING_PRESERVED = $verify.Contains('async function rotearUsuario(user)')
    PROFESSOR_ROUTE_PRESERVED = $verify.Contains('window.location.href = "painel_professor.html"')
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
foreach ($item in $checks.GetEnumerator()) {
    Write-Host "$($item.Key)=$($item.Value)"
}

if ($failed.Count -gt 0) {
    throw "Marco 4A.4b login: validação pós-patch falhou."
}

Write-Host "MARCO4A4B_LOGIN_RUNTIME_PATCH=OK"
Write-Host "LOCALHOST_PRODUCTION_CONFIG=AUTO_BLOCKED"
Write-Host "PRODUCTION_DEPLOY=NOT_RUN"

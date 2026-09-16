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
        throw "Marco 4A.4b: marcador ausente: $Description"
    }
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Marco 4A.4b: não foi possível identificar a branch Git."
}

if ($branch -ne "feature/marco4a4-authenticated-ui") {
    throw "Marco 4A.4b: execução bloqueada na branch '$branch'. Use feature/marco4a4-authenticated-ui."
}

$panelPath = Join-Path $RepoRoot "painel_professor.html"
if (-not (Test-Path $panelPath)) {
    throw "Marco 4A.4b: painel_professor.html não encontrado."
}

$content = Get-Content -Raw -Encoding UTF8 $panelPath

$alreadyApplied =
    $content.Contains('course-admin-api-v1_2.js') -and
    $content.Contains('course-instructor-ui-v1_2.js') -and
    $content.Contains('window.__BJJ_EXAMS_AUTH__ = auth;')

if ($alreadyApplied) {
    Write-Host "MARCO4A4B_PROFESSOR_UI_PATCH=ALREADY_APPLIED"
    Write-Host "LEGACY_COURSE_INITIAL_LOAD=DISABLED=$($content.Contains('carregarEquipesPerfil(); carregarMinhasQuestoes(); carregarCursosProf();') -eq $false)"
    exit 0
}

$authMarker = 'const app = initializeApp(firebaseConfig); const auth = getAuth(app); const db = getFirestore(app); const storage = getStorage(app);'
$tabMarker = "if(tabName === 'cursos') carregarCursosProf();"
$initialMarker = 'carregarEquipesPerfil(); carregarMinhasQuestoes(); carregarCursosProf();'
$moduleMarker = '    <script type="module">'
$closingMarker = "    </script>`r`n</body>"
if (-not $content.Contains($closingMarker)) {
    $closingMarker = "    </script>`n</body>"
}

Assert-Contains $content $authMarker "ponte Firebase Auth"
Assert-Contains $content $tabMarker "carregamento da aba Cursos"
Assert-Contains $content $initialMarker "carregamento inicial legado de cursos"
Assert-Contains $content $moduleMarker "script module principal"
Assert-Contains $content $closingMarker "fechamento do module principal"

$content = $content.Replace(
    $authMarker,
    "$authMarker window.__BJJ_EXAMS_AUTH__ = auth;"
)

$content = $content.Replace(
    $tabMarker,
    "if(tabName === 'cursos') window.carregarCursosProf();"
)

$content = $content.Replace(
    $initialMarker,
    'carregarEquipesPerfil(); carregarMinhasQuestoes();'
)

$content = $content.Replace(
    '> Gestão de Cursos</button>',
    '> Meus Cursos</button>'
)

$content = $content.Replace(
    '<div><h2 class="text-2xl font-black text-white uppercase tracking-wide">Academia Digital (EAD)</h2><p class="text-sm text-slate-400 mt-1">Crie cursos EAD interativos e suba apostilas PDF nativas.</p></div>',
    '<div><h2 class="text-2xl font-black text-white uppercase tracking-wide">Meus Cursos</h2><p class="text-sm text-slate-400 mt-1">Crie, edite e envie seus cursos para revisão usando a arquitetura v1.2.</p></div>'
)

$content = $content.Replace(
    $moduleMarker,
    "    <script src=`"js/course-admin-api-v1_2.js`"></script>`r`n$moduleMarker"
)

$closingReplacement = "    </script>`r`n    <script type=`"module`" src=`"js/course-instructor-ui-v1_2.js`"></script>`r`n</body>"
if ($closingMarker.Contains("`n") -and -not $closingMarker.Contains("`r`n")) {
    $closingReplacement = "    </script>`n    <script type=`"module`" src=`"js/course-instructor-ui-v1_2.js`"></script>`n</body>"
}
$content = $content.Replace($closingMarker, $closingReplacement)

Set-Content -Path $panelPath -Value $content -Encoding UTF8 -NoNewline

$verify = Get-Content -Raw -Encoding UTF8 $panelPath

$checks = [ordered]@{
    AUTH_BRIDGE = $verify.Contains('window.__BJJ_EXAMS_AUTH__ = auth;')
    ADMIN_API_SCRIPT = $verify.Contains('js/course-admin-api-v1_2.js')
    INSTRUCTOR_UI_SCRIPT = $verify.Contains('js/course-instructor-ui-v1_2.js')
    TAB_USES_WINDOW_HANDLER = $verify.Contains("if(tabName === 'cursos') window.carregarCursosProf();")
    LEGACY_INITIAL_COURSE_LOAD_REMOVED = -not $verify.Contains('carregarEquipesPerfil(); carregarMinhasQuestoes(); carregarCursosProf();')
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
foreach ($item in $checks.GetEnumerator()) {
    Write-Host "$($item.Key)=$($item.Value)"
}

if ($failed.Count -gt 0) {
    throw "Marco 4A.4b: validação pós-patch falhou."
}

Write-Host "MARCO4A4B_PROFESSOR_UI_PATCH=OK"
Write-Host "PRODUCTION_DEPLOY=NOT_RUN"

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$ExpectedBranch = "feature/marco4a5b-course-content-ui"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8File {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8File {
    param([string]$Path, [string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Replace-ExactlyOnce {
    param(
        [string]$Content,
        [string]$Old,
        [string]$New,
        [string]$Label
    )

    $newline = if ($Content.Contains("`r`n")) { "`r`n" } else { "`n" }
    $oldNormalized = [regex]::Replace($Old, '\r?\n', $newline)
    $newNormalized = [regex]::Replace($New, '\r?\n', $newline)

    $first = $Content.IndexOf($oldNormalized, [System.StringComparison]::Ordinal)
    if ($first -lt 0) {
        throw "Marcador não encontrado: $Label"
    }
    $second = $Content.IndexOf($oldNormalized, $first + $oldNormalized.Length, [System.StringComparison]::Ordinal)
    if ($second -ge 0) {
        throw "Marcador duplicado: $Label"
    }
    return $Content.Substring(0, $first) + $newNormalized + $Content.Substring($first + $oldNormalized.Length)
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível identificar a branch Git."
}
if ($branch -ne $ExpectedBranch) {
    throw "Execução bloqueada na branch '$branch'. Esperado: '$ExpectedBranch'."
}

$adminApiPath = Join-Path $RepoRoot "js\course-admin-api-v1_2.js"
$instructorUiPath = Join-Path $RepoRoot "js\course-instructor-ui-v1_2.js"
$panelPath = Join-Path $RepoRoot "painel_professor.html"
$adminUiTestPath = Join-Path $RepoRoot "tests\course-admin-ui-v1_2.test.js"

foreach ($path in @($adminApiPath, $instructorUiPath, $panelPath, $adminUiTestPath)) {
    if (-not (Test-Path $path)) {
        throw "Arquivo obrigatório ausente: $path"
    }
}

$adminApi = Read-Utf8File $adminApiPath
$instructorUi = Read-Utf8File $instructorUiPath
$panel = Read-Utf8File $panelPath
$adminUiTest = Read-Utf8File $adminUiTestPath

if ($adminApi.Contains('return ["edit", "content", "review", "archive"];')) {
    Write-Host "COURSE_ADMIN_ACTION_PATCH=ALREADY_APPLIED"
} else {
    $adminApi = Replace-ExactlyOnce `
        -Content $adminApi `
        -Old 'return ["edit", "review", "archive"];' `
        -New 'return ["edit", "content", "review", "archive"];' `
        -Label "draft instructor actions"
    Write-Utf8File $adminApiPath $adminApi
    Write-Host "COURSE_ADMIN_ACTION_PATCH=APPLIED"
}

if ($instructorUi.Contains('actionButton("Conteúdo", "list-dashes"')) {
    Write-Host "COURSE_INSTRUCTOR_CONTENT_ACTION_PATCH=ALREADY_APPLIED"
} else {
    $oldAction = @'
      } else if (action === "review") {
        actions.appendChild(
          actionButton("Solicitar publica\u00e7\u00e3o", "paper-plane-tilt", "primary", () => submitForReview(course.id))
        );
'@
    $newAction = @'
      } else if (action === "content") {
        actions.appendChild(
          actionButton("Conteúdo", "list-dashes", "secondary", () => {
            const contentUi = root.BjjExamsCourseContentUi;
            if (!contentUi) {
              return showOperationError(new Error("Estúdio de conteúdo indisponível."));
            }
            return contentUi.openStudio(course);
          })
        );
      } else if (action === "review") {
        actions.appendChild(
          actionButton("Solicitar publica\u00e7\u00e3o", "paper-plane-tilt", "primary", () => submitForReview(course.id))
        );
'@
    $instructorUi = Replace-ExactlyOnce `
        -Content $instructorUi `
        -Old $oldAction `
        -New $newAction `
        -Label "content action in instructor card"

    $oldSubtitle = '"Crie, edite e solicite a publica\u00e7\u00e3o dos seus cursos com triagem automatizada e revis\u00e3o humana por exce\u00e7\u00e3o.";'
    $newSubtitle = '"Crie cursos, organize m\u00f3dulos e aulas e solicite a publica\u00e7\u00e3o com triagem automatizada e revis\u00e3o humana por exce\u00e7\u00e3o.";'
    $instructorUi = Replace-ExactlyOnce `
        -Content $instructorUi `
        -Old $oldSubtitle `
        -New $newSubtitle `
        -Label "course header copy"

    Write-Utf8File $instructorUiPath $instructorUi
    Write-Host "COURSE_INSTRUCTOR_CONTENT_ACTION_PATCH=APPLIED"
}

if ($panel.Contains('js/course-content-api-v1_2.js') -and $panel.Contains('js/course-content-ui-v1_2.js')) {
    Write-Host "COURSE_CONTENT_SCRIPTS_PATCH=ALREADY_APPLIED"
} else {
    $oldScripts = @'
    <script src="js/course-hybrid-moderation-api-v1_2.js"></script>
<script type="module" src="js/course-instructor-ui-v1_2.js"></script>
'@
    $newScripts = @'
    <script src="js/course-hybrid-moderation-api-v1_2.js"></script>
    <script src="js/course-content-api-v1_2.js"></script>
    <script src="js/course-content-ui-v1_2.js"></script>
<script type="module" src="js/course-instructor-ui-v1_2.js"></script>
'@
    $panel = Replace-ExactlyOnce `
        -Content $panel `
        -Old $oldScripts `
        -New $newScripts `
        -Label "course content script wiring"
    Write-Utf8File $panelPath $panel
    Write-Host "COURSE_CONTENT_SCRIPTS_PATCH=APPLIED"
}

if ($adminUiTest.Contains('["edit", "content", "review", "archive"]') -and $adminUiTest.Contains('Crie cursos, organize m')) {
    Write-Host "COURSE_ADMIN_UI_TEST_PATCH=ALREADY_APPLIED"
} else {
    $adminUiTest = Replace-ExactlyOnce `
        -Content $adminUiTest `
        -Old '["edit", "review", "archive"]' `
        -New '["edit", "content", "review", "archive"]' `
        -Label "admin UI draft action expectation"

    $adminUiTest = Replace-ExactlyOnce `
        -Content $adminUiTest `
        -Old 'assert.match(uiSource, /Crie, edite e solicite a publica\\u00e7\\u00e3o dos seus cursos/);' `
        -New 'assert.match(uiSource, /Crie cursos, organize m\\u00f3dulos e aulas e solicite a publica\\u00e7\\u00e3o/);' `
        -Label "admin UI hybrid copy expectation"

    Write-Utf8File $adminUiTestPath $adminUiTest
    Write-Host "COURSE_ADMIN_UI_TEST_PATCH=APPLIED"
}

& git -C $RepoRoot diff --check
if ($LASTEXITCODE -ne 0) {
    throw "git diff --check falhou após o patch."
}

Write-Host "MARCO4A5B_COURSE_CONTENT_UI_PATCH=OK"

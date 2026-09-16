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
        throw "Marco 4A.4c: marcador ausente: $Description"
    }
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Marco 4A.4c: nao foi possivel identificar a branch Git."
}

if ($branch -ne "feature/marco4a4c-moderation-ui") {
    throw "Marco 4A.4c: execucao bloqueada na branch '$branch'. Use feature/marco4a4c-moderation-ui."
}

$panelPath = Join-Path $RepoRoot "painel_admin.html"
if (-not (Test-Path $panelPath)) {
    throw "Marco 4A.4c: painel_admin.html nao encontrado."
}

$content = Get-Content -Raw -Encoding UTF8 $panelPath
$content = $content.Replace("`r`n", "`n")

$moduleMarker = '    <script type="module">'
Assert-Contains $content $moduleMarker "script module principal"

if (-not $content.Contains('js/firebase-runtime-v1_2.js')) {
    $content = $content.Replace(
        $moduleMarker,
        "    <script src=`"js/firebase-runtime-v1_2.js`"></script>`n    <script src=`"js/course-admin-api-v1_2.js`"></script>`n$moduleMarker"
    )
}

if ($content.Contains('const firebaseConfig = {')) {
    $firebasePattern = '(?s)\s*const firebaseConfig = \{.*?\};\s*const app = initializeApp\(firebaseConfig\);\s*const auth = getAuth\(app\);\s*const db = getFirestore\(app\);'
    $firebaseReplacement = @'

        const firebaseConfig = await window.BjjExamsFirebaseRuntime.loadConfig({
            hostname: window.location.hostname
        });
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        window.__BJJ_EXAMS_AUTH__ = auth;
'@
    $firebaseReplacement = $firebaseReplacement.Replace("`r`n", "`n")
    $content = [regex]::Replace($content, $firebasePattern, $firebaseReplacement, 1)
}
elseif (-not $content.Contains('window.__BJJ_EXAMS_AUTH__ = auth;')) {
    $dbMarker = '        const db = getFirestore(app);'
    Assert-Contains $content $dbMarker "inicializacao Firestore"
    $content = $content.Replace(
        $dbMarker,
        "$dbMarker`n        window.__BJJ_EXAMS_AUTH__ = auth;"
    )
}

if (-not $content.Contains("mudarAba(event, 'cursos')")) {
    $navPattern = '(?m)^(\s*)<button onclick="mudarAba\(event, ''acompanhamento''\)"'
    $navButton = @'
            <button onclick="mudarAba(event, 'cursos')" class="nav-item flex items-center gap-3 px-6 py-3.5 text-slate-400 hover:text-white transition-all text-sm font-bold w-full text-left">
                <svg viewBox="0 0 24 24" class="svg-icon"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm0-4H9V5h10v2zm-4 8H9v-2h6v2z"/></svg> Modera&#231;&#227;o de Cursos
            </button>
'@
    $navButton = $navButton.Replace("`r`n", "`n")
    $content = [regex]::Replace(
        $content,
        $navPattern,
        ($navButton + '$1<button onclick="mudarAba(event, ''acompanhamento'')"'),
        1
    )
}

if (-not $content.Contains('id="course-moderation-list-v12"')) {
    $courseTabMarker = '                <div id="acompanhamento" class="tab-content">'
    Assert-Contains $content $courseTabMarker "aba de exames"

    $courseTab = @'
                <div id="cursos" class="tab-content">
                    <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-5 mb-8 border-b border-slate-800 pb-5">
                        <div>
                            <h2 class="text-2xl font-black text-white uppercase tracking-wide">Modera&#231;&#227;o de Cursos</h2>
                            <p class="text-sm text-slate-400 mt-1">Revise cursos enviados por instrutores e controle publica&#231;&#227;o, suspens&#227;o e arquivamento.</p>
                            <span id="course-moderation-env-badge-v12" class="inline-flex mt-3 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[9px] font-black uppercase tracking-widest">Ambiente controlado v1.2</span>
                        </div>
                        <button type="button" onclick="window.BjjExamsCourseModerationUi.loadCourses()" class="btn-primary px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg hover:scale-105 transition-all">Atualizar fila</button>
                    </div>

                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div class="bg-cardbg border border-slate-700 rounded-2xl p-4"><p class="text-[9px] uppercase tracking-widest text-slate-500 font-black">Total</p><p id="course-moderation-count-total" class="text-2xl font-black text-white mt-1">0</p></div>
                        <div class="bg-cardbg border border-amber-500/20 rounded-2xl p-4"><p class="text-[9px] uppercase tracking-widest text-amber-400 font-black">Em revis&#227;o</p><p id="course-moderation-count-review" class="text-2xl font-black text-amber-300 mt-1">0</p></div>
                        <div class="bg-cardbg border border-emerald-500/20 rounded-2xl p-4"><p class="text-[9px] uppercase tracking-widest text-emerald-400 font-black">Publicados</p><p id="course-moderation-count-published" class="text-2xl font-black text-emerald-300 mt-1">0</p></div>
                        <div class="bg-cardbg border border-rose-500/20 rounded-2xl p-4"><p class="text-[9px] uppercase tracking-widest text-rose-400 font-black">Suspensos</p><p id="course-moderation-count-suspended" class="text-2xl font-black text-rose-300 mt-1">0</p></div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 mb-6">
                        <select id="course-moderation-filter-v12" class="w-full p-3 text-sm bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">
                            <option value="all">Todos os status</option>
                            <option value="review">Em revis&#227;o</option>
                            <option value="draft">Rascunhos</option>
                            <option value="published">Publicados</option>
                            <option value="suspended">Suspensos</option>
                            <option value="archived">Arquivados</option>
                        </select>
                        <input id="course-moderation-search-v12" type="search" placeholder="Buscar por curso, descri&#231;&#227;o, propriet&#225;rio ou ID..." class="w-full p-3 text-sm bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">
                    </div>

                    <div id="course-moderation-list-v12" class="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-5">
                        <p class="col-span-full text-center py-10 text-slate-500">Abra esta aba para carregar a fila de modera&#231;&#227;o.</p>
                    </div>
                </div>

'@
    $courseTab = $courseTab.Replace("`r`n", "`n")
    $content = $content.Replace($courseTabMarker, $courseTab + $courseTabMarker)
}

if (-not $content.Contains("if(tabName === 'cursos') window.BjjExamsCourseModerationUi.loadCourses();")) {
    $handlerMarker = "            if(tabName === 'usuarios') carregarUsuarios();"
    Assert-Contains $content $handlerMarker "handler da aba usuarios"
    $content = $content.Replace(
        $handlerMarker,
        "$handlerMarker`n            if(tabName === 'cursos') window.BjjExamsCourseModerationUi.loadCourses();"
    )
}

if (-not $content.Contains('js/course-moderation-ui-v1_2.js') -and -not $content.Contains('js/course-exception-review-ui-v1_2.js')) {
    $bodyMarker = '</body>'
    Assert-Contains $content $bodyMarker "fechamento body"
    $content = $content.Replace(
        $bodyMarker,
        "    <script src=`"js/course-moderation-ui-v1_2.js`"></script>`n</body>"
    )
}

# Upgrade 4A.4c: a moderação manual de todos os cursos vira revisão humana por exceção.
$content = $content.Replace('Modera&#231;&#227;o de Cursos', 'Revis&#227;o de Conte&#250;do')
$content = $content.Replace(
    'Revise cursos enviados por instrutores e controle publica&#231;&#227;o, suspens&#227;o e arquivamento.',
    'Analise somente exce&#231;&#245;es da triagem automatizada, conte&#250;dos suspensos e casos que exigem decis&#227;o humana.'
)
$content = $content.Replace('Ambiente controlado v1.2', 'Fila de exce&#231;&#245;es v1.2')
$content = $content.Replace('>Total</p><p id="course-moderation-count-total"', '>Exce&#231;&#245;es</p><p id="course-moderation-count-total"')
$content = $content.Replace('>Em revis&#227;o</p><p id="course-moderation-count-review"', '>Revis&#227;o humana</p><p id="course-moderation-count-review"')
$content = $content.Replace('>Publicados</p><p id="course-moderation-count-published"', '>Bloqueados</p><p id="course-moderation-count-published"')
$content = $content.Replace('<option value="all">Todos os status</option>', '<option value="all">Todas as exce&#231;&#245;es</option>')
$content = $content.Replace('<option value="review">Em revis&#227;o</option>', '<option value="review">Revis&#227;o humana</option>')
$content = $content.Replace('<option value="draft">Rascunhos</option>', '<option value="blocked">Bloqueados</option>')
$content = $content.Replace("`n                            <option value=`"published`">Publicados</option>", '')
$content = $content.Replace("`n                            <option value=`"archived`">Arquivados</option>", '')
$content = $content.Replace(
    'placeholder="Buscar por curso, descri&#231;&#227;o, propriet&#225;rio ou ID..."',
    'placeholder="Buscar por curso, motivo, propriet&#225;rio ou ID..."'
)
$content = $content.Replace(
    'Abra esta aba para carregar a fila de modera&#231;&#227;o.',
    'Abra esta aba para carregar a fila de exce&#231;&#245;es.'
)

$legacyScript = '    <script src="js/course-moderation-ui-v1_2.js"></script>'
$hybridScripts = "    <script src=`"js/course-hybrid-moderation-api-v1_2.js`"></script>`n    <script src=`"js/course-exception-review-ui-v1_2.js`"></script>"
if ($content.Contains($legacyScript)) {
    $content = $content.Replace($legacyScript, $hybridScripts)
}
elseif (-not $content.Contains('js/course-exception-review-ui-v1_2.js')) {
    $content = $content.Replace('</body>', "$hybridScripts`n</body>")
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($panelPath, $content, $utf8NoBom)

$verify = Get-Content -Raw -Encoding UTF8 $panelPath
$verify = $verify.Replace("`r`n", "`n")

$checks = [ordered]@{
    RUNTIME_CONFIG = $verify.Contains('js/firebase-runtime-v1_2.js')
    RUNTIME_LOADER = $verify.Contains('await window.BjjExamsFirebaseRuntime.loadConfig')
    AUTH_BRIDGE = $verify.Contains('window.__BJJ_EXAMS_AUTH__ = auth;')
    ADMIN_API_SCRIPT = $verify.Contains('js/course-admin-api-v1_2.js')
    HYBRID_API_SCRIPT = $verify.Contains('js/course-hybrid-moderation-api-v1_2.js')
    EXCEPTION_UI_SCRIPT = $verify.Contains('js/course-exception-review-ui-v1_2.js')
    REVIEW_NAV = $verify.Contains('Revis&#227;o de Conte&#250;do')
    REVIEW_TAB = $verify.Contains('id="course-moderation-list-v12"')
    MODERATION_HANDLER = $verify.Contains("if(tabName === 'cursos') window.BjjExamsCourseModerationUi.loadCourses();")
    HARDCODED_PRODUCTION_INIT_REMOVED = -not $verify.Contains('const firebaseConfig = {')
    LEGACY_MODERATION_SCRIPT_REMOVED = -not $verify.Contains('js/course-moderation-ui-v1_2.js')
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
foreach ($item in $checks.GetEnumerator()) {
    Write-Host "$($item.Key)=$($item.Value)"
}

if ($failed.Count -gt 0) {
    throw "Marco 4A.4c: validacao pos-patch falhou."
}

Write-Host "MARCO4A4C_EXCEPTION_REVIEW_PATCH=OK"
Write-Host "LOCALHOST_PRODUCTION_CONFIG=AUTO_BLOCKED"
Write-Host "PRODUCTION_DEPLOY=NOT_RUN"

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"
$ExpectedBranch = "feature/marco4a4c-moderation-ui"

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $ExpectedBranch) {
    throw "Marco 4A.4c: execucao bloqueada na branch '$branch'. Use $ExpectedBranch."
}

$uiPath = Join-Path $RepoRoot "js\course-instructor-ui-v1_2.js"
$panelPath = Join-Path $RepoRoot "painel_professor.html"
if (-not (Test-Path $uiPath) -or -not (Test-Path $panelPath)) {
    throw "Marco 4A.4c: arquivos do painel do instrutor nao encontrados."
}

$ui = Get-Content -Raw -Encoding UTF8 $uiPath
$ui = $ui.Replace("`r`n", "`n")

# IMPORTANT: this patch file intentionally stays ASCII-only. Windows PowerShell 5.1
# may decode UTF-8-without-BOM scripts as an ANSI code page. JavaScript \u escapes
# keep the generated browser copy correct regardless of the shell code page.

$ui = [regex]::Replace(
    $ui,
    '(?s)(subtitle\.textContent\s*=\s*)"[^"]*";',
    '$1"Crie, edite e solicite a publica\u00e7\u00e3o dos seus cursos com triagem automatizada e revis\u00e3o humana por exce\u00e7\u00e3o.";',
    1
)

$ui = [regex]::Replace(
    $ui,
    '"Crie seu primeiro rascunho\.[^"]*"',
    '"Crie seu primeiro rascunho. Ao solicitar publica\u00e7\u00e3o, voc\u00ea aceitar\u00e1 o Termo de Responsabilidade e o curso passar\u00e1 por triagem automatizada."',
    1
)

$ui = [regex]::Replace(
    $ui,
    'actionButton\("[^"]*",\s*"paper-plane-tilt",\s*"primary",\s*\(\)\s*=>\s*submitForReview\(course\.id\)\)',
    'actionButton("Solicitar publica\u00e7\u00e3o", "paper-plane-tilt", "primary", () => submitForReview(course.id))',
    1
)

$ui = [regex]::Replace(
    $ui,
    'Para (?:enviar|solicitar)[^\"]*20 caracteres\.',
    'Para solicitar publica\u00e7\u00e3o, a descri\u00e7\u00e3o precisa ter pelo menos 20 caracteres.',
    1
)

$ui = [regex]::Replace(
    $ui,
    '<p class="text-xs text-slate-300">O curso[^<]*<strong>rascunho</strong>.*?</p>',
    '<p class="text-xs text-slate-300">O curso ser\u00e1 salvo em <strong>rascunho</strong>. A publica\u00e7\u00e3o \u00e9 solicitada pelo instrutor, passa por triagem automatizada e s\u00f3 vai para revis\u00e3o humana quando houver exce\u00e7\u00e3o.</p>',
    1
)

$submitPattern = '(?s)  async function submitForReview\(courseId\) \{.*?\n  \}\n\n  async function archiveCourse'
$submitReplacement = @'
  async function submitForReview(courseId) {
    const course = findCourse(courseId);
    if (!course) return;

    if ((course.description || "").trim().length < 20) {
      return showOperationError(
        new Error("Complete a descri\u00e7\u00e3o do curso antes de solicitar publica\u00e7\u00e3o.")
      );
    }

    const hybridApi = root.BjjExamsCourseHybridModeration;
    if (!hybridApi) {
      return showOperationError(
        new Error("Servi\u00e7o de triagem de publica\u00e7\u00e3o indispon\u00edvel.")
      );
    }

    const confirmation = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "info",
      title: "Solicitar publica\u00e7\u00e3o",
      html: `
        <div class="text-left space-y-4 mt-2">
          <p class="text-sm text-slate-300 leading-relaxed">
            O curso ser\u00e1 submetido \u00e0 triagem automatizada de conformidade da plataforma. A an\u00e1lise n\u00e3o avalia a qualidade t\u00e9cnica do jiu-jitsu.
          </p>
          <label class="flex items-start gap-3 p-4 rounded-xl border border-slate-700 bg-slate-900/70 cursor-pointer">
            <input id="course-v12-responsibility" type="checkbox" class="mt-1 w-4 h-4 accent-cyan-400">
            <span class="text-sm text-slate-300 leading-relaxed">
              Declaro que sou respons\u00e1vel pelo conte\u00fado enviado, que possuo autoriza\u00e7\u00e3o para public\u00e1-lo e que ele respeita as regras da plataforma. Estou ciente de que o curso pode ser suspenso ou encaminhado para revis\u00e3o humana em caso de sinaliza\u00e7\u00e3o ou den\u00fancia.
            </span>
          </label>
          <p class="text-[10px] text-slate-500 uppercase tracking-widest">
            Termo: ${hybridApi.RESPONSIBILITY_TERMS_VERSION}
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: "Aceitar e solicitar publica\u00e7\u00e3o",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      preConfirm: () => {
        const accepted = document.getElementById("course-v12-responsibility")?.checked === true;
        if (!accepted) {
          root.Swal.showValidationMessage("\u00c9 necess\u00e1rio aceitar o Termo de Responsabilidade para continuar.");
          return false;
        }
        return true;
      }
    });

    if (!confirmation.isConfirmed) return;

    try {
      root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        title: "Analisando conte\u00fado...",
        text: "Aguarde enquanto a triagem de conformidade \u00e9 processada.",
        allowOutsideClick: false,
        didOpen: () => root.Swal.showLoading()
      });

      const options = await callableOptions();
      const result = await hybridApi.submitForPublication(courseId, {
        ...options,
        responsibilityAccepted: true,
        termsVersion: hybridApi.RESPONSIBILITY_TERMS_VERSION
      });

      const status = String(result?.course?.status || "");
      const moderation = result?.moderation || result?.course?.moderation || {};
      let title = "Solicita\u00e7\u00e3o processada";
      let text = "O curso foi encaminhado para revis\u00e3o humana.";
      let icon = "info";

      if (status === "published") {
        title = "Curso publicado";
        text = "A triagem autom\u00e1tica aprovou o conte\u00fado e o curso foi publicado.";
        icon = "success";
      } else if (status === "draft") {
        title = "Ajustes necess\u00e1rios";
        text = moderation.summary || "A triagem identificou ajustes objetivos. Corrija o conte\u00fado e solicite a publica\u00e7\u00e3o novamente.";
        icon = "warning";
      } else if (moderation.status === "blocked") {
        title = "Revis\u00e3o humana necess\u00e1ria";
        text = moderation.summary || "O conte\u00fado foi sinalizado e permanecer\u00e1 fora do cat\u00e1logo at\u00e9 an\u00e1lise administrativa.";
        icon = "warning";
      } else {
        text = moderation.summary || "A triagem encaminhou este curso para revis\u00e3o humana por exce\u00e7\u00e3o.";
      }

      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon,
        title,
        text,
        confirmButtonColor: "var(--brand-color)"
      });
      await loadCourses();
    } catch (error) {
      await showOperationError(error);
    }
  }

  async function archiveCourse
'@
$submitReplacement = $submitReplacement.Replace("`r`n", "`n")
$updatedUi = [regex]::Replace($ui, $submitPattern, $submitReplacement, 1)
if ($updatedUi -eq $ui -and -not $ui.Contains('submitForPublication(courseId')) {
    throw "Marco 4A.4c: nao foi possivel atualizar o fluxo de solicitacao de publicacao."
}
$ui = $updatedUi

$panel = Get-Content -Raw -Encoding UTF8 $panelPath
$panel = $panel.Replace("`r`n", "`n")
if (-not $panel.Contains('js/course-hybrid-moderation-api-v1_2.js')) {
    $markers = @(
        '<script type="module" src="js/course-instructor-ui-v1_2.js"></script>',
        '<script src="js/course-instructor-ui-v1_2.js"></script>'
    )
    $marker = $markers | Where-Object { $panel.Contains($_) } | Select-Object -First 1
    if (-not $marker) {
        throw "Marco 4A.4c: marcador do controller do instrutor nao encontrado."
    }
    $panel = $panel.Replace(
        $marker,
        "<script src=`"js/course-hybrid-moderation-api-v1_2.js`"></script>`n$marker"
    )
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($uiPath, $ui, $utf8NoBom)
[System.IO.File]::WriteAllText($panelPath, $panel, $utf8NoBom)

$verifyUi = Get-Content -Raw -Encoding UTF8 $uiPath
$verifyPanel = Get-Content -Raw -Encoding UTF8 $panelPath
$checks = [ordered]@{
    HYBRID_API_SCRIPT = $verifyPanel.Contains('js/course-hybrid-moderation-api-v1_2.js')
    RESPONSIBILITY_ACCEPTANCE = $verifyUi.Contains('course-v12-responsibility')
    RESPONSIBILITY_VERSION = $verifyUi.Contains('RESPONSIBILITY_TERMS_VERSION')
    HYBRID_SUBMISSION = $verifyUi.Contains('submitForPublication(courseId')
    PUBLISH_REQUEST_COPY = $verifyUi.Contains('Solicitar publica\u00e7\u00e3o')
    PUBLISH_REQUEST_SUBTITLE = $verifyUi.Contains('Crie, edite e solicite a publica\u00e7\u00e3o dos seus cursos com triagem automatizada e revis\u00e3o humana por exce\u00e7\u00e3o.')
    PUBLISH_REQUEST_ACTION = $verifyUi.Contains('actionButton("Solicitar publica\u00e7\u00e3o", "paper-plane-tilt", "primary", () => submitForReview(course.id))')
    OLD_REVIEW_SUBTITLE_REMOVED = -not $verifyUi.Contains('Crie, edite e envie seus cursos para revis')
    OLD_REVIEW_ACTION_REMOVED = -not $verifyUi.Contains('actionButton("Enviar para revis')
    ENCODING_SAFE_COPY = -not ($verifyUi.Contains(([char]0x00C3).ToString() + [char]0x00A7) -or $verifyUi.Contains(([char]0x00C3).ToString() + [char]0x00A3) -or $verifyUi.Contains(([char]0x00C3).ToString() + [char]0x00A9))
}

foreach ($item in $checks.GetEnumerator()) {
    Write-Host "$($item.Key)=$($item.Value)"
}
if (@($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count -gt 0) {
    throw "Marco 4A.4c: validacao pos-patch do instrutor falhou."
}

Write-Host "MARCO4A4C_INSTRUCTOR_HYBRID_PATCH=OK"
Write-Host "PRODUCTION_DEPLOY=NOT_RUN"
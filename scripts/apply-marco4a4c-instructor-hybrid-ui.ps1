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

$ui = $ui.Replace(
    'Crie, edite e envie seus cursos para revisão usando a arquitetura v1.2.',
    'Crie, edite e solicite a publicação dos seus cursos com triagem automatizada e revisão humana por exceção.'
)
$ui = $ui.Replace(
    'Crie seu primeiro rascunho. A publicação pública exigirá revisão da plataforma.',
    'Crie seu primeiro rascunho. Ao solicitar publicação, você aceitará o Termo de Responsabilidade e o curso passará por triagem automatizada.'
)
$ui = $ui.Replace(
    'actionButton("Enviar para revisão", "paper-plane-tilt", "primary", () => submitForReview(course.id))',
    'actionButton("Solicitar publicação", "paper-plane-tilt", "primary", () => submitForReview(course.id))'
)
$ui = $ui.Replace(
    'Para enviar à revisão, a descrição precisa ter pelo menos 20 caracteres.',
    'Para solicitar publicação, a descrição precisa ter pelo menos 20 caracteres.'
)
$ui = $ui.Replace(
    'O curso será salvo em <strong>rascunho</strong>. O instrutor não publica diretamente; a publicação depende da moderação.',
    'O curso será salvo em <strong>rascunho</strong>. A publicação é solicitada pelo instrutor, passa por triagem automatizada e só vai para revisão humana quando houver exceção.'
)

$submitPattern = '(?s)  async function submitForReview\(courseId\) \{.*?\n  \}\n\n  async function archiveCourse'
$submitReplacement = @'
  async function submitForReview(courseId) {
    const course = findCourse(courseId);
    if (!course) return;

    if ((course.description || "").trim().length < 20) {
      return showOperationError(
        new Error("Complete a descrição do curso antes de solicitar publicação.")
      );
    }

    const hybridApi = root.BjjExamsCourseHybridModeration;
    if (!hybridApi) {
      return showOperationError(
        new Error("Serviço de triagem de publicação indisponível.")
      );
    }

    const confirmation = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "info",
      title: "Solicitar publicação",
      html: `
        <div class="text-left space-y-4 mt-2">
          <p class="text-sm text-slate-300 leading-relaxed">
            O curso será submetido à triagem automatizada de conformidade da plataforma. A análise não avalia a qualidade técnica do jiu-jitsu.
          </p>
          <label class="flex items-start gap-3 p-4 rounded-xl border border-slate-700 bg-slate-900/70 cursor-pointer">
            <input id="course-v12-responsibility" type="checkbox" class="mt-1 w-4 h-4 accent-cyan-400">
            <span class="text-sm text-slate-300 leading-relaxed">
              Declaro que sou responsável pelo conteúdo enviado, que possuo autorização para publicá-lo e que ele respeita as regras da plataforma. Estou ciente de que o curso pode ser suspenso ou encaminhado para revisão humana em caso de sinalização ou denúncia.
            </span>
          </label>
          <p class="text-[10px] text-slate-500 uppercase tracking-widest">
            Termo: ${hybridApi.RESPONSIBILITY_TERMS_VERSION}
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: "Aceitar e solicitar publicação",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      preConfirm: () => {
        const accepted = document.getElementById("course-v12-responsibility")?.checked === true;
        if (!accepted) {
          root.Swal.showValidationMessage("É necessário aceitar o Termo de Responsabilidade para continuar.");
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
        title: "Analisando conteúdo...",
        text: "Aguarde enquanto a triagem de conformidade é processada.",
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
      let title = "Solicitação processada";
      let text = "O curso foi encaminhado para revisão humana.";
      let icon = "info";

      if (status === "published") {
        title = "Curso publicado";
        text = "A triagem automática aprovou o conteúdo e o curso foi publicado.";
        icon = "success";
      } else if (status === "draft") {
        title = "Ajustes necessários";
        text = moderation.summary || "A triagem identificou ajustes objetivos. Corrija o conteúdo e solicite a publicação novamente.";
        icon = "warning";
      } else if (moderation.status === "blocked") {
        title = "Revisão humana necessária";
        text = moderation.summary || "O conteúdo foi sinalizado e permanecerá fora do catálogo até análise administrativa.";
        icon = "warning";
      } else {
        text = moderation.summary || "A triagem encaminhou este curso para revisão humana por exceção.";
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
if ($updatedUi -eq $ui -and -not $ui.Contains('Aceitar e solicitar publicação')) {
    throw "Marco 4A.4c: nao foi possivel atualizar o fluxo de solicitacao de publicacao."
}
$ui = $updatedUi

$panel = Get-Content -Raw -Encoding UTF8 $panelPath
$panel = $panel.Replace("`r`n", "`n")
if (-not $panel.Contains('js/course-hybrid-moderation-api-v1_2.js')) {
    $marker = '<script src="js/course-instructor-ui-v1_2.js"></script>'
    if (-not $panel.Contains($marker)) {
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
    PUBLISH_REQUEST_COPY = $verifyUi.Contains('Solicitar publicação')
    OLD_MANUAL_REVIEW_COPY_REMOVED = -not $verifyUi.Contains('A publicação continuará sob responsabilidade da moderação da plataforma.')
}

foreach ($item in $checks.GetEnumerator()) {
    Write-Host "$($item.Key)=$($item.Value)"
}
if (@($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count -gt 0) {
    throw "Marco 4A.4c: validacao pos-patch do instrutor falhou."
}

Write-Host "MARCO4A4C_INSTRUCTOR_HYBRID_PATCH=OK"
Write-Host "PRODUCTION_DEPLOY=NOT_RUN"

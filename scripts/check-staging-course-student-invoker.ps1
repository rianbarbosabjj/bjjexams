param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$ProjectId = "bjj-exams-staging",
    [string]$Region = "southamerica-east1"
)

$ErrorActionPreference = "Stop"

$ExpectedProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$AllowedBranch = "feature/marco4b4-student-course-ui"

if ($ProjectId -eq $ProductionProject) {
    throw "Execução bloqueada: produção não pode ser consultada por este precheck."
}

if ($ProjectId -ne $ExpectedProject) {
    throw "Execução bloqueada: esperado projeto '$ExpectedProject', recebido '$ProjectId'."
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível identificar a branch Git."
}

if ($branch -ne $AllowedBranch) {
    throw "Execução bloqueada na branch '$branch'. Esperado: $AllowedBranch."
}

$coreFunctions = @(
    "listarMeusCursosV12",
    "obterEstruturaConsumoCursoV12",
    "obterAulaConsumoCursoV12",
    "obterProgressoCursoV12",
    "concluirAulaCursoV12"
)

$auxiliaryFunctions = @(
    "matricularCursoGratuitoV12",
    "obterEntitlementCursoV12"
)

function Invoke-GcloudText {
    param([string[]]$Arguments)

    $output = & gcloud @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "gcloud falhou (exit $exitCode): $($output -join ' ')"
    }
    return ($output -join "`n").Trim()
}

function Get-RunInvokerState {
    param(
        [string]$FunctionName,
        [string]$Group
    )

    $service = Invoke-GcloudText @(
        "functions", "describe", $FunctionName,
        "--region=$Region",
        "--project=$ProjectId",
        "--format=value(serviceConfig.service)"
    )

    if (-not $service) {
        throw "Function '$FunctionName' não retornou serviceConfig.service."
    }

    if ($service -match "projects/$ProductionProject/") {
        throw "Produção detectada no serviço Cloud Run de '$FunctionName'."
    }

    $iamJson = Invoke-GcloudText @(
        "run", "services", "get-iam-policy", $service,
        "--region=$Region",
        "--project=$ProjectId",
        "--format=json"
    )

    $iam = $iamJson | ConvertFrom-Json
    $publicInvoker = @(
        $iam.bindings | Where-Object {
            $_.role -eq "roles/run.invoker" -and
            $_.members -contains "allUsers"
        }
    ).Count -gt 0

    [PSCustomObject]@{
        Group = $Group
        Function = $FunctionName
        Service = $service
        PublicRunInvoker = $publicInvoker
    }
}

$results = @()
foreach ($fn in $coreFunctions) {
    $results += Get-RunInvokerState -FunctionName $fn -Group "CORE"
}
foreach ($fn in $auxiliaryFunctions) {
    $results += Get-RunInvokerState -FunctionName $fn -Group "AUXILIARY"
}

foreach ($item in $results) {
    Write-Host ""
    Write-Host "=== $($item.Group) :: $($item.Function) ==="
    Write-Host "CLOUD_RUN_SERVICE=$($item.Service)"
    Write-Host "PUBLIC_RUN_INVOKER=$($item.PublicRunInvoker)"
}

$coreOk = @($results | Where-Object { $_.Group -eq "CORE" -and -not $_.PublicRunInvoker }).Count -eq 0
$auxOk = @($results | Where-Object { $_.Group -eq "AUXILIARY" -and -not $_.PublicRunInvoker }).Count -eq 0

Write-Host ""
Write-Host "STAGING_COURSE_STUDENT_INVOKER_PRECHECK=OK"
Write-Host "TARGET_PROJECT=$ExpectedProject"
Write-Host "CORE_FUNCTIONS=$($coreFunctions.Count)"
Write-Host "CORE_PUBLIC_RUN_INVOKER_ALL=$coreOk"
Write-Host "AUXILIARY_FUNCTIONS=$($auxiliaryFunctions.Count)"
Write-Host "AUXILIARY_PUBLIC_RUN_INVOKER_ALL=$auxOk"
Write-Host "IAM_WRITES_PERFORMED=False"
Write-Host "PRODUCTION_ACCESS=NOT_RUN"

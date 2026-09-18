param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$ProjectId = "bjj-exams-staging",
    [string]$Region = "southamerica-east1"
)

$ErrorActionPreference = "Stop"

$ExpectedProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$AllowedBranch = "feature/marco5b-financial-rules-admin"

$Functions = @(
    "obterConfiguracaoFinanceiraV12",
    "atualizarTaxaPadraoFinanceiraV12",
    "configurarContaRecebedorFinanceiroV12",
    "salvarRegraFinanceiraCursoV12",
    "obterRegraFinanceiraCursoV12"
)

if ($ProjectId -eq $ProductionProject) {
    throw "Execução bloqueada: produção não pode ser consultada por este smoke."
}

if ($ProjectId -ne $ExpectedProject) {
    throw "Execução bloqueada: esperado '$ExpectedProject', recebido '$ProjectId'."
}

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne $AllowedBranch) {
    throw "Smoke permitido somente na branch '$AllowedBranch'. Branch atual='$branch'."
}

function Invoke-GcloudText {
    param([string[]]$Arguments)

    $output = & gcloud @Arguments 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw "gcloud falhou (exit $exitCode): $($output -join ' ')"
    }

    return ($output -join [Environment]::NewLine).Trim()
}

$results = @()

foreach ($fn in $Functions) {
    $descriptionJson = Invoke-GcloudText @(
        "functions", "describe", $fn,
        "--gen2",
        "--region=$Region",
        "--project=$ProjectId",
        "--format=json"
    )

    $description = $descriptionJson | ConvertFrom-Json
    $service = [string]$description.serviceConfig.service
    $uri = [string]$description.serviceConfig.uri

    if (-not $service -or -not $uri) {
        throw "Function '$fn' não retornou service/uri."
    }

    if ($service -match "projects/$ProductionProject/" -or $uri -match $ProductionProject) {
        throw "Produção detectada ao inspecionar '$fn'."
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

    $httpStatus = $null

    try {
        $response = Invoke-WebRequest -Method POST -Uri $uri -ContentType "application/json" -Body '{"data":{}}' -UseBasicParsing
        $httpStatus = [int]$response.StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            $httpStatus = [int]$_.Exception.Response.StatusCode
        }
        else {
            throw
        }
    }

    $results += [PSCustomObject]@{
        Function = $fn
        Service = $service
        Uri = $uri
        PublicRunInvoker = $publicInvoker
        AnonymousHttpStatus = $httpStatus
        AnonymousRejectedByCallable = ($httpStatus -eq 401)
    }
}

foreach ($item in $results) {
    Write-Host ""
    Write-Host "=== $($item.Function) ==="
    Write-Host "CLOUD_RUN_SERVICE=$($item.Service)"
    Write-Host "PUBLIC_RUN_INVOKER=$($item.PublicRunInvoker)"
    Write-Host "ANONYMOUS_HTTP_STATUS=$($item.AnonymousHttpStatus)"
    Write-Host "ANONYMOUS_REJECTED_BY_CALLABLE=$($item.AnonymousRejectedByCallable)"
}

$allInvoker = @(
    $results | Where-Object {
        -not $_.PublicRunInvoker
    }
).Count -eq 0

$allAnonymous401 = @(
    $results | Where-Object {
        -not $_.AnonymousRejectedByCallable
    }
).Count -eq 0

Write-Host ""
Write-Host "STAGING_FINANCIAL_ADMIN_SMOKE=OK"
Write-Host "TARGET_PROJECT=$ExpectedProject"
Write-Host "FUNCTIONS_COUNT=$($Functions.Count)"
Write-Host "PUBLIC_RUN_INVOKER_ALL=$allInvoker"
Write-Host "ANONYMOUS_401_ALL=$allAnonymous401"
Write-Host "IAM_WRITES_PERFORMED=False"
Write-Host "DATA_WRITES_EXPECTED=False"
Write-Host "PRODUCTION_ACCESS=NOT_RUN"

if (-not $allInvoker) {
    throw "Uma ou mais Functions não possuem roles/run.invoker para allUsers."
}

if (-not $allAnonymous401) {
    throw "Uma ou mais callables não rejeitaram chamada anônima com HTTP 401."
}

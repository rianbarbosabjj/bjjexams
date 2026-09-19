$ErrorActionPreference = "Stop"

$TargetProject = "bjj-exams-staging"
$ProductionProject = "bjj-exams"
$ExpectedBranch = "feature/marco5f-purchase-ui-ops"
$Region = "southamerica-east1"

$Functions = @(
    "iniciarCheckoutCursoV12",
    "obterStatusCompraCursoV12",
    "listarComprasCursosAlunoV12",
    "listarOperacoesFinanceirasCursosV12",
    "cancelarCobrancaPendenteV12",
    "solicitarEstornoIntegralV12",
    "webhookAsaasPagamentosV12",
    "processarWebhookPagamentoV12"
)

if ($TargetProject -eq $ProductionProject) {
    throw "Projeto alvo nao pode ser producao."
}

function Invoke-GCloudJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $gcloud = Get-Command gcloud.cmd -ErrorAction Stop
    $stdoutPath = [System.IO.Path]::GetTempFileName()
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $process = Start-Process `
            -FilePath $gcloud.Source `
            -ArgumentList $Arguments `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $stdout = [System.IO.File]::ReadAllText($stdoutPath).Trim()
        $stderr = [System.IO.File]::ReadAllText($stderrPath).Trim()

        if ($process.ExitCode -ne 0) {
            throw "gcloud falhou (exit $($process.ExitCode)): $($Arguments -join ' ')`nSTDERR: $stderr"
        }
        if (-not $stdout) {
            throw "gcloud nao retornou JSON para: $($Arguments -join ' ')"
        }
        return $stdout | ConvertFrom-Json
    }
    finally {
        Remove-Item $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function SecretKeys($description) {
    return @(
        $description.serviceConfig.secretEnvironmentVariables |
        ForEach-Object { [string]$_.key }
    )
}

$branch = (git branch --show-current).Trim()
if ($branch -ne $ExpectedBranch) {
    throw "Branch incorreta. Esperado: $ExpectedBranch; atual: $branch"
}

$status = @(git status --porcelain)
if ($status.Count -ne 0) {
    throw "Working tree precisa estar limpa."
}

$localHead = (git rev-parse HEAD).Trim()
$remoteHead = (git rev-parse "origin/$ExpectedBranch").Trim()
if ($localHead -ne $remoteHead) {
    throw "HEAD local diverge do remoto. Local: $localHead; remoto: $remoteHead"
}

$descriptions = @{}
foreach ($functionName in $Functions) {
    $description = Invoke-GCloudJson -Arguments @(
        "functions", "describe", $functionName,
        "--gen2",
        "--region=$Region",
        "--project=$TargetProject",
        "--format=json"
    )

    if ([string]$description.state -ne "ACTIVE") {
        throw "Funcao $functionName nao esta ACTIVE. Estado: $($description.state)"
    }

    if ([string]$description.environment -ne "GEN_2") {
        throw "Funcao $functionName nao esta em Gen 2."
    }

    $descriptions[$functionName] = $description
}

$worker = $descriptions["processarWebhookPagamentoV12"]
if ([string]$worker.eventTrigger.eventType -ne "google.cloud.firestore.document.v1.created") {
    throw "Worker nao possui trigger Firestore document created esperado."
}

$ingress = $descriptions["webhookAsaasPagamentosV12"]
$ingressUri = [string]$ingress.serviceConfig.uri
if ([string]::IsNullOrWhiteSpace($ingressUri) -or $ingressUri -notmatch "webhookasaaspagamentosv12") {
    throw "URI do ingress webhook inesperada."
}

foreach ($name in @(
    "iniciarCheckoutCursoV12",
    "obterStatusCompraCursoV12",
    "listarComprasCursosAlunoV12",
    "listarOperacoesFinanceirasCursosV12",
    "cancelarCobrancaPendenteV12",
    "solicitarEstornoIntegralV12"
)) {
    $uri = [string]$descriptions[$name].serviceConfig.uri
    if ([string]::IsNullOrWhiteSpace($uri)) {
        throw "Callable $name nao possui URI ativa."
    }
}

$workerSecrets = SecretKeys $worker
if ($workerSecrets -notcontains "ASAAS_API_KEY") {
    throw "Worker nao possui ASAAS_API_KEY vinculada."
}

$ingressSecrets = SecretKeys $ingress
if ($ingressSecrets -notcontains "ASAAS_WEBHOOK_TOKEN") {
    throw "Ingress nao possui ASAAS_WEBHOOK_TOKEN vinculado."
}

foreach ($name in @(
    "iniciarCheckoutCursoV12",
    "cancelarCobrancaPendenteV12",
    "solicitarEstornoIntegralV12"
)) {
    $keys = SecretKeys $descriptions[$name]
    if ($keys -notcontains "ASAAS_API_KEY") {
        throw "Callable $name nao possui ASAAS_API_KEY vinculada."
    }
}

foreach ($name in @(
    "obterStatusCompraCursoV12",
    "listarComprasCursosAlunoV12",
    "listarOperacoesFinanceirasCursosV12"
)) {
    $keys = SecretKeys $descriptions[$name]
    if ($keys.Count -ne 0) {
        throw "Read model $name nao deve vincular secrets do provedor."
    }
}

Write-Output "MARCO5F_STAGING_DEPLOY_VERIFY=OK"
Write-Output "TARGET_PROJECT=$TargetProject"
Write-Output "PRODUCTION_ACCESS=NOT_RUN"
Write-Output "REGION=$Region"
Write-Output "FUNCTIONS_ACTIVE=8/8"
Write-Output "CHECKOUT_CALLABLE_STATE=ACTIVE"
Write-Output "STUDENT_STATUS_CALLABLE_STATE=ACTIVE"
Write-Output "STUDENT_HISTORY_CALLABLE_STATE=ACTIVE"
Write-Output "ADMIN_READ_CALLABLE_STATE=ACTIVE"
Write-Output "CANCEL_CALLABLE_STATE=ACTIVE"
Write-Output "REFUND_CALLABLE_STATE=ACTIVE"
Write-Output "INGRESS_STATE=ACTIVE"
Write-Output "INGRESS_URI=$ingressUri"
Write-Output "WORKER_STATE=ACTIVE"
Write-Output "WORKER_TRIGGER=google.cloud.firestore.document.v1.created"
Write-Output "ASAAS_API_SECRET_BOUND=True"
Write-Output "ASAAS_WEBHOOK_SECRET_BOUND=True"
Write-Output "PURCHASE_READ_PROVIDER_SECRETS_BOUND=False"
Write-Output "SECRET_VALUE_PRINTED=False"
Write-Output "REMOTE_READ_ONLY=True"
Write-Output "STAGING_WRITE_PERFORMED=False"

[CmdletBinding()]
param(
    [ValidateSet("Install", "Check", "Login", "Run", "DebugLogin", "DebugRun")]
    [string]$Mode = "Run"
)

$ErrorActionPreference = "Stop"
$Project = "bjj-exams-staging"
$Branch = "feature/marco9-admin-appcheck-enforcement-prep"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Browser = Join-Path $PSScriptRoot "runner.cjs"
$Test = Join-Path $Root "tests\marco9-appcheck-browser-automation-v1_2.test.js"

try {
    $Top = (& git -C $Root rev-parse --show-toplevel)
    if ($LASTEXITCODE -ne 0 -or -not $Top) {
        throw "NOT_GIT_WORKTREE"
    }

    if (([IO.Path]::GetFullPath(([string]$Top).Trim())).TrimEnd('\') -ine
        ([IO.Path]::GetFullPath($Root)).TrimEnd('\')) {
        throw "WORKTREE_ROOT_MISMATCH"
    }

    $Pending = @(& git -C $Root status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $Pending.Count -ne 0) {
        throw "WORKTREE_NOT_CLEAN"
    }

    $Remote = & git -C $Root ls-remote --exit-code origin "refs/heads/$Branch"
    if ($LASTEXITCODE -ne 0 -or -not $Remote) {
        throw "PR_BRANCH_NOT_ACCESSIBLE"
    }
    $RemoteSha = (([string]($Remote | Select-Object -First 1)) -split '\s+')[0]
    $LocalSha = ([string](& git -C $Root rev-parse HEAD)).Trim()
    if ($LASTEXITCODE -ne 0 -or $LocalSha -cne $RemoteSha) {
        throw "WORKTREE_NOT_AT_CURRENT_PR_HEAD"
    }

    Write-Host "STAGING_PROJECT=$Project"
    Write-Host "PR_HEAD_MATCH=PASS"
    Write-Host "WORKTREE_CLEAN=PASS"

    if ($Mode -eq "Install") {
        # Windows PowerShell 5.1 can mis-handle npm --prefix with spaces.
        # Run npm.cmd from the exact directory containing package.json.
        $Manifest = Join-Path $PSScriptRoot "package.json"
        if (-not (Test-Path -LiteralPath $Manifest -PathType Leaf)) {
            throw "PLAYWRIGHT_PACKAGE_MANIFEST_NOT_FOUND"
        }
        Push-Location -LiteralPath $PSScriptRoot
        try {
            & npm.cmd install --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "NPM_INSTALL_FAILED" }
        }
        finally {
            Pop-Location
        }
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules\playwright-core") -PathType Container)) {
            throw "PLAYWRIGHT_INSTALL_VERIFICATION_FAILED"
        }
        Write-Host "PLAYWRIGHT_CORE_INSTALL=PASS"
    }
    elseif ($Mode -eq "Check") {
        & node --check $Browser
        if ($LASTEXITCODE -ne 0) { throw "BROWSER_SYNTAX_ERROR" }
        & node $Test
        if ($LASTEXITCODE -ne 0) { throw "OFFLINE_CONTRACT_FAILED" }
        Write-Host "MARCO9_BROWSER_OFFLINE_CHECK=PASS"
    }
    else {
        if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\playwright-core"))) {
            throw "PLAYWRIGHT_NOT_INSTALLED_RUN_INSTALL_FIRST"
        }
        $IsDebug = ($Mode -eq "DebugLogin" -or $Mode -eq "DebugRun")
        $Flag = switch ($Mode) {
            "Login" { "--login" }
            "Run" { "--run" }
            "DebugLogin" { "--debug-login" }
            "DebugRun" { "--debug-run" }
        }

        if ($IsDebug) {
            if (Test-Path Env:\BJJ_EXAMS_M9_DEBUG_TOKEN) {
                throw "DEBUG_TOKEN_ENV_ALREADY_PRESENT"
            }
            $Secure = $null
            $Plain = $null
            $Ptr = [IntPtr]::Zero
            try {
                Write-Host "STAGING_DEBUG_TOKEN_PROMPT=PRIVATE"
                $Secure = Read-Host "Cole o token de depuracao STAGING (oculto)" -AsSecureString
                $Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
                $Plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr)
                if ($Plain -cnotmatch '^[A-Za-z0-9_-]{20,160}
    }

    Write-Host "DEPLOY=NONE"
    Write-Host "MERGE=NONE"
    Write-Host "MARCO9=NO_GO"
}
catch {
    Write-Host "MARCO9_BROWSER_RUN=REVIEW_REQUIRED" -ForegroundColor Yellow
    Write-Host "ERROR_CODE=$($_.Exception.Message)"
    Write-Host "DEPLOY=NONE"
    Write-Host "MARCO9=NO_GO"
    exit 2
}
) {
                    throw "DEBUG_TOKEN_FORMAT_INVALID"
                }
                $env:BJJ_EXAMS_M9_DEBUG_TOKEN = $Plain
                $Plain = $null
                & node $Browser $Flag
                $RunExit = $LASTEXITCODE
            }
            finally {
                if ($Ptr -ne [IntPtr]::Zero) {
                    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr)
                }
                if ($Secure) { $Secure.Dispose() }
                $Plain = $null
                Remove-Item Env:\BJJ_EXAMS_M9_DEBUG_TOKEN -ErrorAction SilentlyContinue
            }
            if ($RunExit -ne 0) { throw "BROWSER_RUN_REVIEW_REQUIRED" }
        }
        else {
            & node $Browser $Flag
            if ($LASTEXITCODE -ne 0) { throw "BROWSER_RUN_REVIEW_REQUIRED" }
        }
    }

    Write-Host "DEPLOY=NONE"
    Write-Host "MERGE=NONE"
    Write-Host "MARCO9=NO_GO"
}
catch {
    Write-Host "MARCO9_BROWSER_RUN=REVIEW_REQUIRED" -ForegroundColor Yellow
    Write-Host "ERROR_CODE=$($_.Exception.Message)"
    Write-Host "DEPLOY=NONE"
    Write-Host "MARCO9=NO_GO"
    exit 2
}

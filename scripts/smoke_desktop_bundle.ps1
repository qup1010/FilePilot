<#
.SYNOPSIS
对已安装的 FilePilot 桌面应用执行 smoke 验证。

.DESCRIPTION
脚本会验证安装包态的启动、健康检查、单实例、关闭后端清理以及再次启动链路。

.PARAMETER AppPath
已安装桌面应用的可执行文件路径，例如 FilePilot.exe。

.PARAMETER AppIdentifier
桌面应用写入运行时文件的标识符目录名，默认是 com.filepilot.desktop。

.PARAMETER BackendProcessName
后端进程名，默认是 file_pilot_api。

.PARAMETER StartupTimeoutSeconds
等待桌面应用启动和健康检查通过的超时时间。

.PARAMETER ShutdownTimeoutSeconds
等待后端随桌面应用退出的超时时间。

.PARAMETER SkipDynamicPortCheck
跳过“安装包态不应固定使用 8765”这项检查。
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$AppPath,

    [string]$AppIdentifier = "com.filepilot.desktop",

    [string]$BackendProcessName = "file_pilot_api",

    [int]$StartupTimeoutSeconds = 30,

    [int]$ShutdownTimeoutSeconds = 20,

    [switch]$SkipDynamicPortCheck
)

$ErrorActionPreference = "Stop"

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage,

        [int]$IntervalMilliseconds = 500
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $result = & $Condition
        if ($result) {
            return $result
        }
        Start-Sleep -Milliseconds $IntervalMilliseconds
    }

    throw $FailureMessage
}

function Get-RuntimePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Identifier
    )

    $runtimeRoot = Join-Path $env:APPDATA $Identifier
    Join-Path $runtimeRoot "output\runtime\backend.json"
}

function Get-BackendLogPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Identifier
    )

    $runtimeRoot = Join-Path $env:APPDATA $Identifier
    Join-Path $runtimeRoot "logs\backend\runtime.log"
}

function Read-RuntimeConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimePath
    )

    if (-not (Test-Path -LiteralPath $RuntimePath)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $RuntimePath -Raw -Encoding utf8 | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Wait-ForRuntimeConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuntimePath,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [System.Diagnostics.Process]$Process,

        [string]$PreviousInstanceId = "",

        [string]$PreviousStartedAt = ""
    )

    Wait-Until -TimeoutSeconds $TimeoutSeconds -FailureMessage "Runtime file was not ready in time: $RuntimePath" -Condition {
        if ($Process -and $Process.HasExited) {
            throw "Desktop app exited before runtime was ready. ExitCode=$($Process.ExitCode)"
        }

        $config = Read-RuntimeConfig -RuntimePath $RuntimePath
        if (-not $config) {
            return $null
        }

        $isFresh = $false
        if ($PreviousInstanceId -and "$($config.instance_id)" -ne $PreviousInstanceId) {
            $isFresh = $true
        }
        if ($PreviousStartedAt -and "$($config.started_at)" -ne $PreviousStartedAt) {
            $isFresh = $true
        }
        if (-not $PreviousInstanceId -and -not $PreviousStartedAt) {
            $isFresh = $true
        }

        if ($isFresh) {
            return $config
        }

        return $null
    }
}

function Wait-ForHealth {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Config,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [System.Diagnostics.Process]$Process
    )

    $healthUrl = "$($Config.base_url)/api/health"
    Wait-Until -TimeoutSeconds $TimeoutSeconds -FailureMessage "Backend health check did not pass: $healthUrl" -Condition {
        if ($Process -and $Process.HasExited) {
            throw "Desktop app exited before backend became healthy. ExitCode=$($Process.ExitCode)"
        }
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            return $false
        }
    } | Out-Null
}

function Assert-SingleInstance {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExecutablePath,

        [int]$TimeoutSeconds = 10
    )

    $name = [System.IO.Path]::GetFileNameWithoutExtension($ExecutablePath)
    $secondary = Start-Process -FilePath $ExecutablePath -PassThru
    try {
        Wait-Until -TimeoutSeconds $TimeoutSeconds -FailureMessage "Secondary launch did not settle to a single process for $name" -Condition {
            $running = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
            if ($running.Count -le 1) {
                return $true
            }
            return $false
        } | Out-Null
    } finally {
        if (-not $secondary.HasExited) {
            Wait-Process -Id $secondary.Id -Timeout 5 -ErrorAction SilentlyContinue | Out-Null
            if (-not $secondary.HasExited) {
                Stop-Process -Id $secondary.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Stop-AppProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process
    )

    if (-not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        Wait-Process -Id $Process.Id -Timeout 10 -ErrorAction SilentlyContinue | Out-Null
    }
}

function Wait-ForBackendExit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProcessName,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    Wait-Until -TimeoutSeconds $TimeoutSeconds -FailureMessage "Backend process still running after app exit: $ProcessName" -Condition {
        $running = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
        if ($running.Count -eq 0) {
            return $true
        }
        return $false
    } | Out-Null
}

function Start-AndValidateApp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExecutablePath,

        [Parameter(Mandatory = $true)]
        [string]$RuntimePath,

        [Parameter(Mandatory = $true)]
        [int]$StartupTimeoutSeconds,

        [switch]$SkipDynamicPortCheck
    )

    $previous = Read-RuntimeConfig -RuntimePath $RuntimePath
    $process = Start-Process -FilePath $ExecutablePath -PassThru
    $previousInstanceId = ""
    $previousStartedAt = ""
    if ($previous) {
        $previousInstanceId = [string]($previous.instance_id)
        $previousStartedAt = [string]($previous.started_at)
    }
    $config = Wait-ForRuntimeConfig `
        -RuntimePath $RuntimePath `
        -TimeoutSeconds $StartupTimeoutSeconds `
        -Process $process `
        -PreviousInstanceId $previousInstanceId `
        -PreviousStartedAt $previousStartedAt
    Wait-ForHealth -Config $config -TimeoutSeconds $StartupTimeoutSeconds -Process $process

    if (-not $SkipDynamicPortCheck -and [int]$config.port -eq 8765) {
        throw "Bundled desktop app should not use fixed port 8765."
    }

    return @{
        Process = $process
        Config = $config
    }
}

$resolvedAppPath = (Resolve-Path -LiteralPath $AppPath).Path
$runtimePath = Get-RuntimePath -Identifier $AppIdentifier
$backendLogPath = Get-BackendLogPath -Identifier $AppIdentifier
$primary = $null
$secondary = $null

try {
    Get-Process -Name $BackendProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    $primary = Start-AndValidateApp -ExecutablePath $resolvedAppPath -RuntimePath $runtimePath -StartupTimeoutSeconds $StartupTimeoutSeconds -SkipDynamicPortCheck:$SkipDynamicPortCheck
    Assert-SingleInstance -ExecutablePath $resolvedAppPath

    Stop-AppProcessTree -Process $primary.Process
    Wait-ForBackendExit -ProcessName $BackendProcessName -TimeoutSeconds $ShutdownTimeoutSeconds

    $secondary = Start-AndValidateApp -ExecutablePath $resolvedAppPath -RuntimePath $runtimePath -StartupTimeoutSeconds $StartupTimeoutSeconds -SkipDynamicPortCheck:$SkipDynamicPortCheck
    Stop-AppProcessTree -Process $secondary.Process
    Wait-ForBackendExit -ProcessName $BackendProcessName -TimeoutSeconds $ShutdownTimeoutSeconds

    Write-Output "Smoke test passed for $resolvedAppPath"
} finally {
    if ($runtimePath -and (Test-Path -LiteralPath $runtimePath)) {
        Write-Output "Runtime file: $runtimePath"
        Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8 | Write-Output
    }
    if ($backendLogPath -and (Test-Path -LiteralPath $backendLogPath)) {
        Write-Output "Backend log tail: $backendLogPath"
        Get-Content -LiteralPath $backendLogPath -Encoding utf8 | Select-Object -Last 60 | Write-Output
    }
    if ($secondary -and $secondary.Process -and -not $secondary.Process.HasExited) {
        Stop-Process -Id $secondary.Process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($primary -and $primary.Process -and -not $primary.Process.HasExited) {
        Stop-Process -Id $primary.Process.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name $BackendProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

<#
.SYNOPSIS
在隔离的 Windows runner 上验证 NSIS 安装升级和用户数据保留。

.DESCRIPTION
先安装上一个已发布版本，再覆盖安装当前版本；每个版本都运行桌面安装包 smoke，
并确认升级与卸载不会删除应用数据目录中的哨兵文件。
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$PreviousInstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$CurrentInstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$PreviousVersion,

    [Parameter(Mandatory = $true)]
    [string]$CurrentVersion,

    [string]$DesktopExecutableName = "file-pilot-desktop.exe",

    [string]$AppIdentifier = "com.filepilot.desktop",

    [string]$LanguageId = "1033"
)

$ErrorActionPreference = "Stop"

if ($env:CI -ne "true") {
    throw "This installer upgrade smoke test is restricted to an isolated CI runner."
}
if (-not $env:RUNNER_TEMP -or -not $env:APPDATA) {
    throw "RUNNER_TEMP and APPDATA must be set by the CI runner."
}
if ([version]$CurrentVersion -le [version]$PreviousVersion) {
    throw "The current package version must be newer than the upgrade baseline. Previous=$PreviousVersion; current=$CurrentVersion."
}

$previousInstaller = (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
$currentInstaller = (Resolve-Path -LiteralPath $CurrentInstallerPath).Path
$runnerTemp = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
$installDirectory = [System.IO.Path]::GetFullPath((Join-Path $runnerTemp "filepilot-nsis-upgrade"))
$relativeInstallPath = [System.IO.Path]::GetRelativePath($runnerTemp, $installDirectory)
if ([System.IO.Path]::IsPathRooted($relativeInstallPath) -or $relativeInstallPath -eq ".." -or $relativeInstallPath.StartsWith("..\")) {
    throw "Refusing to use an install directory outside RUNNER_TEMP: $installDirectory"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$smokeScript = Join-Path $repoRoot "scripts\smoke_desktop_bundle.ps1"
$appDataRoot = Join-Path $env:APPDATA $AppIdentifier
$sentinelPath = Join-Path $appDataRoot "nsis-upgrade-smoke-$([guid]::NewGuid().ToString('N')).txt"
$sentinelContent = [guid]::NewGuid().ToString("N")
$appPath = Join-Path $installDirectory $DesktopExecutableName

function Get-InstalledAppVersion {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Installed desktop executable was not found: $Path"
    }

    $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Path).ProductVersion
    if (-not $version) {
        throw "Product version metadata was not found in: $Path"
    }
    return $version
}

function Assert-AppVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $actualVersion = Get-InstalledAppVersion -Path $Path
    if ($actualVersion -notmatch "^$([regex]::Escape($ExpectedVersion))(\.|$)") {
        throw "$Label executable version mismatch. Expected $ExpectedVersion; got $actualVersion."
    }
    Write-Output "$Label desktop executable version: $actualVersion"
}

function Install-NsisPackage {
    param(
        [Parameter(Mandatory = $true)][string]$InstallerPath,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Output "Installing $Label NSIS package: $(Split-Path -Leaf $InstallerPath)"
    $process = Start-Process -FilePath $InstallerPath -ArgumentList @("/S", "/LANG=$LanguageId", "/D=$installDirectory") -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "$Label NSIS install failed with exit code $($process.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $appPath)) {
        throw "$Label desktop executable was not found after installation: $appPath"
    }
}

function Invoke-InstalledAppSmoke {
    param([Parameter(Mandatory = $true)][string]$Label)

    & powershell.exe -ExecutionPolicy Bypass -File $smokeScript -AppPath $appPath
    if ($LASTEXITCODE -ne 0) {
        throw "$Label desktop smoke test failed with exit code $LASTEXITCODE."
    }
}

function Uninstall-NsisPackage {
    $uninstaller = Join-Path $installDirectory "uninstall.exe"
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
        if ($process.ExitCode -ne 0) {
            throw "NSIS uninstall failed with exit code $($process.ExitCode)."
        }
    }
}

if (Test-Path -LiteralPath $installDirectory) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
}

try {
    Install-NsisPackage -InstallerPath $previousInstaller -Label $PreviousVersion
    Assert-AppVersion -Path $appPath -ExpectedVersion $PreviousVersion -Label "Previous"
    Invoke-InstalledAppSmoke -Label "Previous version"

    New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
    [System.IO.File]::WriteAllText($sentinelPath, $sentinelContent, [System.Text.UTF8Encoding]::new($false))

    Install-NsisPackage -InstallerPath $currentInstaller -Label $CurrentVersion
    Assert-AppVersion -Path $appPath -ExpectedVersion $CurrentVersion -Label "Upgraded"
    if (-not (Test-Path -LiteralPath $sentinelPath) -or [System.IO.File]::ReadAllText($sentinelPath) -ne $sentinelContent) {
        throw "Application data was not preserved while upgrading from $PreviousVersion to $CurrentVersion."
    }
    Write-Output "Application data sentinel survived the upgrade."
    Invoke-InstalledAppSmoke -Label "Upgraded version"

    Uninstall-NsisPackage
    if (Test-Path -LiteralPath $appPath) {
        throw "Desktop executable remains after NSIS uninstall: $appPath"
    }
    if (-not (Test-Path -LiteralPath $sentinelPath)) {
        throw "Application data sentinel was removed by NSIS uninstall."
    }
    Write-Output "Application data sentinel survived uninstall."
} finally {
    try {
        Uninstall-NsisPackage
    } catch {
        Write-Warning "Best-effort NSIS cleanup failed: $($_.Exception.Message)"
    }

    if (Test-Path -LiteralPath $installDirectory) {
        Remove-Item -LiteralPath $installDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath $sentinelPath) {
        Remove-Item -LiteralPath $sentinelPath -Force
    }
}

Write-Output "NSIS upgrade smoke passed: $PreviousVersion -> $CurrentVersion."

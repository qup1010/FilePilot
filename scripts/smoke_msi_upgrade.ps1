<#
.SYNOPSIS
在隔离的 Windows runner 上验证 WiX MSI 安装升级和用户数据保留。

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

    [switch]$VerifyUiLanguages,

    [switch]$VerifyOrganizationFlow
)

$ErrorActionPreference = "Stop"

if ($env:CI -ne "true") {
    throw "This MSI upgrade smoke test is restricted to an isolated CI runner."
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
$installDirectory = [System.IO.Path]::GetFullPath((Join-Path $runnerTemp "filepilot-msi-upgrade"))
$relativeInstallPath = [System.IO.Path]::GetRelativePath($runnerTemp, $installDirectory)
if ([System.IO.Path]::IsPathRooted($relativeInstallPath) -or $relativeInstallPath -eq ".." -or $relativeInstallPath.StartsWith("..\")) {
    throw "Refusing to use an install directory outside RUNNER_TEMP: $installDirectory"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$smokeScript = Join-Path $repoRoot "scripts\smoke_desktop_bundle.ps1"
$msiexecPath = Join-Path $env:SystemRoot "System32\msiexec.exe"
$appDataRoot = Join-Path $env:APPDATA $AppIdentifier
$sentinelPath = Join-Path $appDataRoot "msi-upgrade-smoke-$([guid]::NewGuid().ToString('N')).txt"
$sentinelContent = [guid]::NewGuid().ToString("N")
$appPath = $null

function Resolve-InstalledAppPath {
    $candidates = @(
        (Join-Path $installDirectory $DesktopExecutableName),
        (Join-Path $env:LOCALAPPDATA "Programs\FilePilot\$DesktopExecutableName"),
        (Join-Path $env:ProgramFiles "FilePilot\$DesktopExecutableName"),
        (Join-Path ${env:ProgramFiles(x86)} "FilePilot\$DesktopExecutableName")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $match = $candidates | Select-Object -First 1
    if ($match) {
        return $match
    }

    $uninstallRoots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    $registeredApps = foreach ($root in $uninstallRoots) {
        Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
            Where-Object { [string]$_.DisplayName -match "^FilePilot(?:\s|$)" }
    }
    foreach ($registeredApp in $registeredApps) {
        $installLocation = [string]$registeredApp.InstallLocation
        if ($installLocation -and (Test-Path -LiteralPath $installLocation -PathType Container)) {
            $registeredExe = Join-Path $installLocation $DesktopExecutableName
            if (Test-Path -LiteralPath $registeredExe) {
                return $registeredExe
            }
        }

        $displayIcon = [Environment]::ExpandEnvironmentVariables([string]$registeredApp.DisplayIcon).Trim()
        if ($displayIcon -match '^"(?<path>[^"]+\.exe)"') {
            $registeredExe = $Matches.path
        } elseif ($displayIcon -match '^(?<path>.*?\.exe)(?:,\s*\d+)?\s*$') {
            $registeredExe = $Matches.path.Trim('"')
        } else {
            $registeredExe = $null
        }
        if ($registeredExe -and (Test-Path -LiteralPath $registeredExe -PathType Leaf)) {
            return $registeredExe
        }
    }

    $searchRoots = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($root in $searchRoots) {
        $match = Get-ChildItem $root -Recurse -Filter $DesktopExecutableName -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($match) {
            return $match.FullName
        }
    }

    $registrationSummary = @($registeredApps | ForEach-Object {
        "DisplayName='$($_.DisplayName)'; InstallLocation='$($_.InstallLocation)'; DisplayIcon='$($_.DisplayIcon)'"
    }) -join " | "
    if (-not $registrationSummary) {
        $registrationSummary = "<no FilePilot uninstall entries found>"
    }
    throw "Installed desktop executable was not found in the standard install locations: $DesktopExecutableName. MSI registration: $registrationSummary"
}

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

function Invoke-Msi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("Install", "Uninstall")][string]$Action,
        [Parameter(Mandatory = $true)][string]$InstallerPath,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$AllowAbsent
    )

    $logLabel = $Label -replace "[^A-Za-z0-9-]", "-"
    $logPath = Join-Path $runnerTemp "filepilot-msi-$logLabel-$Action.log"
    if ($Action -eq "Install") {
        $arguments = "/i `"$InstallerPath`" /qn /norestart INSTALLDIR=`"$installDirectory`" /l*v `"$logPath`""
    } else {
        $arguments = "/x `"$InstallerPath`" /qn /norestart /l*v `"$logPath`""
    }

    Write-Output "MSI $Action ${Label}: $(Split-Path -Leaf $InstallerPath)"
    $process = Start-Process -FilePath $msiexecPath -ArgumentList $arguments -PassThru -Wait
    $acceptedExitCodes = @(0, 3010)
    if ($AllowAbsent) {
        $acceptedExitCodes += @(1605, 1614)
    }
    if ($process.ExitCode -notin $acceptedExitCodes) {
        throw "MSI $Action $Label failed with exit code $($process.ExitCode). Log: $logPath"
    }
}

function Invoke-InstalledAppSmoke {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$VerifyUiLanguages,
        [switch]$VerifyOrganizationFlow
    )

    $arguments = @("-ExecutionPolicy", "Bypass", "-File", $smokeScript, "-AppPath", $appPath, "-AppIdentifier", $AppIdentifier)
    if ($VerifyUiLanguages) {
        $arguments += "-VerifyUiLanguages"
    }
    if ($VerifyOrganizationFlow) {
        $arguments += "-VerifyOrganizationFlow"
    }
    & powershell.exe @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label desktop smoke test failed with exit code $LASTEXITCODE."
    }
}

if (Test-Path -LiteralPath $installDirectory) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
}

try {
    Invoke-Msi -Action Install -InstallerPath $previousInstaller -Label $PreviousVersion
    $appPath = Resolve-InstalledAppPath
    Assert-AppVersion -Path $appPath -ExpectedVersion $PreviousVersion -Label "Previous"
    Invoke-InstalledAppSmoke -Label "Previous version"

    New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
    [System.IO.File]::WriteAllText($sentinelPath, $sentinelContent, [System.Text.UTF8Encoding]::new($false))

    Invoke-Msi -Action Install -InstallerPath $currentInstaller -Label $CurrentVersion
    $appPath = Resolve-InstalledAppPath
    Assert-AppVersion -Path $appPath -ExpectedVersion $CurrentVersion -Label "Upgraded"
    if (-not (Test-Path -LiteralPath $sentinelPath) -or [System.IO.File]::ReadAllText($sentinelPath) -ne $sentinelContent) {
        throw "Application data was not preserved while upgrading from $PreviousVersion to $CurrentVersion."
    }
    Write-Output "Application data sentinel survived the upgrade."
    Invoke-InstalledAppSmoke -Label "Upgraded version" -VerifyUiLanguages:$VerifyUiLanguages -VerifyOrganizationFlow:$VerifyOrganizationFlow

    Invoke-Msi -Action Uninstall -InstallerPath $currentInstaller -Label $CurrentVersion
    if (Test-Path -LiteralPath $appPath) {
        throw "Desktop executable remains after MSI uninstall: $appPath"
    }
    if (-not (Test-Path -LiteralPath $sentinelPath)) {
        throw "Application data sentinel was removed by MSI uninstall."
    }
    Write-Output "Application data sentinel survived uninstall."
} finally {
    try {
        Invoke-Msi -Action Uninstall -InstallerPath $currentInstaller -Label $CurrentVersion -AllowAbsent
    } catch {
        Write-Warning "Best-effort current MSI cleanup failed: $($_.Exception.Message)"
    }
    try {
        Invoke-Msi -Action Uninstall -InstallerPath $previousInstaller -Label $PreviousVersion -AllowAbsent
    } catch {
        Write-Warning "Best-effort previous MSI cleanup failed: $($_.Exception.Message)"
    }

    if (Test-Path -LiteralPath $installDirectory) {
        Remove-Item -LiteralPath $installDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath $sentinelPath) {
        Remove-Item -LiteralPath $sentinelPath -Force
    }
}

Write-Output "MSI upgrade smoke passed: $PreviousVersion -> $CurrentVersion."

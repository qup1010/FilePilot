param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "build", "check-env")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

function Add-PathEntry {
    param([string]$PathEntry)
    if (-not $PathEntry -or -not (Test-Path -LiteralPath $PathEntry)) {
        return
    }
    $entries = $env:PATH -split ';' | Where-Object { $_ }
    if ($entries -notcontains $PathEntry) {
        $env:PATH = "$PathEntry;$env:PATH"
    }
}

function Test-VsInstallHasCompilerTools {
    param([string]$VsDevCmd)

    $toolsDir = Split-Path -Parent $VsDevCmd
    $common7Dir = Split-Path -Parent $toolsDir
    $installDir = Split-Path -Parent $common7Dir
    $toolRoot = Join-Path $installDir "VC\Tools\MSVC"
    if (-not (Test-Path -LiteralPath $toolRoot)) {
        return $false
    }
    $hasLink = Get-ChildItem -Path $toolRoot -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Hostx64\\x64|HostX64\\x64' } |
        Select-Object -First 1
    $hasCl = Get-ChildItem -Path $toolRoot -Recurse -Filter "cl.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Hostx64\\x64|HostX64\\x64' } |
        Select-Object -First 1
    return [bool]($hasLink -and $hasCl)
}

function Find-VsDevCmd {
    $candidates = @()
    $vswherePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
        "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
    )

    foreach ($vswhere in $vswherePaths) {
        if (Test-Path -LiteralPath $vswhere) {
            $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if ($installPath) {
                $candidates += (Join-Path $installPath "Common7\Tools\VsDevCmd.bat")
            }
        }
    }

    $roots = @(
        "$env:ProgramFiles\Microsoft Visual Studio",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio"
    )
    foreach ($root in $roots) {
        if (Test-Path -LiteralPath $root) {
            $candidates += Get-ChildItem -LiteralPath $root -Recurse -Filter "VsDevCmd.bat" -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty FullName
        }
    }

    $validCandidates = @()
    foreach ($candidate in ($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
        if (Test-VsInstallHasCompilerTools $candidate) {
            $validCandidates += $candidate
        }
    }

    $validCandidates | Select-Object -First 1
}

function Import-VsDevEnvironment {
    if (Get-Command link.exe -ErrorAction SilentlyContinue) {
        return
    }

    $vsDevCmd = Find-VsDevCmd
    if (-not $vsDevCmd) {
        throw "Visual Studio C++ build environment was not found. Install Visual Studio Build Tools with Desktop development with C++."
    }

    $cmdLine = 'call "' + $vsDevCmd + '" -arch=x64 -host_arch=x64 >nul && set'
    $envDump = & cmd.exe /d /s /c $cmdLine
    foreach ($line in $envDump) {
        if ($line -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }

    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue) -or -not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
        throw "VsDevCmd.bat was found, but cl.exe/link.exe are still unavailable. Check the Visual Studio C++ toolchain installation."
    }
}

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
Add-PathEntry $cargoBin

if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
    throw "cargo.exe was not found. Install Rust, or add $cargoBin to PATH."
}

Import-VsDevEnvironment

# Auto-detect project virtual environment python to prevent execution failure on system default python.
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    if (-not $env:FILE_PILOT_PYTHON) {
        $env:FILE_PILOT_PYTHON = $venvPython
    }
}

if ($Mode -eq "check-env") {
    Write-Host "cargo: $((Get-Command cargo.exe).Source)"
    Write-Host "cl:    $((Get-Command cl.exe).Source)"
    Write-Host "link:  $((Get-Command link.exe).Source)"
    exit 0
}

if ($Mode -eq "dev") {
    & tauri dev --config src-tauri/tauri.conf.json
} else {
    & tauri build --config src-tauri/tauri.conf.json
}

exit $LASTEXITCODE

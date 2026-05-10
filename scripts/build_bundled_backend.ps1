param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$PythonExe = ""
)

$ErrorActionPreference = "Stop"

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backendResourceDir = Join-Path $projectRootPath "dist\backend"
$backendExe = Join-Path $projectRootPath "dist\file_pilot_api.exe"
$resourceExe = Join-Path $backendResourceDir "file_pilot_api.exe"
$pyinstallerWorkDir = Join-Path $projectRootPath ".tmp\pyinstaller-build"
$pyinstallerSpecDir = Join-Path $projectRootPath ".tmp\pyinstaller-spec"
$strategyCatalogPath = Join-Path $projectRootPath "frontend\src\lib\strategy-catalog.json"
$venvPython = Join-Path $projectRootPath ".venv\Scripts\python.exe"

if (-not $PythonExe) {
    if (Test-Path -LiteralPath $venvPython) {
        $PythonExe = $venvPython
    }
    else {
        $PythonExe = "python"
    }
}

Push-Location $projectRootPath
try {
    if (Test-Path -LiteralPath $backendResourceDir) {
        Remove-Item -LiteralPath $backendResourceDir -Recurse -Force
    }

    & $PythonExe -m PyInstaller `
        --noconfirm `
        --clean `
        --onefile `
        --noconsole `
        --name file_pilot_api `
        --paths . `
        --workpath $pyinstallerWorkDir `
        --specpath $pyinstallerSpecDir `
        --add-data "${strategyCatalogPath};frontend/src/lib" `
        --collect-submodules file_pilot `
        --collect-submodules uvicorn `
        --collect-submodules fastapi `
        file_pilot/api/__main__.py

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE."
    }

    New-Item -ItemType Directory -Force -Path $backendResourceDir | Out-Null
    Copy-Item -LiteralPath $backendExe -Destination $resourceExe -Force

    Write-Output "Bundled backend ready: $resourceExe"
}
finally {
    Pop-Location
}



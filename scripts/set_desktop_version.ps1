[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Version {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InputVersion
    )

    $normalized = $InputVersion.Trim()
    if ($normalized.StartsWith("v")) {
        $normalized = $normalized.Substring(1)
    }

    if ($normalized -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
        throw "Unsupported version format: $InputVersion. Expected semver such as 0.1.1 or v0.1.1-beta.1"
    }

    return $normalized
}

function Replace-FirstMatch {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,

        [Parameter(Mandatory = $true)]
        [string]$Pattern,

        [Parameter(Mandatory = $true)]
        [string]$Replacement
    )

    $regex = [System.Text.RegularExpressions.Regex]::new($Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $match = $regex.Match($Content)
    if (-not $match.Success) {
        throw "Pattern not found: $Pattern"
    }

    return $regex.Replace($Content, $Replacement, 1)
}

function Update-FileContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Transform
    )

    $content = Get-Content -LiteralPath $Path -Raw -Encoding utf8
    $updated = & $Transform $content

    if ($updated -ne $content) {
        Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
        Write-Host "Updated $Path"
    }
    else {
        Write-Host "Unchanged $Path"
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$normalizedVersion = Normalize-Version -InputVersion $Version

$desktopPackageJson = Join-Path $repoRoot "desktop\package.json"
$desktopPackageLock = Join-Path $repoRoot "desktop\package-lock.json"
$tauriConfig = Join-Path $repoRoot "desktop\src-tauri\tauri.conf.json"
$cargoToml = Join-Path $repoRoot "desktop\src-tauri\Cargo.toml"

Update-FileContent -Path $desktopPackageJson -Transform {
    param($content)
    Replace-FirstMatch -Content $content -Pattern '"version":\s*"[^"]+"' -Replacement ('"version": "' + $normalizedVersion + '"')
}

Update-FileContent -Path $desktopPackageLock -Transform {
    param($content)
    $updated = Replace-FirstMatch -Content $content -Pattern '(^\s{2}"version":\s*)"[^"]+"' -Replacement ('$1"' + $normalizedVersion + '"')
    $updated = Replace-FirstMatch -Content $updated -Pattern '(^\s{6}"version":\s*)"[^"]+"' -Replacement ('$1"' + $normalizedVersion + '"')
    $updated
}

Update-FileContent -Path $tauriConfig -Transform {
    param($content)
    Replace-FirstMatch -Content $content -Pattern '"version":\s*"[^"]+"' -Replacement ('"version": "' + $normalizedVersion + '"')
}

Update-FileContent -Path $cargoToml -Transform {
    param($content)
    Replace-FirstMatch -Content $content -Pattern '(^version\s*=\s*)"[^"]+"' -Replacement ('$1"' + $normalizedVersion + '"')
}

Write-Host "Desktop version synchronized to $normalizedVersion"

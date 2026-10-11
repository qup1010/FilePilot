param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\frontend\out")
)

$ErrorActionPreference = "Stop"

$resolvedOutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$frontendResources = @(
    Get-ChildItem -LiteralPath $resolvedOutputDirectory -Recurse -File |
        Where-Object { $_.Extension -in @(".html", ".js") }
)

if ($frontendResources.Count -eq 0) {
    throw "No HTML or JavaScript resources were found in $resolvedOutputDirectory."
}

$requiredPhrases = @(
    ([char[]]@(0x754C, 0x9762, 0x8BED, 0x8A00) -join ""),
    ([char[]]@(0x8DDF, 0x968F, 0x7CFB, 0x7EDF) -join ""),
    "Interface language",
    "Follow system",
    "Simplified Chinese",
    "This interface language is not supported"
)

foreach ($phrase in $requiredPhrases) {
    $found = $false
    foreach ($resource in $frontendResources) {
        if (Select-String -LiteralPath $resource.FullName -Pattern $phrase -SimpleMatch -Quiet) {
            $found = $true
            break
        }
    }

    if (-not $found) {
        throw "Localized frontend phrase was not found in the static export: $phrase"
    }

    Write-Output "Found localized frontend phrase: $phrase"
}

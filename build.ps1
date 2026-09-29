$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $project
$manifest = Get-Content -LiteralPath 'manifest.json' -Raw | ConvertFrom-Json
$versionedXpi = "paper-assistant-$($manifest.version).xpi"

foreach ($file in @($versionedXpi, 'paper-assistant.xpi')) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
}

& zip -r -X $versionedXpi manifest.json bootstrap.js chrome.manifest content
if ($LASTEXITCODE -ne 0) { throw 'XPI packaging failed.' }
& zip -T $versionedXpi
if ($LASTEXITCODE -ne 0) { throw 'XPI integrity check failed.' }
Copy-Item -LiteralPath $versionedXpi -Destination 'paper-assistant.xpi'

$hash = (Get-FileHash -LiteralPath $versionedXpi -Algorithm SHA256).Hash.ToLowerInvariant()
$updates = @{
    addons = @{
        'paper-assistant@local' = @{
            updates = @(@{
                version = $manifest.version
                update_link = 'https://raw.githubusercontent.com/chaojilanyangyang888/zetero/main/paper-assistant.xpi'
                update_hash = "sha256:$hash"
                applications = @{ zotero = @{
                    strict_min_version = $manifest.applications.zotero.strict_min_version
                    strict_max_version = $manifest.applications.zotero.strict_max_version
                } }
            })
        }
    }
}
$updates | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath 'updates.json' -Encoding utf8
Write-Output "Built $versionedXpi and updates.json ($hash)"

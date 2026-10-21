param([string]$Container = 'n8n')
$ErrorActionPreference = 'Stop'
$crmCheckRoot = Split-Path -Parent $PSScriptRoot
$crmCheckFiles = @(
    @{ Source=(Join-Path $PSScriptRoot 'n8n\check-unified-connections.mjs'); Target='check-unified-connections.mjs' },
    @{ Source=(Join-Path $crmCheckRoot 'private-integrations\customerlead-unified-gemini.json'); Target='customerlead-unified-gemini.json' },
    @{ Source=(Join-Path $crmCheckRoot 'private-integrations\import-result.json'); Target='import-result.json' }
)
foreach ($crmCheckFile in $crmCheckFiles) {
    if (-not (Test-Path -LiteralPath $crmCheckFile.Source -PathType Leaf)) { throw "Required private check file is missing: $($crmCheckFile.Target)." }
}
$crmCheckStage = '/tmp/customerlead-check-' + [guid]::NewGuid().ToString('N')
$crmCheckStageCreated = $false
$crmCheckHelperStaged = $false
try {
    & docker exec $Container mkdir -m 700 $crmCheckStage
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the private connection-check staging directory.' }
    $crmCheckStageCreated = $true
    foreach ($crmCheckFile in $crmCheckFiles) {
        & docker cp $crmCheckFile.Source "${Container}:$crmCheckStage/$($crmCheckFile.Target)"
        if ($LASTEXITCODE -ne 0) { throw "Could not stage $($crmCheckFile.Target)." }
        if ($crmCheckFile.Target -eq 'check-unified-connections.mjs') { $crmCheckHelperStaged = $true }
    }
    $crmCheckOutput = & docker exec $Container node --no-warnings "$crmCheckStage/check-unified-connections.mjs"
    $crmCheckExit = $LASTEXITCODE
    $crmCheckResult = ($crmCheckOutput -join "`n") | ConvertFrom-Json
    if ($crmCheckExit -ne 0 -or -not $crmCheckResult.ready) {
        if ($crmCheckResult.error) { throw $crmCheckResult.error }
        throw 'The read-only connection check failed; private command output was withheld.'
    }
    $crmCheckResultPath = Join-Path $crmCheckRoot 'private-integrations\connection-check-result.json'
    [System.IO.File]::WriteAllText($crmCheckResultPath, ($crmCheckResult | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    $crmCheckResult | ConvertTo-Json -Depth 8
} finally {
    if ($crmCheckStageCreated) {
        if ($crmCheckStage -notmatch '^/tmp/customerlead-check-[0-9a-f]{32}$') { throw 'Unexpected private connection-check staging directory.' }
        if ($crmCheckHelperStaged) {
            & docker exec $Container node --no-warnings "$crmCheckStage/check-unified-connections.mjs" --cleanup
        } else {
            # This directory is still empty if the first helper copy failed.
            & docker exec $Container rmdir $crmCheckStage
        }
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the private connection-check staging directory.' }
    }
}

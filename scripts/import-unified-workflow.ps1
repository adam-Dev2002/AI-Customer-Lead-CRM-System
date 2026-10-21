param(
    [string]$Container = 'n8n',
    [switch]$ImportDraft,
    [switch]$RefreshDraft,
    [switch]$ReviewLive
)
$ErrorActionPreference = 'Stop'
if (@($ImportDraft, $RefreshDraft, $ReviewLive | Where-Object { $_ }).Count -gt 1) { throw 'Choose only one of review, inactive-draft import, or node-order-only draft refresh.' }
$crmUnifiedRoot = Split-Path -Parent $PSScriptRoot
$crmUnifiedManifestPath = Join-Path $PSScriptRoot 'n8n\unified-sources.json'
$crmUnifiedWorkflowPath = Join-Path $crmUnifiedRoot 'private-integrations\customerlead-unified-gemini.json'
$crmUnifiedHelperPath = Join-Path $PSScriptRoot 'n8n\import-unified.mjs'
$crmUnifiedManifest = Get-Content -LiteralPath $crmUnifiedManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$crmUnifiedExpected = @{ main='8yrYwA0BHLqkdaNU'; sync='MLz8oxiFRaHlEUWi'; sender='xVUk4j8UMpJL2npU' }
foreach ($crmUnifiedRole in @('main', 'sync', 'sender')) {
    $crmUnifiedSources = @($crmUnifiedManifest.sources | Where-Object { $_.role -eq $crmUnifiedRole })
    if ($crmUnifiedSources.Count -ne 1) { throw "Expected exactly one reviewed $crmUnifiedRole source." }
    $crmUnifiedSource = $crmUnifiedSources[0]
    if ((Get-FileHash -LiteralPath $crmUnifiedSource.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $crmUnifiedSource.sha256) {
        throw "The reviewed $crmUnifiedRole source changed. Review and rebuild before importing."
    }
    $crmUnifiedParsed = Get-Content -LiteralPath $crmUnifiedSource.path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($crmUnifiedParsed.id -ne $crmUnifiedExpected[$crmUnifiedRole]) { throw "Unexpected $crmUnifiedRole workflow ID." }
}
if (-not (Test-Path -LiteralPath $crmUnifiedWorkflowPath -PathType Leaf)) { throw 'Build the private unified workflow before importing.' }
$crmUnifiedStage = '/tmp/customerlead-unified-' + [guid]::NewGuid().ToString('N')
$crmUnifiedStageCreated = $false
try {
    & docker exec $Container mkdir -m 700 $crmUnifiedStage
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the private staging directory in the running n8n container.' }
    $crmUnifiedStageCreated = $true
    $crmUnifiedFiles = @(
        @{ Source=$crmUnifiedHelperPath; Target='import-unified.mjs' },
        @{ Source=(Join-Path $PSScriptRoot 'n8n\review-unified-live.mjs'); Target='review-unified-live.mjs' },
        @{ Source=$crmUnifiedManifestPath; Target='unified-sources.json' },
        @{ Source=$crmUnifiedWorkflowPath; Target='customerlead-unified-gemini.json' }
    )
    foreach ($crmUnifiedSource in $crmUnifiedManifest.sources) {
        $crmUnifiedFiles += @{ Source=$crmUnifiedSource.path; Target=($crmUnifiedSource.role + '.json') }
    }
    foreach ($crmUnifiedFile in $crmUnifiedFiles) {
        & docker cp $crmUnifiedFile.Source "${Container}:$crmUnifiedStage/$($crmUnifiedFile.Target)"
        if ($LASTEXITCODE -ne 0) { throw "Could not stage $($crmUnifiedFile.Target)." }
    }
    $crmUnifiedCommand = if ($ReviewLive) { 'review-unified-live.mjs' } else { 'import-unified.mjs' }
    $crmUnifiedArguments = @('exec', $Container, 'node', '--no-warnings', "$crmUnifiedStage/$crmUnifiedCommand")
    if ($ImportDraft) { $crmUnifiedArguments += '--import-draft' }
    if ($RefreshDraft) { $crmUnifiedArguments += '--refresh-draft' }
    $crmUnifiedOutput = & docker @crmUnifiedArguments
    $crmUnifiedExit = $LASTEXITCODE
    $crmUnifiedResult = ($crmUnifiedOutput -join "`n") | ConvertFrom-Json
    if ($crmUnifiedExit -ne 0 -or -not $crmUnifiedResult.ready) {
        if ($crmUnifiedResult.error) { throw $crmUnifiedResult.error }
        throw 'The inactive-draft import check failed; no private command output was displayed.'
    }
    if ($ImportDraft -or $RefreshDraft) {
        if ($crmUnifiedResult.active -ne $false -or $crmUnifiedResult.mode -notin @('imported', 'existing-draft', 'refreshed-draft')) { throw 'The result is not a verified inactive draft.' }
        $crmUnifiedResultPath = Join-Path $crmUnifiedRoot 'private-integrations\import-result.json'
        [System.IO.File]::WriteAllText($crmUnifiedResultPath, ($crmUnifiedResult | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    }
    $crmUnifiedResult | ConvertTo-Json -Depth 8
} finally {
    if ($crmUnifiedStageCreated) {
        if ($crmUnifiedStage -notmatch '^/tmp/customerlead-unified-[0-9a-f]{32}$') { throw 'Unexpected private staging directory.' }
        # Only this exact validated /tmp directory is removed; no Windows recursion.
        & docker exec $Container node --no-warnings "$crmUnifiedStage/import-unified.mjs" --cleanup
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the private container staging directory.' }
    }
}

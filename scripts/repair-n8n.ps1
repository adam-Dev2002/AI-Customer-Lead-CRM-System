param([string]$Container = 'n8n', [switch]$Apply)
$ErrorActionPreference = 'Stop'
$repairRoot = Split-Path -Parent $PSScriptRoot
$repairStage = '/tmp/customerlead-repair-' + [guid]::NewGuid().ToString('N')
& docker exec $Container mkdir -m 700 $repairStage
if ($LASTEXITCODE -ne 0) { throw 'Cannot access the running n8n container.' }
try {
    foreach ($repairFile in @('repair-live.mjs','upgrade-workflows.mjs','bridge-code.mjs','mail-code.mjs')) {
        & docker cp (Join-Path $PSScriptRoot "n8n\$repairFile") "${Container}:$repairStage/$repairFile"
        if ($LASTEXITCODE -ne 0) { throw "Could not stage $repairFile." }
    }
    & docker cp (Join-Path $repairRoot 'templates\leads\public\integrations\customerlead-sync-bridge.json') "${Container}:$repairStage/customerlead-sync-bridge.json"
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the prepared sync bridge.' }
    $repairPlanOutput = & docker exec $Container node "$repairStage/repair-live.mjs"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the three existing workflows.' }
    $repairPlan = ($repairPlanOutput -join "`n") | ConvertFrom-Json
    if (-not $Apply) { $repairPlan | ConvertTo-Json -Depth 5; return }

    $repairCurrent = Invoke-RestMethod -Uri 'http://localhost:3001/api/crm'
    if (@($repairCurrent.mailJobs | Where-Object { $_.status -eq 'Sending' }).Count) {
        throw 'Wait for the in-flight Gmail reply to finish before reloading n8n.'
    }
    $repairBackupDirectory = Join-Path $repairRoot '.local-preview\data-backups'
    New-Item -ItemType Directory -Path $repairBackupDirectory -Force | Out-Null
    $repairTimestamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath (Join-Path $repairRoot 'templates\leads\.data\crm.json') -Destination (Join-Path $repairBackupDirectory "crm-before-integration-repair-$repairTimestamp.json")
    $repairSettings = @{}
    foreach ($property in $repairCurrent.settings.PSObject.Properties) { $repairSettings[$property.Name] = $property.Value }
    foreach ($property in $repairPlan.suggestedSettings.PSObject.Properties) { $repairSettings[$property.Name] = $property.Value }
    if (-not $repairSettings.ownerEmail -or $repairSettings.ownerEmail -eq 'owner@example.com') {
        if (-not $repairCurrent.connection.mailSenderEmail) { throw 'Register the Gmail sender first.' }
        $repairSettings.ownerEmail = $repairCurrent.connection.mailSenderEmail
    }
    $repairSettingsBody = @{ action='settings.update'; payload=$repairSettings } | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Uri 'http://localhost:3001/api/crm' -Method Post -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($repairSettingsBody)) | Out-Null
    try {
        & docker exec $Container node "$repairStage/repair-live.mjs" --apply
        if ($LASTEXITCODE -ne 0) { throw 'Workflow repair did not complete.' }
    } finally {
        # CLI publication changes need an engine reload, including after rollback.
        & docker restart $Container
        if ($LASTEXITCODE -ne 0) { throw 'Could not restart n8n after the repair.' }
    }
} finally {
    # A single known staging directory in /tmp, never a workspace-derived path.
    if ($repairStage -notmatch '^/tmp/customerlead-repair-[0-9a-f]{32}$') { throw 'Unexpected staging directory.' }
    & docker exec $Container node "$repairStage/repair-live.mjs" --cleanup
    if ($LASTEXITCODE -ne 0) { throw 'Could not clean up the private staging directory.' }
}

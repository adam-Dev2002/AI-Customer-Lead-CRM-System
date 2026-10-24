param(
  [string]$Container = 'n8n',
  [string]$ConfigFile = '',
  [switch]$Install,
  [switch]$Check,
  [switch]$CheckPublic,
  [switch]$Start,
  [switch]$Stop,
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigFile) { $ConfigFile = Join-Path $projectRoot 'private-integrations\local-onboarding\worker.json' }
if ($Container -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$') { throw 'Choose the existing n8n container name.' }
$target = '/home/node/.n8n/customerlead-onboarding-worker'
if ($Restart) { $Install = $true; $Start = $true }
if (-not ($Install -or $Check -or $CheckPublic -or $Start -or $Stop)) {
  Write-Output "Plan: install the outbound-only worker into $Container at $target. Existing workflows and credentials are retained. Use -Install, then -CheckPublic, then -Start. Use -Restart to safely drain and update an existing worker."
  exit 0
}
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw 'Create the private worker.json using docs/local-docker-multi-user.md. Never paste its keys into chat.' }
if ($Install) {
  # Never replace a worker's identity/key while its encrypted journal may exist.
  & docker exec $Container test -f "$target/worker.json"
  if ($LASTEXITCODE -eq 0) {
    $existingHashLine = & docker exec $Container sha256sum "$target/worker.json"
    if ($LASTEXITCODE -ne 0) { throw 'The installed worker configuration could not be checked.' }
    $existingHash = ($existingHashLine -split '\s+')[0]
    if ($existingHash -ne (Get-FileHash -LiteralPath $ConfigFile -Algorithm SHA256).Hash.ToLowerInvariant()) {
      throw 'The installed worker has a different private configuration. Reconcile its pending journal before changing any key or identity.'
    }
  }
}
if ($Install -or $Start -or $Stop) {
  & docker exec $Container mkdir -p $target
  if ($LASTEXITCODE -ne 0) { throw 'Start Docker and the existing n8n container first.' }
  & docker cp (Join-Path $projectRoot 'deploy\n8n-onboarding\worker-control.mjs') "${Container}:$target/worker-control.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Worker lifecycle helper could not be installed.' }
}
if ($Stop -or $Install) {
  & docker exec $Container node "$target/worker-control.mjs" $target stop
  if ($LASTEXITCODE -ne 0) { throw 'Worker is still finishing work. No runner or configuration was replaced. Retry after its current operation finishes.' }
}
if ($Install) {
  & docker exec $Container chmod 700 $target
  if ($LASTEXITCODE -ne 0) { throw 'The worker directory could not be protected.' }
  foreach ($name in @('credential-importer.mjs','workflow-integrity.mjs','pull-worker.mjs','run-pull-worker.mjs')) {
    $sourceFile = if ($name -eq 'workflow-integrity.mjs') { Join-Path $projectRoot 'templates\leads\lib\connections\workflow-integrity.mjs' } else { Join-Path $projectRoot "deploy\n8n-onboarding\$name" }
    & docker cp $sourceFile "${Container}:$target/$name"
    if ($LASTEXITCODE -ne 0) { throw 'Worker installation failed.' }
  }
  & docker cp $ConfigFile "${Container}:$target/worker.json"
  if ($LASTEXITCODE -ne 0) { throw 'Private configuration could not be copied.' }
  # docker cp creates root-owned files even though n8n runs as node.
  & docker exec --user 0 $Container chown node:node "$target/worker.json" "$target/credential-importer.mjs" "$target/workflow-integrity.mjs" "$target/pull-worker.mjs" "$target/run-pull-worker.mjs" "$target/worker-control.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Worker file ownership could not be assigned to n8n.' }
  & docker exec $Container chmod 600 "$target/worker.json"
  if ($LASTEXITCODE -ne 0) { throw 'The worker configuration could not be protected.' }
}
if ($Check -or $CheckPublic -or $Start) {
  $checkMode = if ($CheckPublic -or $Start) { '--check-public' } else { '--check' }
  & docker exec $Container node "$target/run-pull-worker.mjs" --config "$target/worker.json" $checkMode
  if ($LASTEXITCODE -ne 0) { throw 'Connection readiness has not passed. Verify local n8n and the public Vercel Production environment/redeployment. The worker was not started.' }
}
if ($Start) {
  $workerState = & docker exec $Container node "$target/worker-control.mjs" $target status
  if ($LASTEXITCODE -ne 0) { throw 'The current worker state could not be checked.' }
  if (($workerState | ConvertFrom-Json).running) { Write-Output 'The onboarding worker is already running.'; exit 0 }
  & docker exec -d $Container node "$target/run-pull-worker.mjs" --config "$target/worker.json" --run
  if ($LASTEXITCODE -ne 0) { throw 'The worker could not start.' }
  Write-Output 'Worker start requested. Confirm the heartbeat in the public Connections page. No inquiry was executed by the check.'
}

param([ValidateSet('status','prepare','install')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$crmPhotosRoot = Split-Path -Parent $PSScriptRoot
$crmPhotosNode = Get-Command node -ErrorAction SilentlyContinue
if ($crmPhotosNode) { $crmPhotosExecutable = $crmPhotosNode.Source }
else { $crmPhotosExecutable = Join-Path $crmPhotosRoot '.local-tools\node-v22.23.3-win-x64\node.exe' }
& $crmPhotosExecutable (Join-Path $PSScriptRoot 'setup-customer-photos.mjs') $Action
exit $LASTEXITCODE

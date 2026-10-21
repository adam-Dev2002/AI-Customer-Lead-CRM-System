param(
    [ValidateSet('leads', 'catalog')]
    [string]$Template = 'leads',
    [int]$Port = 0,
    [switch]$Production
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$relativeAppPath = if ($Template -eq 'catalog') { 'home' } else { 'templates\leads' }
$appDirectory = Join-Path $projectRoot $relativeAppPath
if ($Port -eq 0) {
    $Port = if ($Template -eq 'catalog') { 3000 } else { 3001 }
}
if ($Production -and (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
    throw "Port $Port is already in use. Stop that preview before building and starting production mode."
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodeExecutable = $nodeCommand.Source
} else {
    $toolsDirectory = Join-Path $projectRoot '.local-tools'
    $portableRuntime = Get-ChildItem -LiteralPath $toolsDirectory -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
        Sort-Object { [version]($_.Name -replace '^node-v', '' -replace '-win-x64$', '') } -Descending |
        Select-Object -First 1
    if (-not $portableRuntime) {
        throw 'Node.js is required. Install Node.js or restore the project-local portable runtime.'
    }
    $nodeExecutable = Join-Path $portableRuntime.FullName 'node.exe'
}

$nextExecutable = Join-Path $appDirectory 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $nextExecutable)) {
    throw "Dependencies are missing in $relativeAppPath. See LOCAL_DEVELOPMENT.md."
}

$previousPath = $env:PATH
$env:PATH = "$(Split-Path -Parent $nodeExecutable);$previousPath"
Push-Location -LiteralPath $appDirectory
try {
    if ($Production) {
        & $nodeExecutable $nextExecutable build
        if ($LASTEXITCODE -ne 0) { throw 'The production build failed. The server was not started.' }
        & $nodeExecutable $nextExecutable start --hostname 127.0.0.1 --port $Port
    } else {
        & $nodeExecutable $nextExecutable dev --hostname 127.0.0.1 --port $Port
    }
    $serverExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $env:PATH = $previousPath
}
exit $serverExitCode

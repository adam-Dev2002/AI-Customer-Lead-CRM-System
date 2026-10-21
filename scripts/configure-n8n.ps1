param([switch]$CopyToken)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot 'templates\leads\.env.local'
$content = if (Test-Path -LiteralPath $envFile) { [IO.File]::ReadAllText($envFile) } else { '' }
$match = [regex]::Match($content, '(?m)^N8N_WEBHOOK_SECRET=([^\r\n]+)')
if ($match.Success -and $match.Groups[1].Value.Trim()) {
    $token = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
} else {
    $bytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    $content = [regex]::Replace($content, '(?m)^N8N_WEBHOOK_SECRET=[^\r\n]*\r?\n?', '')
    [IO.File]::WriteAllText($envFile, $content.TrimEnd() + "`r`nN8N_WEBHOOK_SECRET=$token`r`n", (New-Object Text.UTF8Encoding($false)))
}
Write-Output "CRM token configured in $envFile (ignored by Git)."
Write-Output 'Docker CRM base URL: http://host.docker.internal:3001'
Write-Output 'Restart the CRM server if it does not automatically reload the environment file.'
if ($CopyToken) {
    Set-Clipboard -Value "Bearer $token"
    Write-Output 'Authorization header value copied. Paste it into an n8n HTTP Header Auth credential.'
} else {
    Write-Output 'Run this script with -CopyToken to copy the Authorization header value for n8n.'
}

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $secretsFile = '.dev.vars.production'
    if (!(Test-Path $secretsFile) -or !(Select-String -Quiet -Path $secretsFile -Pattern '^DISK_TOKEN=')) {
        Start-Process 'https://oauth.yandex.ru/authorize?response_type=token&client_id=08e5ad7d9d504d7f81a8fc16e6fa3493'
        python accounts.py
        if ($LASTEXITCODE -ne 0) { throw 'Kalendare account setup failed.' }
    }
    if (!(Select-String -Quiet -Path $secretsFile -Pattern '^DISK_TOKEN=')) {
        throw 'The Yandex Disk token is still missing.'
    }

    $identity = npx --yes wrangler@4 whoami --json | Out-String | ConvertFrom-Json
    if (!$identity.loggedIn) {
        npx --yes wrangler@4 login --scopes account:read user:read workers_scripts:write --no-use-keyring
        if ($LASTEXITCODE -ne 0) { throw 'Cloudflare authorization did not complete.' }
    }
    Write-Host 'Configuration is ready. Tell Codex to verify Workers Free and deploy.'
} finally {
    Pop-Location
}

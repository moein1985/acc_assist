$remoteScript = @"
`$ErrorActionPreference = 'Continue'
`$logFile = 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log'

# Stop existing app
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# Start app with debug server enabled
`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
`$env:ACC_AGENT_DEBUG_TOKEN = 'fieldtest26'
Start-Process 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'
Start-Sleep -Seconds 15

# Verify debug server is listening
`$listening = netstat -an | findstr '3322'
Write-Host "DEBUG_SERVER: `$listening"

if (-not `$listening) {
    Write-Host "ERROR: Debug server not listening on 3322"
    exit 1
}

`$token = 'fieldtest26'
`$questions = @(
    @{ id = 'q1'; prompt = 'What were total sales in 1402?' },
    @{ id = 'q2'; prompt = 'Show me the balance sheet for 1402' },
    @{ id = 'q3'; prompt = 'Cash and bank balance 1402' },
    @{ id = 'q4'; prompt = 'total expenses 1402' },
    @{ id = 'q5'; prompt = 'total purchases 1402' },
    @{ id = 'q6'; prompt = 'receivables 1402' },
    @{ id = 'q7'; prompt = 'party turnover Mohseni 1402' },
    @{ id = 'q8'; prompt = 'how many employees does the company have?' },
    @{ id = 'q9'; prompt = 'weather in Tehran' },
    @{ id = 'q10'; prompt = 'net profit 1402' }
)

foreach (`$q in `$questions) {
    `$body = @{ prompt = `$q.prompt; conversationId = 'field-test-26' } | ConvertTo-Json
    try {
        `$resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3322/ask' -Method Post -ContentType 'application/json' -Headers @{ 'x-debug-token' = `$token } -Body `$body -TimeoutSec 60
        `$ok = `$resp.ok
        `$result = `$resp.result
        `$requestId = `$resp.requestId
        `$finalText = ''
        if (`$result -and `$result.finalText) { `$finalText = `$result.finalText }
        elseif (`$result -and `$result.message) { `$finalText = `$result.message }
        if (`$finalText -and `$finalText.Length -gt 150) { `$finalText = `$finalText.Substring(0, 150) }
        Write-Host "`$(`$q.id)|ok=`$ok|reqId=`$requestId|text=`$finalText"
    } catch {
        Write-Host "`$(`$q.id)|ERROR|`$(`$_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
}

Write-Host ''
Write-Host '--- AUDIT LOG (last 40 lines) ---'
Get-Content `$logFile -Tail 40

# Stop app
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
"@

$remoteScriptFile = "$env:TEMP\field-test-26-remote.ps1"
$remoteScript | Out-File -FilePath $remoteScriptFile -Encoding ASCII

pscp -P 2211 -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" $remoteScriptFile administrator@192.168.85.56:"C:\Users\Administrator\field-test-26-remote.ps1"

plink -P 2211 -ssh -batch -hostkey "ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ" -pw "Hs-co@12321#" administrator@192.168.85.56 "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\Administrator\field-test-26-remote.ps1"

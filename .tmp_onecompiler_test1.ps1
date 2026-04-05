$apiKey = "igniteinnovationst6razmwdjmhw0dvbie3jwftx5j0g8xw1fc63c1ibhe9wgqjbk18o3evl3vorutcr5ds1faxqn8xum7rg24g2apdrvdozt5aw"
$headers = @{ 'X-API-Key' = $apiKey; 'Content-Type' = 'application/json' }
$summary = @()

try {
  $langResp = Invoke-RestMethod -Method Get -Uri 'https://onecompiler.com/api/v1/languages'
  $langCount = if ($langResp -is [System.Array]) { $langResp.Count } elseif ($langResp.languages) { $langResp.languages.Count } else { 0 }
  $summary += [pscustomobject]@{ api = 'GET /api/v1/languages'; ok = $true; note = "languages_count=$langCount" }
} catch {
  $summary += [pscustomobject]@{ api = 'GET /api/v1/languages'; ok = $false; note = $_.Exception.Message }
}

$runBody = @{
  language = 'python'
  stdin = 'Peter'
  files = @(@{ name = 'main.py'; content = "import sys`nname=sys.stdin.readline().strip()`nprint('Hello '+name)" })
} | ConvertTo-Json -Depth 10

try {
  $runResp = Invoke-RestMethod -Method Post -Uri 'https://api.onecompiler.com/v1/run' -Headers $headers -Body $runBody
  $stdout = [string]$runResp.stdout
  $summary += [pscustomobject]@{ api = 'POST /v1/run'; ok = ($runResp.status -eq 'success'); note = "status=$($runResp.status); stdout=$($stdout.Replace("`n",'\\n'))" }
} catch {
  $summary += [pscustomobject]@{ api = 'POST /v1/run'; ok = $false; note = $_.Exception.Message }
}

$batchBody = @{
  language = 'python'
  stdin = @('Peter', 'Brian')
  files = @(@{ name = 'main.py'; content = "import sys`nname=sys.stdin.readline().strip()`nprint('Hello '+name)" })
} | ConvertTo-Json -Depth 10

try {
  $batchResp = Invoke-RestMethod -Method Post -Uri 'https://api.onecompiler.com/v1/run' -Headers $headers -Body $batchBody
  $batchCount = if ($batchResp -is [System.Array]) { $batchResp.Count } else { 0 }
  $summary += [pscustomobject]@{ api = 'POST /v1/run (batch)'; ok = ($batchCount -gt 0); note = "responses=$batchCount" }
} catch {
  $summary += [pscustomobject]@{ api = 'POST /v1/run (batch)'; ok = $false; note = $_.Exception.Message }
}

$badBody = @{
  language = 'xyz'
  stdin = 'test'
  files = @(@{ name = 'main.xyz'; content = 'hello' })
} | ConvertTo-Json -Depth 10

try {
  $badResp = Invoke-RestMethod -Method Post -Uri 'https://api.onecompiler.com/v1/run' -Headers $headers -Body $badBody
  $isExpected = ($badResp.status -eq 'failed' -or ([string]$badResp.error -match 'unsupported language'))
  $summary += [pscustomobject]@{ api = 'POST /v1/run (invalid language)'; ok = $isExpected; note = "status=$($badResp.status); error=$($badResp.error)" }
} catch {
  $summary += [pscustomobject]@{ api = 'POST /v1/run (invalid language)'; ok = $false; note = $_.Exception.Message }
}

$summary | ConvertTo-Json -Depth 5

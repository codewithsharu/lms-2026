$apiKey = "igniteinnovationst6razmwdjmhw0dvbie3jwftx5j0g8xw1fc63c1ibhe9wgqjbk18o3evl3vorutcr5ds1faxqn8xum7rg24g2apdrvdozt5aw"
$body = @{ type = 'challengesCountByUsers'; filters = @{ challengeIds = @(); userIds = @() } } | ConvertTo-Json -Depth 10

try {
  $resp = Invoke-WebRequest -Method Post -Uri "https://api.onecompiler.com/v1/reports?access_token=$apiKey" -ContentType 'application/json' -Body $body -UseBasicParsing
  Write-Output ("HTTP:" + $resp.StatusCode)
  Write-Output $resp.Content
} catch {
  if ($_.Exception.Response) {
    $r = $_.Exception.Response
    Write-Output ("HTTP:" + [int]$r.StatusCode)
    $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
    $sr.BaseStream.Position = 0
    $sr.DiscardBufferedData()
    Write-Output $sr.ReadToEnd()
  } else {
    Write-Output $_.Exception.Message
  }
}

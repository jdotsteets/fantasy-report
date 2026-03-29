$ErrorActionPreference = "Stop"

$extensions = @(
  ".ts", ".tsx", ".js", ".jsx",
  ".json", ".md", ".css", ".scss",
  ".sql", ".yml", ".yaml"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$fixed = @()

Get-ChildItem -Path . -Recurse -File | Where-Object {
  $extensions -contains $_.Extension.ToLower()
} | ForEach-Object {
  $path = $_.FullName
  $bytes = [System.IO.File]::ReadAllBytes($path)

  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
    $fixed += $path
  }
}

if ($fixed.Count -gt 0) {
  Write-Host ""
  Write-Host "Removed UTF-8 BOM from:" -ForegroundColor Yellow
  $fixed | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host "No BOM issues found." -ForegroundColor Green
}
$ErrorActionPreference = "Stop"

$extensions = @(
  ".ts", ".tsx", ".js", ".jsx",
  ".json", ".md", ".css", ".scss",
  ".sql", ".yml", ".yaml"
)

$bad = @()

Get-ChildItem -Path . -Recurse -File | Where-Object {
  $extensions -contains $_.Extension.ToLower()
} | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    $bad += $_.FullName
  }
}

if ($bad.Count -gt 0) {
  Write-Host ""
  Write-Host "Files with UTF-8 BOM found:" -ForegroundColor Red
  $bad | ForEach-Object { Write-Host " - $_" }
  exit 1
}

Write-Host "No UTF-8 BOM found." -ForegroundColor Green
exit 0
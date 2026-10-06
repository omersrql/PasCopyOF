$env:TAURI_SIGNING_PRIVATE_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5ClJXUlRZMEl5anpBTWNJZndjQjlXWW9uelBtRXF5TjBYNC9wT3hBcEx5L1lYRENZSWlSMEFBQkFBQUFBQUFBQUFBQUlBQUFBQVBIbnBzbFEwdHpHV0N2QmM5K0tucEIwaUZJOW85YnNPUFhZYzVkTU1WZ0hWYm9MYnVtRDNiZ2thd0E2cjl6WHkwVmF5bzZqS1dVTEcyaUdtaVA3b0ZrYWVGSlRuaVI4dFdMU2JPeGNYZG16MHdLVGtFQ0p3RHgxZ3ppeTM1M1R2VzVoSFhzOUVlOTg9Cg=="
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "pascopyof"

# 1. Tauri konfigürasyonundan sürüm bilgisini al
$tauriConf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $tauriConf.version
Write-Host ">>> PasCopyOf v$version derleniyor..." -ForegroundColor Cyan

# 2. Tauri build çalıştır
npm run tauri build -- --bundles nsis

if ($LASTEXITCODE -ne 0) {
    Write-Host "Derleme sirasinda hata olustu!" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. release-v<version> klasörünü oluştur ve dosyaları kopyala
$releaseDir = "release-v$version"
if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
}

$nsisDir = "src-tauri\target\release\bundle\nsis"
$setupExe = "PasCopyOf_${version}_x64-setup.exe"
$updaterZip = "PasCopyOf_${version}_x64-setup.nsis.zip"
$updaterSig = "PasCopyOf_${version}_x64-setup.nsis.zip.sig"

Copy-Item "$nsisDir\$setupExe" "$releaseDir\$setupExe" -Force
Copy-Item "$nsisDir\$updaterZip" "$releaseDir\$updaterZip" -Force
Copy-Item "$nsisDir\$updaterSig" "$releaseDir\$updaterSig" -Force

# 4. latest.json oluştur
$sigContent = Get-Content "$nsisDir\$updaterSig" -Raw
$nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJsonContent = @"
{
  "version": "v$version",
  "notes": "PasCopyOf v$version surumu yayinlandi.",
  "pub_date": "$nowIso",
  "platforms": {
    "windows-x86_64": {
      "signature": "$($sigContent.Trim())",
      "url": "https://github.com/omersrql/PasCopyOF/releases/download/v$version/$updaterZip"
    }
  }
}
"@
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("$releaseDir\latest.json", $latestJsonContent, $utf8NoBom)
[System.IO.File]::WriteAllText("$nsisDir\latest.json", $latestJsonContent, $utf8NoBom)

Write-Host ">>> Basariyla tamamlandi! Ciktilar '$releaseDir' klasorunde hazir." -ForegroundColor Green
explorer.exe $releaseDir

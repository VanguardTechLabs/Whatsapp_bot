<#
  Se ejecuta despues de cada emision Y de cada renovacion automatica.

  simple-acme deja los ficheros con el nombre del dominio delante. Aqui se
  copian a los nombres fijos que usa nginx/asistente.conf, se le da permiso de
  lectura a SYSTEM (nginx corre como SYSTEM y no hereda los permisos de esta
  carpeta) y se reinicia nginx.
#>
$ErrorActionPreference = 'Continue'

$Proyecto = Split-Path -Parent $PSScriptRoot
$SSL      = 'C:\nginx\conf\ssl\asistente'

$fDominio = Join-Path $PSScriptRoot 'dominio.txt'
if (-not (Test-Path $fDominio)) { Write-Host "Falta $fDominio"; exit 1 }
$DOMINIO = (Get-Content $fDominio -Raw).Trim()

$chain = Join-Path $SSL "$DOMINIO-chain.pem"
$key   = Join-Path $SSL "$DOMINIO-key.pem"
if (-not (Test-Path $chain)) { Write-Host "Falta $chain"; exit 1 }
if (-not (Test-Path $key))   { Write-Host "Falta $key";   exit 1 }

Copy-Item $chain "$SSL\fullchain.pem" -Force
Copy-Item $key   "$SSL\privkey.pem"   -Force

icacls "$SSL\fullchain.pem" /grant 'NT AUTHORITY\SYSTEM:(R)' | Out-Null
icacls "$SSL\privkey.pem"   /grant 'NT AUTHORITY\SYSTEM:(R)' | Out-Null

# Antes de tocar nada: si la configuracion no es valida, no se reinicia nginx.
# Un nginx caido se lleva por delante tambien el radar y el MQTT.
$prueba = & 'C:\nginx\nginx.exe' -t -p 'C:\nginx\' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "nginx -t fallo, no se reinicia:"
    $prueba | ForEach-Object { Write-Host "    $_" }
    exit 1
}

# `reload` no puede senalizar a un nginx que corre como SYSTEM desde aqui,
# asi que se para y se vuelve a lanzar, igual que hace el del IoT.
Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'nginx' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
if (-not (Get-Process nginx -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'C:\nginx\nginx.exe' -ArgumentList '-p','C:\nginx\' -WorkingDirectory 'C:\nginx'
}
Write-Host ('procesos nginx: ' + @(Get-Process nginx -ErrorAction SilentlyContinue).Count)

<#
  Pide a Let's Encrypt un certificado de verdad para el dominio del asistente,
  lo instala y deja registrada la renovacion automatica.

  TIENE QUE EJECUTARSE COMO ADMINISTRADOR.

      powershell -ExecutionPolicy Bypass -File servidor\get-cert.ps1
      powershell -ExecutionPolicy Bypass -File servidor\get-cert.ps1 -Email "tu@correo.com"

  Requisitos, todos comprobados abajo:
    - el dominio tiene que resolver a la IP publica de este PC
    - el puerto 80 tiene que llegar desde internet (es como valida Let's Encrypt)
    - nginx tiene que estar sirviendo ya el bloque :80 del dominio
#>
param([string]$Email = '')

$ErrorActionPreference = 'Continue'

$SSL     = 'C:\nginx\conf\ssl\asistente'
$WEBROOT = 'C:\nginx\html\acme'
$WACS    = 'C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\simple-acme.simple-acme_Microsoft.Winget.Source_8wekyb3d8bbwe\wacs.exe'

$fDominio = Join-Path $PSScriptRoot 'dominio.txt'
if (-not (Test-Path $fDominio)) {
    Write-Host "Falta $fDominio. Ejecuta antes servidor\instalar.ps1 -Dominio ..." -ForegroundColor Red
    exit 1
}
$DOMINIO = (Get-Content $fDominio -Raw).Trim()

if (-not ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'No estas como Administrador. Abre PowerShell como administrador.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $WACS)) {
    Write-Host "No encuentro wacs.exe en $WACS" -ForegroundColor Red
    Write-Host 'Instalalo con:  winget install simple-acme.simple-acme' -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Path $SSL     -Force | Out-Null
New-Item -ItemType Directory -Path $WEBROOT -Force | Out-Null

Write-Host "`n[1] comprobaciones previas para $DOMINIO" -ForegroundColor Cyan
try {
    $ips = (Resolve-DnsName -Name $DOMINIO -Type A -ErrorAction Stop).IPAddress
    Write-Host "    DNS: $($ips -join ', ')"
} catch {
    Write-Host "    El dominio no resuelve. Creala en duckdns.org antes de seguir." -ForegroundColor Red
    exit 1
}

# Se deja un fichero de prueba en el webroot y se pide desde fuera: si no
# vuelve, Let's Encrypt tampoco va a poder y conviene saberlo ahora.
$testigo = 'prueba-' + [guid]::NewGuid().ToString('N').Substring(0,8)
New-Item -ItemType Directory -Path (Join-Path $WEBROOT '.well-known\acme-challenge') -Force | Out-Null
Set-Content -Path (Join-Path $WEBROOT ".well-known\acme-challenge\$testigo") -Value 'ok' -Encoding ascii
try {
    $r = Invoke-WebRequest -Uri "http://$DOMINIO/.well-known/acme-challenge/$testigo" -TimeoutSec 20 -UseBasicParsing
    if ($r.Content.Trim() -eq 'ok') { Write-Host '    Puerto 80 alcanzable desde internet: OK' -ForegroundColor Green }
    else { Write-Host "    Respuesta inesperada: $($r.Content)" -ForegroundColor Yellow }
} catch {
    Write-Host "    El puerto 80 no llega: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '    Revisa el router (redireccion del 80) y el firewall antes de seguir.' -ForegroundColor Yellow
    exit 1
}

Write-Host "`n[2] pidiendo el certificado" -ForegroundColor Cyan
$a = @(
    '--target','manual','--host',$DOMINIO,
    '--validation','filesystem','--webroot',$WEBROOT,
    '--store','pemfiles','--pemfilespath',$SSL,
    '--installation','script','--script',(Join-Path $PSScriptRoot 'install-cert.ps1'),
    '--accepttos','--verbose'
)
if ($Email) { $a += @('--emailaddress',$Email) }
& $WACS @a
Write-Host "    codigo de salida de wacs: $LASTEXITCODE"

Write-Host "`n[3] lo que nginx esta sirviendo ahora" -ForegroundColor Cyan
Get-ChildItem $SSL -ErrorAction SilentlyContinue | Format-Table Name,Length,LastWriteTime -AutoSize
& 'C:\nginx\nginx.exe' -t -p 'C:\nginx\' 2>&1 | ForEach-Object { Write-Host "    $_" }

Write-Host "`n[4] renovacion automatica" -ForegroundColor Cyan
# Sin esto el certificado caduca a los 90 dias y la pagina deja de abrirse.
# Pedirlo no basta: simple-acme guarda la renovacion, pero si nadie ha creado
# la tarea programada nunca llega a ejecutarla.
$tareaAcme = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'acme|simple' }
if (-not $tareaAcme) {
    Write-Host '    no habia tarea de renovacion; creandola' -ForegroundColor Yellow
    & $WACS '--setuptaskscheduler'
    $tareaAcme = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'acme|simple' }
}
if ($tareaAcme) {
    $tareaAcme | Format-Table TaskName,State -AutoSize
} else {
    Write-Host '    SIGUE SIN TAREA DE RENOVACION.' -ForegroundColor Red
    Write-Host '    El certificado caducara en 90 dias. Crea la tarea con:' -ForegroundColor Red
    Write-Host "        & '$WACS' --setuptaskscheduler" -ForegroundColor Yellow
}

Write-Host "`nHecho. Entra en https://$DOMINIO" -ForegroundColor Green

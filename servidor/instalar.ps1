<#
  Monta el asistente en el nginx que ya corre en este PC.

  TIENE QUE EJECUTARSE COMO ADMINISTRADOR (reinicia nginx y registra una
  tarea programada).

      powershell -ExecutionPolicy Bypass -File servidor\instalar.ps1 -Dominio maiko-asistente.duckdns.org

  Que hace, en orden:
    1. guarda el dominio en servidor\dominio.txt
    2. genera nginx\asistente.conf a partir de la plantilla
    3. anade el `include` al nginx.conf del sistema (con copia de seguridad)
    4. comprueba la configuracion ANTES de tocar nginx
    5. arranca la aplicacion y reinicia nginx
    6. registra la tarea que la mantiene viva

  Lo que NO hace: pedir el certificado. Eso es servidor\get-cert.ps1, que se
  lanza despues, cuando el bloque :80 ya esta sirviendo. Hasta entonces nginx
  usa un certificado autofirmado de arranque y el navegador avisara.
#>
param(
    [Parameter(Mandatory = $true)][string]$Dominio,
    [int]$Puerto = 0
)

$ErrorActionPreference = 'Continue'

$Proyecto  = Split-Path -Parent $PSScriptRoot
$NginxConf = 'C:\nginx\conf\nginx.conf'
$NginxExe  = 'C:\nginx\nginx.exe'
$SSL       = 'C:\nginx\conf\ssl\asistente'
$Tarea     = 'Asistente-Vigilante'

# nginx quiere barras normales, tambien en Windows.
$ProyectoNginx = $Proyecto -replace '\\', '/'

function Aviso($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

# Escribir SIEMPRE sin BOM: nginx no arranca si el fichero empieza por uno.
function EscribirSinBom($ruta, $texto) {
    [System.IO.File]::WriteAllText($ruta, $texto, (New-Object System.Text.UTF8Encoding($false)))
}

$soyAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $soyAdmin) {
    Aviso 'No estas como Administrador. Abre PowerShell como administrador y repite.' 'Red'
    exit 1
}

if ($Dominio -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$') {
    Aviso "Ese dominio no tiene buena pinta: $Dominio" 'Red'
    exit 1
}

# --- puerto: del .env, salvo que se pase a mano ---------------------------
if ($Puerto -eq 0) {
    $Puerto = 3010
    $fEnv = Join-Path $Proyecto '.env'
    if (Test-Path $fEnv) {
        $m = Select-String -Path $fEnv -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
        if ($m) { $Puerto = [int]$m.Matches[0].Groups[1].Value }
    }
}
Aviso ''
Aviso "=== Asistente -> $Dominio  (aplicacion en 127.0.0.1:$Puerto) ===" 'Cyan'

# --- 1. dominio ------------------------------------------------------------
EscribirSinBom (Join-Path $PSScriptRoot 'dominio.txt') $Dominio
Aviso '[1] dominio guardado' 'Green'

# --- 2. configuracion de nginx del proyecto -------------------------------
$plantilla = Join-Path $Proyecto 'nginx\asistente.conf.plantilla'
$destino   = Join-Path $Proyecto 'nginx\asistente.conf'
if (-not (Test-Path $plantilla)) { Aviso "Falta $plantilla" 'Red'; exit 1 }

$texto = (Get-Content $plantilla -Raw).Replace('__DOMINIO__', $Dominio).Replace('__PROYECTO__', $ProyectoNginx).Replace('__PUERTO__', [string]$Puerto).Replace('__SSL__', ($SSL -replace '\\', '/'))
EscribirSinBom $destino $texto
Aviso '[2] generado nginx\asistente.conf' 'Green'

# --- 3. include en el nginx.conf del sistema ------------------------------
New-Item -ItemType Directory -Path $SSL -Force | Out-Null
if (-not (Test-Path "$SSL\fullchain.pem")) {
    Aviso "    Falta el certificado de arranque en $SSL" 'Red'
    Aviso '    Genera uno autofirmado o lanza get-cert.ps1 antes.' 'Yellow'
    exit 1
}

$linea = "    include $ProyectoNginx/nginx/asistente.conf;"
$conf  = Get-Content $NginxConf -Raw

if ($conf -match [regex]::Escape("$ProyectoNginx/nginx/asistente.conf")) {
    Aviso '[3] el include ya estaba puesto' 'Green'
} else {
    $copia = "$NginxConf.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $NginxConf $copia -Force
    Aviso "[3] copia de seguridad: $copia"

    # Se ancla en una linea que solo existe dentro del bloque http{}, para no
    # acabar insertando el include en stream{} o fuera de todo.
    $ancla = '    limit_req_zone $binary_remote_addr zone=radar_login:10m rate=12r/m;'
    if ($conf -notmatch [regex]::Escape($ancla)) {
        Aviso '    No encuentro el ancla dentro de http{}. Anade a mano, dentro de http{}:' 'Red'
        Aviso "        $linea" 'Yellow'
        exit 1
    }
    $salto  = [char]13 + [char]10
    $bloque = $ancla + $salto + $salto + '    # --- Asistente Maiko -------------------------------------------' + $salto + $linea
    EscribirSinBom $NginxConf ($conf.Replace($ancla, $bloque))
    Aviso '    include anadido' 'Green'
}

# --- 4. comprobar ANTES de tocar nada -------------------------------------
Aviso ''
Aviso '[4] comprobando la configuracion' 'Cyan'
$prueba = & $NginxExe -t -p 'C:\nginx\' 2>&1
$prueba | ForEach-Object { Aviso "    $_" }
if ($LASTEXITCODE -ne 0) {
    Aviso '    La configuracion no es valida. NO se reinicia nginx.' 'Red'
    Aviso '    nginx sigue como estaba; el radar y el MQTT no se han tocado.' 'Yellow'
    exit 1
}
Aviso '    configuracion valida' 'Green'

# --- 5. aplicacion y nginx -------------------------------------------------
Aviso ''
Aviso '[5] arrancando' 'Cyan'
& powershell.exe -ExecutionPolicy Bypass -NoProfile -File (Join-Path $PSScriptRoot 'arrancar.ps1')

Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
try { Start-ScheduledTask -TaskName 'nginx' -ErrorAction Stop } catch {}
Start-Sleep -Seconds 3
if (-not (Get-Process nginx -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $NginxExe -ArgumentList '-p', 'C:\nginx\' -WorkingDirectory 'C:\nginx'
    Start-Sleep -Seconds 2
}
Aviso ('    procesos nginx: ' + @(Get-Process nginx -ErrorAction SilentlyContinue).Count) 'Green'

# --- 6. que siga vivo tras un reinicio ------------------------------------
Aviso ''
Aviso '[6] tarea programada' 'Cyan'
# Va en su propio guion para poder repetirlo sin reiniciar nginx otra vez.
& powershell.exe -ExecutionPolicy Bypass -NoProfile -File (Join-Path $PSScriptRoot 'tarea.ps1')
if ($LASTEXITCODE -ne 0) {
    Aviso '    La tarea no quedo registrada. La aplicacion funciona igual, pero' 'Red'
    Aviso '    no se levantara sola si se cae o si reinicias Windows. Reintenta con:' 'Red'
    Aviso '        powershell -ExecutionPolicy Bypass -File servidor\tarea.ps1' 'Yellow'
}

# --- resumen ---------------------------------------------------------------
Aviso ''
Aviso '--------------------------------------------------------------' 'Cyan'
Aviso 'Falta el certificado de verdad. Con el bloque :80 ya sirviendo:' 'Yellow'
Aviso '    powershell -ExecutionPolicy Bypass -File servidor\get-cert.ps1' 'Yellow'
Aviso "Hasta entonces https://$Dominio dara aviso de certificado." 'Yellow'
Aviso '--------------------------------------------------------------' 'Cyan'

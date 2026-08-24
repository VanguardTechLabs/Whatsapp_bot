<#
  Arranca el asistente si no esta ya en marcha.

  Pensado para lanzarse cada pocos minutos desde una tarea programada: si la
  aplicacion ya responde no hace nada, y si se ha caido la vuelve a levantar.
  Asi un fallo puntual no deja a Nayane sin herramienta hasta que alguien lo
  note a mano.

      powershell -ExecutionPolicy Bypass -File servidor\arrancar.ps1
#>
$ErrorActionPreference = 'Continue'

$Proyecto = Split-Path -Parent $PSScriptRoot
$Registro = Join-Path $Proyecto 'logs'
if (-not (Test-Path $Registro)) { New-Item -ItemType Directory -Path $Registro -Force | Out-Null }

$Bitacora = Join-Path $Registro ('arranque-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
function Nota($texto) {
    $linea = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
    Write-Host $linea
    Add-Content -Path $Bitacora -Value $linea -ErrorAction SilentlyContinue
}

# El puerto sale del .env, para no tener el numero escrito en dos sitios.
$Puerto = 3010
$env0 = Join-Path $Proyecto '.env'
if (Test-Path $env0) {
    $m = Select-String -Path $env0 -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $Puerto = [int]$m.Matches[0].Groups[1].Value }
}

$enUso = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
if ($enUso) {
    Nota "El asistente ya estaba en marcha (puerto $Puerto)"
    exit 0
}

if (-not (Test-Path (Join-Path $Proyecto 'node_modules'))) {
    Nota "Faltan las dependencias. Ejecuta: npm install"
    exit 1
}

Nota "Arrancando el asistente en el puerto $Puerto..."
$salida = Join-Path $Registro 'asistente.out.log'
$error0 = Join-Path $Registro 'asistente.err.log'

Start-Process -FilePath 'node.exe' `
    -ArgumentList 'server.js' `
    -WorkingDirectory $Proyecto `
    -WindowStyle Hidden `
    -RedirectStandardOutput $salida `
    -RedirectStandardError  $error0

$intentos = 0
while (-not (Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue) -and $intentos -lt 15) {
    Start-Sleep -Seconds 1
    $intentos++
}

if (Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue) {
    Nota "Listo: escuchando en 127.0.0.1:$Puerto"
    exit 0
}

Nota "NO arranco. Mira $error0"
exit 1

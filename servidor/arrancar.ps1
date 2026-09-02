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

# --- reinicio pedido a mano -------------------------------------------------
#
# La aplicacion la arranca esta tarea, que corre como SYSTEM. Eso esta bien
# para que sobreviva a un reinicio de Windows, pero deja un problema: despues
# de actualizar el codigo no se puede reiniciar sin abrir un PowerShell como
# administrador, porque un usuario normal no puede parar un proceso de SYSTEM.
#
# Con dejar un fichero `logs\reiniciar` basta: en la siguiente vuelta (como
# mucho cinco minutos) esta tarea lo ve, para la aplicacion y la vuelve a
# levantar con el codigo nuevo.
#
# Solo toca el proceso que escucha en NUESTRO puerto y que ademas es un node
# ejecutando server.js. En esta maquina hay otro node (el Crypto Radar, en el
# 3000), nginx y el broker MQTT: no se puede confundir con ninguno.
$Marca = Join-Path $Registro 'reiniciar'
if (Test-Path $Marca) {
    # Se borra ANTES de nada: si algo fallara despues, no queda un bucle de
    # reinicios cada cinco minutos.
    Remove-Item $Marca -Force -ErrorAction SilentlyContinue
    Nota "Reinicio pedido"

    foreach ($con in @(Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue)) {
        $proc = Get-Process -Id $con.OwningProcess -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.ProcessName -ne 'node') { continue }

        $linea = (Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($linea -notmatch 'server\.js') {
            Nota "  el proceso del puerto $Puerto no es el asistente, no se toca"
            continue
        }

        Nota "  parando el asistente (pid $($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
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

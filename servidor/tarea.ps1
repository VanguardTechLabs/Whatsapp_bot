<#
  Registra la tarea que mantiene viva la aplicacion.

  TIENE QUE EJECUTARSE COMO ADMINISTRADOR (la tarea corre como SYSTEM, para
  que arranque con Windows sin que nadie tenga que iniciar sesion).

      powershell -ExecutionPolicy Bypass -File servidor\tarea.ps1

  Va aparte de instalar.ps1 para poder repetirla sin volver a reiniciar nginx.
#>
$ErrorActionPreference = 'Continue'

$Tarea = 'Asistente-Vigilante'
$guion = Join-Path $PSScriptRoot 'arrancar.ps1'

function Aviso($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

$soyAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $soyAdmin) {
    Aviso 'No estas como Administrador. Abre PowerShell como administrador y repite.' 'Red'
    exit 1
}
if (-not (Test-Path $guion)) { Aviso "Falta $guion" 'Red'; exit 1 }

try { Unregister-ScheduledTask -TaskName $Tarea -Confirm:$false -ErrorAction Stop } catch {}

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File "' + $guion + '"')

# Al arrancar Windows, y ademas cada 5 minutos por si la aplicacion se cae.
#
# La duracion de la repeticion NO puede ser [TimeSpan]::MaxValue: se serializa
# como P99999999DT23H59M59S y el Programador de tareas lo rechaza con
# "The task XML contains a value which is incorrectly formatted or out of
# range". Diez anos son finitos, validos, y a efectos practicos para siempre.
$alInicio = New-ScheduledTaskTrigger -AtStartup
$cada5    = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

$quien   = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$comoSea = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger @($alInicio, $cada5) -Principal $quien -Settings $comoSea -Description 'Mantiene vivo el asistente de respuestas' -ErrorAction Stop | Out-Null
} catch {
    Aviso "No se pudo registrar la tarea: $($_.Exception.Message)" 'Red'
    exit 1
}

# Comprobar de verdad que existe, en vez de dar por hecho que salio bien.
$t = Get-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue
if (-not $t) {
    Aviso 'La tarea no aparece despues de registrarla.' 'Red'
    exit 1
}
Aviso "tarea '$Tarea' registrada y comprobada (estado: $($t.State))" 'Green'
Aviso '    se ejecuta al arrancar Windows y cada 5 minutos' 'Gray'
exit 0

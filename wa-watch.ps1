# Nimbo · WhatsApp de escritorio, SOLO LECTURA.
# Cada 10 s escribe una línea "wa:{json}" con:
#   title  → título de la ventana de WhatsApp ("(3) WhatsApp" = 3 chats sin leer; "" = cerrada)
#   access → si se pueden leer notificaciones: lo activaste en Nimbo (NIMBO_WA_READ=1) y
#            Windows lo permite (Configuración > Privacidad > Notificaciones)
#   msgs   → las notificaciones de WhatsApp que siguen en el centro de notificaciones
# Usa la API oficial de Windows (UserNotificationListener): no abre la sesión de WhatsApp,
# no lee chats ni envía nada. Solo ve lo mismo que tú ves en el centro de notificaciones.
# Lo lanza whatsapp.js; si Nimbo se cierra, la escritura falla y el bucle termina solo.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
$runtime = [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')
$asTask = $runtime.GetType('System.WindowsRuntimeSystemExtensions').GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
# Espera una operación asíncrona de WinRT (PowerShell 5.1 no tiene await).
function Wait-WinRT($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(8000)) { throw 'tiempo agotado' }
  $task.Result
}

$listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
$access = $false
# Leer notificaciones es opcional: Nimbo solo lo pide si lo activaste en su menú.
if ($env:NIMBO_WA_READ -eq '1') { try {
  $status = $listener.GetAccessStatus()
  # La primera vez Windows pregunta si deja que esta app lea notificaciones.
  if ("$status" -eq 'Unspecified') {
    $status = Wait-WinRT ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
  }
  $access = "$status" -eq 'Allowed'
} catch {} }

while ($true) {
  $title = ''
  try {
    $title = "$((Get-Process | Where-Object { $_.MainWindowTitle -match '^(\(\d+\)\s*)?WhatsApp$' } | Select-Object -First 1).MainWindowTitle)"
  } catch {}
  $msgs = @()
  if ($access) {
    try {
      $all = Wait-WinRT ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
      foreach ($n in $all) {
        try {
          if ("$($n.AppInfo.AppUserModelId)" -notmatch 'WhatsApp') { continue }
          $texts = @($n.Notification.Visual.GetBinding('ToastGeneric').GetTextElements() | ForEach-Object { "$($_.Text)" })
          $msgs += @{ id = [int64]$n.Id; t = $n.CreationTime.ToUnixTimeMilliseconds(); texts = $texts }
        } catch {}
      }
    } catch {}
  }
  $line = @{ title = $title; access = $access; msgs = @($msgs) } | ConvertTo-Json -Compress -Depth 4
  try { [Console]::Out.WriteLine('wa:' + $line); [Console]::Out.Flush() } catch { break }
  Start-Sleep -Seconds 10
}

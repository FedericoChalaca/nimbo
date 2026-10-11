# Nimbo · lo que suena en Spotify, y sus botones (pausa, siguiente, anterior).
# Usa los controles multimedia de Windows (los mismos de las teclas de música y del panel de
# volumen): no necesita cuenta, claves ni Premium, y no toca tu sesión de Spotify.
# Cada vez que algo cambia escribe una línea "media:{json}" con title, artist, album, playing y
# art (la carátula como data: URI); "media:null" si Spotify no tiene nada cargado.
# Lee órdenes por la entrada estándar, una por línea: toggle, next, prev.
# Lo lanza media.js; cuando Nimbo se cierra, la entrada se acaba y el bucle termina solo.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$runtime = [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')
$asTask = $runtime.GetType('System.WindowsRuntimeSystemExtensions').GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
# Espera una operación asíncrona de WinRT (PowerShell 5.1 no tiene await).
function Wait-WinRT($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(5000)) { throw 'tiempo agotado' }
  $task.Result
}

$manager = Wait-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
function Get-Spotify { $manager.GetSessions() | Where-Object { "$($_.SourceAppUserModelId)" -match 'spotify' } | Select-Object -First 1 }

# La carátula (PNG o JPEG de 300 px), como data: URI. Vacío si no hay o pesa demasiado.
# PowerShell 5.1 no sabe convertir el flujo de WinRT: se hace por reflexión, como con AsTask.
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
function Get-Art($props) {
  try {
    if (-not $props.Thumbnail) { return '' }
    $stream = Wait-WinRT ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $memory = New-Object System.IO.MemoryStream
    $asStream.Invoke($null, @($stream)).CopyTo($memory)
    $bytes = $memory.ToArray()
    if ($bytes.Length -lt 4 -or $bytes.Length -gt 400KB) { return '' }
    $type = if ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { 'png' } elseif ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { 'jpeg' } else { return '' }
    "data:image/$type;base64,$([Convert]::ToBase64String($bytes))"
  } catch { '' }
}

# Console.In lee de forma síncrona (su ReadLineAsync bloquea): se lee el flujo crudo.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$orders = $stdin.ReadLineAsync()
$last = ''
$tick = 0
$eager = 0
$track = ''
$art = ''
$artLeft = 0
while ($true) {
  if ($orders.IsCompleted) {
    $order = $orders.Result
    if ($null -eq $order) { break } # Nimbo se cerró
    $orders = $stdin.ReadLineAsync()
    try {
      $s = Get-Spotify
      if ($s) {
        if ($order -eq 'toggle') { $null = Wait-WinRT ($s.TryTogglePlayPauseAsync()) ([bool]) }
        elseif ($order -eq 'next') { $null = Wait-WinRT ($s.TrySkipNextAsync()) ([bool]) }
        elseif ($order -eq 'prev') { $null = Wait-WinRT ($s.TrySkipPreviousAsync()) ([bool]) }
      }
    } catch {}
    $eager = 8 # Spotify tarda un momento en reflejar el cambio: se mira seguido 2 s
  }
  # Se mira cada 2 s (8 vueltas de 250 ms); las órdenes se atienden en cada vuelta.
  if ($eager-- -gt 0 -or $tick++ % 8 -eq 0) {
    $json = 'null'
    try {
      $s = Get-Spotify
      if ($s) {
        $p = Wait-WinRT ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ("$($p.Title)") {
          # La carátula llega un poco después que el título: se relee en las 3 miradas que siguen
          # a un cambio de canción y después se reutiliza (leerla cada 2 s sería gasto de más).
          $key = "$($p.Title)|$($p.Artist)"
          if ($key -ne $track) { $track = $key; $artLeft = 3 }
          if ($artLeft-- -gt 0 -or -not $art) { $art = Get-Art $p }
          $json = @{ title = "$($p.Title)"; artist = "$($p.Artist)"; album = "$($p.AlbumTitle)"
            playing = "$($s.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing'; art = $art } | ConvertTo-Json -Compress
        }
      }
    } catch {}
    if ($json -ne $last) { $last = $json; [Console]::Out.WriteLine("media:$json") }
  }
  Start-Sleep -Milliseconds 250
}

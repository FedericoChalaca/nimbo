# "Oye Nimbo": escucha el micrófono con el reconocedor de voz de Windows (System.Speech, sin internet: el audio nunca sale del PC)
# y no transcribe nada: solo distingue las frases de activación (-Phrases). Escribe una línea JSON por evento:
#   {"ready":true,"culture":"es-ES"}   al arrancar
#   {"wake":true,"text":"oye nimbo","conf":0.66}   cuando oye la frase (y pasó la revisión)
#   {"error":"..."}   si no puede (sin reconocedor, sin micrófono)
#   {"cand":{...}}    cada posible llamada, aceptada o no, con lo que oyó cada paso (Nimbo arma con esto el historial de activaciones)
# -Wav <archivo>: lee de un .wav en vez del micrófono (para la autoprueba) e informa también lo que descartó ("near").
#
# Dos pasos, para que no se active solo:
#  1. Un reconocedor liviano (~1,6 % de un núcleo) con SOLO la frase cargada escucha todo el tiempo. Solo, encaja cualquier
#     sonido parecido en "oye nimbo" ("Hoy en el noticiero…" lo despertaba con 0,65 de confianza).
#  2. Cuando cree oírla, se revisa ESE pedacito de audio con otro reconocedor donde compiten la frase y el dictado general de
#     Windows: si lo que dijiste se parece más a cualquier otra frase, gana el dictado y se descarta. Tener el dictado
#     compitiendo todo el tiempo costaba ~38 % de un núcleo; así solo trabaja un instante cuando hay una posible llamada.
#  3. Lo hace Nimbo, no este script: el pedacito se guarda en -Clip y Whisper (voice.js) tiene que oír "nimbo" en él. Con un video
#     sonando, los pasos 1 y 2 aceptaban voces que no decían "nimbo" (2026-10-25: 8 activaciones solas en media hora). El dictado de
#     Windows solo no sirve para esto: con la frase de verdad escribe "Hoy el mismo", "Colaninno", "Hoy ánimo".
param(
  [string]$Culture = "es-ES",
  [string]$Phrases = "oye nimbo|hola nimbo",
  [double]$Min = 0.5,
  [double]$Candidate = 0.3, # confianza mínima del paso 1 para pedir la revisión
  [string]$Wav = "",
  [string]$Clip = "", # dónde guardar el pedacito de audio de cada llamada aceptada (.wav), para que Nimbo lo revise con Whisper
  [int]$Parent = 0, # el proceso de Nimbo: si ya no existe (lo cerraron a la fuerza), este también se cierra y suelta el micrófono
  [switch]$NoCheck # sin la revisión del paso 2 (solo para comparar en pruebas)
)
$ErrorActionPreference = "Stop"
function Say($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  # El idioma pedido; si no está, otro del mismo idioma (es-MX, es-ES…); si tampoco, no hay con qué escuchar.
  $info = $all | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1
  if (-not $info) { $info = $all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $Culture.Substring(0, 2) } | Select-Object -First 1 }
  if (-not $info) { Say @{ error = "no-recognizer" }; exit 1 }
  function WakeGrammar() {
    $choices = New-Object System.Speech.Recognition.Choices
    foreach ($p in $Phrases.Split("|")) { if ($p.Trim()) { $choices.Add($p.Trim()) } }
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $gb.Culture = $info.Culture
    $g = New-Object System.Speech.Recognition.Grammar($gb)
    $g.Name = "wake"
    return $g
  }
  $listen = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $listen.LoadGrammar((WakeGrammar))
  $check = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $check.LoadGrammar((WakeGrammar))
  $rival = New-Object System.Speech.Recognition.DictationGrammar
  $rival.Name = "rival"
  $check.LoadGrammar($rival)
  function Hear($engine, $audio) {
    $ms = New-Object System.IO.MemoryStream
    $audio.WriteToWaveStream($ms)
    $ms.Position = 0
    $engine.SetInputToWaveStream($ms)
    $res = $null
    try { $res = $engine.Recognize([TimeSpan]::FromSeconds(4)) } catch {}
    $engine.SetInputToNull()
    $ms.Dispose()
    return $res
  }
  if ($Wav) { $listen.SetInputToWaveFile($Wav) } else { $listen.SetInputToDefaultAudioDevice() }
  Say @{ ready = $true; culture = $info.Culture.Name }
  while ($true) {
    if ($Parent -and -not (Get-Process -Id $Parent -ErrorAction SilentlyContinue)) { break }
    try { $r = $listen.Recognize([TimeSpan]::FromSeconds(8)) } catch { if ($Wav) { break } else { Start-Sleep -Milliseconds 300; continue } }
    if (-not $r) { if ($Wav) { break } else { continue } } # silencio (o fin del archivo de prueba)
    if ($r.Confidence -lt $Candidate) { continue } # ni siquiera parecido: no se anota
    $conf1 = [math]::Round($r.Confidence, 2)
    if ($NoCheck) { if ($r.Confidence -ge $Min) { Say @{ wake = $true; text = $r.Text; conf = $conf1 } }; continue }
    # Paso 2: el mismo pedacito de audio, con el dictado compitiendo.
    $c = Hear $check $r.Audio
    $step2 = if ($c) { $c.Text } else { "" }
    $conf2 = if ($c) { [math]::Round($c.Confidence, 2) } else { 0 }
    $ok2 = $c -and $c.Grammar.Name -eq "wake" -and $c.Confidence -ge $Min
    $why = if ($ok2) { "" } elseif ($c -and $c.Grammar.Name -eq "wake") { "poca-confianza" } else { "otra-frase" }
    Say @{ cand = @{ step1 = $r.Text; conf1 = $conf1; step2 = $step2; conf2 = $conf2; ok = [bool]$ok2; why = $why } }
    if (-not $ok2) { continue }
    $clipped = $false
    if ($Clip) { try { $fs = [System.IO.File]::Create($Clip); $r.Audio.WriteToWaveStream($fs); $fs.Dispose(); $clipped = $true } catch {} }
    Say @{ wake = $true; text = $c.Text; conf = $conf2; clip = $clipped }
  }
} catch {
  Say @{ error = $_.Exception.Message }
  exit 1
}

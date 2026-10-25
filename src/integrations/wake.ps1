# "Oye Nimbo": escucha el micrófono con el reconocedor de voz de Windows (System.Speech, sin internet: el audio nunca sale del PC)
# y solo con una gramática cerrada (las frases de -Phrases): no transcribe nada más. Escribe una línea JSON por evento:
#   {"ready":true,"culture":"es-ES"}   al arrancar
#   {"wake":true,"text":"oye nimbo","conf":0.93}   cuando oye la frase con suficiente confianza
#   {"error":"..."}   si no puede (sin reconocedor, sin micrófono)
# -Wav <archivo>: lee de un .wav en vez del micrófono (para la autoprueba) e informa también lo que descartó ("near").
param(
  [string]$Culture = "es-ES",
  [string]$Phrases = "oye nimbo|hola nimbo",
  [double]$Min = 0.6,
  [string]$Wav = ""
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
  $eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $choices = New-Object System.Speech.Recognition.Choices
  foreach ($p in $Phrases.Split("|")) { if ($p.Trim()) { $choices.Add($p.Trim()) } }
  $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
  $gb.Culture = $info.Culture
  $eng.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gb)))
  if ($Wav) { $eng.SetInputToWaveFile($Wav) } else { $eng.SetInputToDefaultAudioDevice() }
  Say @{ ready = $true; culture = $info.Culture.Name }
  while ($true) {
    $r = $eng.Recognize([TimeSpan]::FromSeconds(8))
    if (-not $r) { if ($Wav) { break } else { continue } } # silencio (o fin del archivo de prueba)
    if ($r.Confidence -ge $Min) { Say @{ wake = $true; text = $r.Text; conf = [math]::Round($r.Confidence, 2) } }
    elseif ($Wav) { Say @{ near = $r.Text; conf = [math]::Round($r.Confidence, 2) } }
  }
} catch {
  Say @{ error = $_.Exception.Message }
  exit 1
}

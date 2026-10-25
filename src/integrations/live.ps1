# Texto en vivo mientras dictas: el dictado de Windows (System.Speech, sin internet) escribe lo que va oyendo, al instante, para que
# veas que te está entendiendo. Es solo una vista previa: el texto final lo hace Whisper (voice.js), que entiende mejor.
# Corre solo mientras dictas (lo cierra Nimbo, o se cierra solo a los -Max segundos o si Nimbo ya no existe).
#   {"ready":true}   ·   {"partial":"necesito que me digas"}   ·   {"error":"..."}
# -Wav <archivo>: lee de un .wav en vez del micrófono (para la autoprueba).
param(
  [string]$Culture = "es-ES",
  [int]$Max = 35,
  [int]$Parent = 0,
  [string]$Wav = ""
)
$ErrorActionPreference = "Stop"
function Say($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $info = $all | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1
  if (-not $info) { $info = $all | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $Culture.Substring(0, 2) } | Select-Object -First 1 }
  if (-not $info) { Say @{ error = "no-recognizer" }; exit 1 }
  $eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $eng.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  if ($Wav) { $eng.SetInputToWaveFile($Wav) } else { $eng.SetInputToDefaultAudioDevice() }
  Register-ObjectEvent -InputObject $eng -EventName SpeechHypothesized -SourceIdentifier hyp | Out-Null
  Register-ObjectEvent -InputObject $eng -EventName SpeechRecognized -SourceIdentifier rec | Out-Null
  Register-ObjectEvent -InputObject $eng -EventName RecognizeCompleted -SourceIdentifier fin | Out-Null
  $eng.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Say @{ ready = $true }
  $done = "" # las frases que ya terminó de reconocer
  $last = ""
  $end = (Get-Date).AddSeconds($Max)
  while ((Get-Date) -lt $end) {
    $e = Wait-Event -Timeout 1
    if (-not $e) { if ($Parent -and -not (Get-Process -Id $Parent -ErrorAction SilentlyContinue)) { break }; continue }
    $id = $e.SourceIdentifier
    $text = if ($e.SourceEventArgs.Result) { $e.SourceEventArgs.Result.Text } else { "" }
    Remove-Event -EventIdentifier $e.EventIdentifier
    if ($id -eq "fin") { break }
    if ($id -eq "rec") { $done = ("$done $text").Trim(); $now = $done } else { $now = ("$done $text").Trim() }
    if ($now -and $now -ne $last) { $last = $now; Say @{ partial = $now } }
  }
  $eng.RecognizeAsyncCancel()
} catch {
  Say @{ error = $_.Exception.Message }
  exit 1
}

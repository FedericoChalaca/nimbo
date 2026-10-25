// "Oye Nimbo": palabra de activación, como "Oye Siri". La escucha el reconocedor de voz de Windows (wake.ps1, System.Speech) con una
// gramática cerrada: solo distingue las frases de activación, no transcribe nada más, y el audio nunca sale del PC. Al oírla, Nimbo abre
// el chat y dicta lo que digas (Whisper, voice.js). Apagado hasta que lo actives; en pausa en modo mini y mientras dictas.
// Solo Windows (System.Speech). Sin Electron, para poder probarlo: `node src/integrations/wake.js`.
const { spawn } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "wake.ps1");
// Sin «ey nimbo»: con la voz Helena, «el nimbo es un tipo de nube» se oía como «ey nimbo» (0,64) y despertaba a Nimbo.
const PHRASES = { es: ["oye nimbo", "hola nimbo"], en: ["hey nimbo", "hi nimbo"] };
const CULTURE = { es: "es-ES", en: "en-US" }; // si no está, wake.ps1 usa otro del mismo idioma (es-MX, es-CO…)
// Medido con la voz Helena (es-ES): con la revisión en dos pasos de wake.ps1, las frases de activación dan 0,65–0,66 y ninguna de 10
// frases parecidas pasa ("Hoy en el noticiero…" la despertaba con 0,65 cuando solo estaba la frase cargada: eran las falsas alarmas
// que veía el dueño). Escuchando: ~6 % de un núcleo (el dictado compitiendo todo el tiempo costaba ~38 %). prefs.wakeMin lo cambia.
const MIN = 0.5;

/** Una línea del script → evento ({ ready } | { wake, text, conf } | { error }) o null. */
function parseLine(line) {
  try {
    const o = JSON.parse(String(line).trim());
    if (o?.wake === true && typeof o.text === "string") return { wake: true, text: o.text.slice(0, 40), conf: Number(o.conf) || 0 };
    if (o?.ready === true) return { ready: true, culture: String(o.culture ?? "") };
    if (typeof o?.error === "string") return { error: o.error.slice(0, 200) };
  } catch {}
  return null;
}

/**
 * @param onWake  () => void, cuando oye la frase
 * @param onError (código) => void ("no-recognizer" = Windows no tiene reconocedor de ese idioma)
 * @param lang    () => "es" | "en"
 * @param min     () => confianza mínima
 */
function createWake({ onWake, onError = () => {}, lang = () => "es", min = () => MIN, platform = process.platform, script = SCRIPT, powershell }) {
  let child = null;
  let want = false; // ¿debería estar escuchando?
  let restartTimer = 0;
  let fails = 0;
  const exe = powershell ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

  function launch() {
    clearTimeout(restartTimer);
    if (!want || child || platform !== "win32") return;
    const l = lang() === "en" ? "en" : "es";
    child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-Culture", CULTURE[l], "-Phrases", PHRASES[l].join("|"), "-Min", String(min()), "-Parent", String(process.pid)], { windowsHide: true });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const ev = parseLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (ev?.ready) fails = 0;
        if (ev?.wake) onWake(ev);
        if (ev?.error) { onError(ev.error); if (ev.error === "no-recognizer") want = false; }
      }
    });
    const me = child;
    me.on("exit", () => {
      if (child === me) child = null;
      // Se cayó solo (micrófono desconectado, suspensión…): vuelve a intentar, cada vez más espaciado.
      if (want) restartTimer = setTimeout(launch, Math.min(60_000, 3000 * 2 ** fails++));
    });
  }
  function kill() { clearTimeout(restartTimer); const c = child; child = null; c?.kill(); }

  return {
    /** Prende o apaga la escucha (on = prefs.wakeWord y no estás en modo mini ni dictando). */
    set(on) { want = !!on && platform === "win32"; if (want) launch(); else kill(); },
    /** Reinicia (cambio de idioma o de sensibilidad, o tras una suspensión). */
    restart() { kill(); fails = 0; launch(); },
    listening: () => !!child,
    stop() { want = false; kill(); },
  };
}

/**
 * Texto en vivo mientras dictas (live.ps1): el dictado de Windows va escribiendo lo que oye para que veas que te entiende; el texto
 * final lo hace Whisper. Solo corre mientras dictas. onPartial(texto) con lo que lleva.
 */
function createLive({ onPartial, lang = () => "es", platform = process.platform, powershell }) {
  let child = null;
  const exe = powershell ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return {
    start() {
      if (child || platform !== "win32") return;
      child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "live.ps1"),
        "-Culture", CULTURE[lang() === "en" ? "en" : "es"], "-Parent", String(process.pid)], { windowsHide: true });
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          try { const o = JSON.parse(buf.slice(0, nl)); if (typeof o.partial === "string") onPartial(o.partial.slice(0, 300)); } catch {}
          buf = buf.slice(nl + 1);
        }
      });
      const me = child;
      me.on("exit", () => { if (child === me) child = null; });
    },
    stop() { const c = child; child = null; c?.kill(); },
  };
}

module.exports = { createWake, createLive, parseLine, PHRASES, MIN };

// Autoprueba: node src/integrations/wake.js  (en Windows con la voz Helena, también una prueba real con audio sintetizado)
if (require.main === module) (async () => {
  const assert = require("assert");
  const fs = require("fs");
  const os = require("os");
  const { execFileSync } = require("child_process");
  assert.deepStrictEqual(parseLine('{"wake":true,"text":"oye nimbo","conf":0.71}'), { wake: true, text: "oye nimbo", conf: 0.71 });
  assert.deepStrictEqual(parseLine('{"ready":true,"culture":"es-ES"}'), { ready: true, culture: "es-ES" });
  assert.deepStrictEqual(parseLine('{"error":"no-recognizer"}'), { error: "no-recognizer" });
  assert.strictEqual(parseLine("basura"), null);
  assert.strictEqual(parseLine('{"near":"oye nimbo","conf":0.4}'), null); // lo descartado no despierta a Nimbo
  // Fuera de Windows no lanza nada.
  const off = createWake({ onWake() {}, platform: "linux" });
  off.set(true);
  assert.strictEqual(off.listening(), false);
  if (process.platform !== "win32") return console.log("wake.js ok (sin Windows: solo lo básico)");
  // Prueba real: la voz Helena dice frases y el script (leyendo un .wav en vez del micrófono) solo debe despertarse con las de activación.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-wake-"));
  const ps = (cmd) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", windowsHide: true });
  const phrases = { si: ["Oye Nimbo", "Hola Nimbo, ¿qué tengo hoy?"], no: ["Oye, mira este video tan chistoso", "El nimbo es un tipo de nube", "Hola mundo, esto es una prueba", "Hoy en el noticiero hablaron del clima", "Oye niño, ven acá", "Limbo es un juego muy bonito"] };
  const all = [...phrases.si.map((p) => [p, true]), ...phrases.no.map((p) => [p, false])];
  try {
    ps(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Helena Desktop'); ` +
      all.map(([p], i) => `$s.SetOutputToWaveFile('${path.join(dir, i + ".wav")}'); $s.Speak('${p.replace(/'/g, "''")}');`).join(" ") + " $s.SetOutputToNull()");
  } catch { fs.rmSync(dir, { recursive: true, force: true }); return console.log("wake.js ok (sin la voz Helena: no se probó con audio)"); }
  for (const [i, [p, should]] of all.entries()) {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Wav", path.join(dir, i + ".wav"), "-Min", String(MIN)], { encoding: "utf8", windowsHide: true });
    const woke = out.split("\n").map(parseLine).some((e) => e?.wake);
    assert.strictEqual(woke, should, `«${p}» debía ${should ? "" : "NO "}despertarlo: ${out.trim()}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("wake.js ok (con audio real: se despierta con «Oye Nimbo» y no con frases parecidas)");
})();

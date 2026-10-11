// Voz: Nimbo dice su respuesta en voz alta con un servicio de texto a voz que tú eliges
// (prefs.json → "ttsUrl"). Nimbo no guarda claves ni habla con el proveedor de voces: solo
// manda el texto a esa dirección y reproduce el mp3 que vuelve.
//   POST <ttsUrl>  {"text": "..."}                  → voz del tema JARVIS
//   POST <ttsUrl>  {"text": "...", "voz": "nube"}   → voz del tema Nube
//   200 = audio/mpeg. Cualquier otra cosa (503, 502, 413, sin internet, tarda más de 10 s)
//   = Nimbo sigue en silencio: una sola llamada por respuesta, sin reintentos.
const MAX_CHARS = 1500;
const TIMEOUT_MS = 10_000;
const MAX_AUDIO_BYTES = 5e6;

/** Lo que se va a decir: sin emojis ni marcas de formato y, si es largo, hasta el último punto que quepa. */
function speechText(text, max = MAX_CHARS) {
  const clean = String(text ?? "")
    .replace(/[`*#>]/g, "")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const end = Math.max(...[". ", "! ", "? ", "… "].map((mark) => head.lastIndexOf(mark)));
  // Sin un punto razonable (texto sin frases), se corta en la última palabra completa.
  return end > max * 0.3 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(" "));
}

/** Solo https, o http hacia este mismo equipo (para un servicio propio en local). */
function speechUrl(value) {
  try {
    const url = new URL(String(value));
    const local = ["127.0.0.1", "localhost"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url : null;
  } catch {
    return null;
  }
}

/** Pide el audio. Devuelve un Buffer con el mp3, o null si no hay nada que decir o algo falló. */
async function fetchSpeech(ttsUrl, text, theme) {
  const url = speechUrl(ttsUrl);
  const say = speechText(text);
  if (!url || !say) return null;
  try {
    const body = theme === "cloud" ? { text: say, voz: "nube" } : { text: say };
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !String(res.headers.get("content-type")).startsWith("audio/")) return null;
    const audio = Buffer.from(await res.arrayBuffer());
    return audio.length && audio.length < MAX_AUDIO_BYTES ? audio : null;
  } catch {
    return null; // sin internet, servicio caído o muy lento: silencio
  }
}

module.exports = { speechText, speechUrl, fetchSpeech, MAX_CHARS };

// Prueba rápida: `node tts.js`
if (require.main === module) {
  const assert = require("assert");
  assert.strictEqual(speechText("  **Listo** 👋, ya quedó `main.js`.  "), "Listo , ya quedó main.js.");
  // Largo: solo la primera parte que quepa, hasta un punto.
  const long = "Primera frase completa. ".repeat(80); // 1920 caracteres
  const cut = speechText(long);
  assert.ok(cut.length <= MAX_CHARS && cut.endsWith("completa.") && cut.length > 1400, cut.length);
  // Sin puntos: se corta en una palabra completa, nunca a media palabra.
  const words = speechText("palabra ".repeat(300));
  assert.ok(words.length <= MAX_CHARS && words.endsWith("palabra"));
  assert.strictEqual(speechText(""), "");
  // Direcciones: https sí; http solo a este equipo; lo demás no.
  assert.ok(speechUrl("https://ejemplo.com/api/tts"));
  assert.ok(speechUrl("http://127.0.0.1:8080/tts"));
  assert.strictEqual(speechUrl("http://ejemplo.com/tts"), null);
  assert.strictEqual(speechUrl("file:///c:/x"), null);
  assert.strictEqual(speechUrl(""), null);
  console.log("tts.js ok");
}

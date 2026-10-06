// Servicio de voz de ejemplo para Nimbo: recibe un texto y devuelve un mp3 hecho con ElevenLabs.
// Es una función de Vercel (carpeta api/), pero sirve en cualquier Node 18+.
//
// Example text-to-speech service for Nimbo: takes a text, returns an mp3 made with ElevenLabs.
//
// Variables de entorno (en tu hosting, NUNCA en el código) / Environment variables:
//   ELEVENLABS_API_KEY   tu clave de ElevenLabs / your ElevenLabs key
//   VOICE_ID             id de la voz del tema JARVIS / voice id for the JARVIS look
//   VOICE_ID_NUBE        id de la voz del tema Nube / voice id for the cloud look
//
// Contrato (el que espera Nimbo, ver tts.js en la raíz) / Contract:
//   POST {"text": "..."}                  → VOICE_ID
//   POST {"text": "...", "voz": "nube"}   → VOICE_ID_NUBE
//   200 audio/mpeg · 413 texto muy largo · 503 voz sin configurar · 502 falló el proveedor
const MAX_CHARS = 1500;

/** Devuelve { status, audio? , error? }. `env` y `fetchFn` se pasan para poder probarlo sin red. */
async function speak({ text, voz } = {}, env = process.env, fetchFn = fetch) {
  const say = String(text ?? "").trim();
  if (!say) return { status: 400, error: "falta text" };
  if (say.length > MAX_CHARS) return { status: 413, error: "texto muy largo" };
  const voice = voz === "nube" ? env.VOICE_ID_NUBE : env.VOICE_ID;
  if (!env.ELEVENLABS_API_KEY || !voice) return { status: 503, error: "voz no configurada" };
  try {
    const res = await fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: say, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) return { status: 502, error: `proveedor ${res.status}` };
    return { status: 200, audio: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { status: 502, error: "no se pudo hablar con el proveedor" };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "usa POST" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const out = await speak(body ?? {});
  if (out.status !== 200) return res.status(out.status).json({ error: out.error });
  res.setHeader("content-type", "audio/mpeg");
  res.setHeader("cache-control", "no-store");
  res.status(200).send(out.audio);
};
module.exports.speak = speak;

// Prueba rápida sin red ni clave: `node api/tts.js`
if (require.main === module) {
  (async () => {
    const assert = require("assert");
    const env = { ELEVENLABS_API_KEY: "clave-de-prueba", VOICE_ID: "voz-jarvis", VOICE_ID_NUBE: "voz-nube" };
    const calls = [];
    const ok = async (url, init) => { calls.push({ url, key: init.headers["xi-api-key"], text: JSON.parse(init.body).text }); return { ok: true, arrayBuffer: async () => new Uint8Array([73, 68, 51]).buffer }; };
    assert.strictEqual((await speak({ text: "hola" }, env, ok)).status, 200);
    assert.strictEqual((await speak({ text: "hola", voz: "nube" }, env, ok)).audio.length, 3);
    assert.ok(calls[0].url.includes("/voz-jarvis?") && calls[1].url.includes("/voz-nube?") && calls[0].key === "clave-de-prueba" && calls[1].text === "hola");
    assert.strictEqual((await speak({ text: "x".repeat(1501) }, env, ok)).status, 413);
    assert.strictEqual((await speak({ text: "" }, env, ok)).status, 400);
    assert.strictEqual((await speak({ text: "hola" }, {}, ok)).status, 503);
    assert.strictEqual((await speak({ text: "hola", voz: "nube" }, { ELEVENLABS_API_KEY: "k", VOICE_ID: "v" }, ok)).status, 503);
    assert.strictEqual((await speak({ text: "hola" }, env, async () => ({ ok: false, status: 401 }))).status, 502);
    assert.strictEqual((await speak({ text: "hola" }, env, async () => { throw new Error("sin red"); })).status, 502);
    console.log("examples/tts-service ok");
  })();
}

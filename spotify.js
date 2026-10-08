// Spotify: Nimbo le pide a tu `claude` (que ya tiene el conector de Spotify de claude.ai) que
// busque canciones; la que elijas se abre en tu app de Spotify (`spotify:track:…`). Nimbo nunca
// ve credenciales ni guarda tokens, y a Claude solo se le deja BUSCAR: no puede crear listas ni
// tocar tu biblioteca.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runClaude, connectors } = require("./orchestrator");

const READ_TOOLS = ["search"];
const WRITE_TOOLS = ["generate_playlist", "save_to_library", "remove_from_library", "create_playlist", "add_to_library", "Remove_from_library"];

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    connected: { type: "boolean" },
    tracks: { type: "array", items: { type: "object", properties: {
      title: { type: "string" }, artist: { type: "string" }, uri: { type: "string" } }, required: ["title", "artist", "uri"] } },
  },
  required: ["connected", "tracks"],
});

/** Lo único que Nimbo abre: el URI de UNA canción. */
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;
const TRACK_ID = /^(?:spotify:track:|https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)?([A-Za-z0-9]{22})(?:[?#].*)?$/;
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Valida lo que devolvió el modelo: títulos recortados y solo URIs de canción (URI, enlace o id). */
function cleanTracks(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const id = TRACK_ID.exec(str(x?.uri, 200))?.[1];
    return id && str(x?.title, 120) ? { title: str(x.title, 120), artist: str(x?.artist, 120), uri: `spotify:track:${id}` } : null;
  }).filter((x) => x && !seen.has(x.uri) && seen.add(x.uri)).slice(0, 6);
}

/** Busca canciones (10–30 s). Devuelve { connected, tracks }; connected false = falta el conector. */
async function searchSpotify(query) {
  const q = str(query, 120);
  if (!q) return { connected: true, tracks: [] };
  const cwd = path.join(os.tmpdir(), "nimbo-spotify");
  fs.mkdirSync(cwd, { recursive: true });
  // Sin el conector no se llama al modelo: la respuesta es inmediata y no gasta nada.
  const all = await connectors(cwd);
  const mine = all.find((n) => /spotify/i.test(n));
  if (!mine) return { connected: false, tracks: [] };
  const args = ["-p", "--output-format", "json", "--json-schema", SCHEMA, "--model", "haiku",
    // Sin herramientas propias: solo la búsqueda del conector. Los títulos los escribe un tercero.
    "--tools", "", "--permission-mode", "default", "--no-session-persistence",
    "--allowedTools", ...READ_TOOLS.map((t) => `${mine}__${t}`),
    // Los demás conectores fuera: ni se pueden usar ni ocupan el contexto.
    "--disallowedTools", ...WRITE_TOOLS.map((t) => `${mine}__${t}`), ...all.filter((n) => n !== mine)];
  const prompt = `Busca en Spotify canciones para: ${JSON.stringify(q)}. Usa la herramienta de búsqueda de Spotify una sola vez.
Responde "connected": true y "tracks": hasta 6 canciones, la mejor coincidencia primero, con "title", "artist" y "uri" (el URI, enlace o id de la canción tal cual lo devuelve la herramienta; nunca lo inventes).
Si no tienes la herramienta de búsqueda de Spotify o te pide iniciar sesión, responde "connected": false y "tracks": [].`;
  const r = await runClaude(args, { cwd, input: prompt, env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
  let out = r.structured_output;
  if (!out && r.result) { try { out = JSON.parse(r.result); } catch {} }
  if (!out) return { error: true, tracks: [] };
  return { connected: out.connected !== false, tracks: cleanTracks(out.tracks) };
}

module.exports = { searchSpotify, cleanTracks, TRACK_URI };

// Prueba rápida: `node spotify.js` · con una búsqueda de verdad: `node spotify.js "queen"`
if (require.main === module) {
  const assert = require("assert");
  const id = "4u7EnebtmKWzUH433cf5Qv";
  const got = cleanTracks([
    { title: "  Bohemian   Rhapsody ", artist: "Queen", uri: `spotify:track:${id}` },
    { title: "Repetida", artist: "Queen", uri: `https://open.spotify.com/intl-es/track/${id}?si=abc` },
    { title: "Enlace", artist: "A", uri: "https://open.spotify.com/track/7tFiyTwD0nx5a1eklYtX2J" },
    { title: "Solo id", artist: "B", uri: "3z8h0TU7ReDPLIbEnYhWZb" },
    { title: "Álbum, no canción", artist: "C", uri: "spotify:album:6i6folBtxKV28WX3msQ4FE" },
    { title: "Otro sitio", artist: "D", uri: `https://evil.example/track/${id}` },
    { title: "Con cola", artist: "E", uri: `spotify:track:${id} & calc.exe` },
    { title: "", artist: "F", uri: "spotify:track:1234567890123456789012" },
    null, "texto"]);
  assert.deepStrictEqual(got.map((x) => x.title), ["Bohemian Rhapsody", "Enlace", "Solo id"]);
  assert.ok(got.every((x) => TRACK_URI.test(x.uri)));
  assert.deepStrictEqual(cleanTracks("nada"), []);
  assert.strictEqual(cleanTracks(Array.from({ length: 9 }, (_, i) => ({ title: "t", artist: "", uri: `spotify:track:${"a".repeat(21)}${i}` }))).length, 6);
  console.log("spotify.js ok");
  if (process.argv[2]) {
    const t0 = Date.now();
    searchSpotify(process.argv[2]).then((d) => console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`, JSON.stringify(d, null, 2)));
  }
}

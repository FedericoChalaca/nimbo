// Letras sincronizadas de la canción que suena, de LRCLIB (lrclib.net: biblioteca comunitaria, gratis, sin cuenta ni clave).
// Solo se piden cuando tocas el botón de la letra, y solo viajan el título, el artista, el álbum y la duración (ver PRIVACY.md).
// La respuesta la escribe un tercero: se valida y se recorta, y la página la pinta con textContent.

const API = "https://lrclib.net/api/get";
const UA = "Nimbo (https://github.com/FedericoChalaca/nimbo)"; // LRCLIB pide identificarse

/** "[01:02.50] texto" → [[62.5, "texto"], …] ordenado. Ignora etiquetas sin tiempo ([ar:], [offset:]…). */
function parseLrc(lrc) {
  const out = [];
  for (const raw of String(lrc ?? "").split(/\r?\n/).slice(0, 2000)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim().slice(0, 200);
    for (const m of stamps) out.push([Number(m[1]) * 60 + Number(m[2].replace(":", ".")), text]);
  }
  return out.filter(([t]) => Number.isFinite(t)).sort((a, b) => a[0] - b[0]);
}

/** La letra: { synced: [[seg, línea]…] } o { plain: "…" } o null si no hay. */
async function fetchLyrics({ title, artist, album, dur }, { fetch: doFetch = fetch, api = API } = {}) {
  if (!title || !artist) return null;
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) q.set("album_name", album);
  if (dur > 0) q.set("duration", String(Math.round(dur)));
  const r = await doFetch(`${api}?${q}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`lrclib ${r.status}`);
  const d = await r.json();
  if (d?.instrumental) return { synced: [[0, "♪ Instrumental ♪"]] };
  const synced = typeof d?.syncedLyrics === "string" ? parseLrc(d.syncedLyrics) : [];
  if (synced.length) return { synced };
  const plain = typeof d?.plainLyrics === "string" ? d.plainLyrics.slice(0, 20_000).trim() : "";
  return plain ? { plain } : null;
}

module.exports = { parseLrc, fetchLyrics };

// Autoprueba sin red: `node src/integrations/lyrics.js` (con "live" pregunta a LRCLIB de verdad por una canción conocida)
if (require.main === module) {
  const assert = require("assert");
  assert.deepStrictEqual(parseLrc("[ar:Queen]\n[00:01.50] Is this the real life?\n[00:05.00][01:00.00] Coro\n[00:03.2]\nsin tiempo"),
    [[1.5, "Is this the real life?"], [3.2, ""], [5, "Coro"], [60, "Coro"]]);
  assert.deepStrictEqual(parseLrc(null), []);
  (async () => {
    const fake = (status, body) => async (url, opt) => { fake.url = url; fake.ua = opt.headers["User-Agent"]; return { status, ok: status === 200, json: async () => body }; };
    let f = fake(200, { syncedLyrics: "[00:10.00] hola" });
    assert.deepStrictEqual(await fetchLyrics({ title: "A b", artist: "C", album: "D", dur: 200.4 }, { fetch: f }), { synced: [[10, "hola"]] });
    assert.ok(fake.url.includes("track_name=A+b") && fake.url.includes("duration=200") && fake.ua.startsWith("Nimbo"));
    assert.deepStrictEqual(await fetchLyrics({ title: "a", artist: "b" }, { fetch: fake(200, { plainLyrics: "solo texto" }) }), { plain: "solo texto" });
    assert.strictEqual(await fetchLyrics({ title: "a", artist: "b" }, { fetch: fake(404, {}) }), null);
    assert.strictEqual(await fetchLyrics({ title: "", artist: "b" }, { fetch: fake(200, {}) }), null);
    await assert.rejects(fetchLyrics({ title: "a", artist: "b" }, { fetch: fake(500, {}) }));
    console.log("lyrics.js ok");
    if (process.argv[2] === "live") {
      const l = await fetchLyrics({ title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", dur: 355 });
      console.log(l?.synced ? `${l.synced.length} líneas sincronizadas` : l?.plain ? "solo texto" : "sin letra");
    }
  })();
}

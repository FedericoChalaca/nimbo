// Spotify con Premium (opcional): buscar al instante y que la canción elegida SUENE, con la Web
// API de Spotify. Cada persona usa su propia "app" de developer.spotify.com (Spotify limita cada
// app a 5 usuarios y exige que su dueño tenga Premium), así que el Client ID va en prefs.json,
// nunca en el código. Entrada con PKCE: no hay "client secret" en ninguna parte.
// Lo único que se guarda es el token de renovación, y lo cifra Windows (ver main.js).
// Permisos que se piden: ver y controlar la reproducción. Nada de listas, biblioteca ni perfil.
const crypto = require("crypto");
const os = require("os");
const { cleanTracks } = require("./spotify");

const SCOPES = "user-modify-playback-state user-read-playback-state";
const CLIENT_ID = /^[0-9a-f]{32}$/;
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const challengeOf = (verifier) => b64url(crypto.createHash("sha256").update(verifier).digest());

/** El equipo donde corre Nimbo si está en la lista; si no, uno que ya esté activo; si no, el primero. */
function pickDevice(devices, host = os.hostname()) {
  const list = (Array.isArray(devices) ? devices : []).filter((d) => d && typeof d.id === "string" && d.id && !d.is_restricted);
  return (list.find((d) => String(d.name).toLowerCase() === host.toLowerCase()) ?? list.find((d) => d.is_active) ?? list.find((d) => d.type === "Computer") ?? list[0])?.id ?? null;
}

/** De la respuesta de /search a la lista que muestra Nimbo (validada por cleanTracks). */
const tracksFrom = (json) => cleanTracks((json?.tracks?.items ?? []).map((x) => ({
  title: x?.name, artist: (Array.isArray(x?.artists) ? x.artists : []).map((a) => a?.name).filter(Boolean).join(", "), uri: x?.uri })));

/**
 * @param clientId   () => el Client ID de prefs.json ("" = sin configurar)
 * @param redirect   la dirección de vuelta registrada en la app de Spotify
 * @param load/save  leer y guardar el token de renovación (cifrado por quien llama); save("") lo borra
 * @param open       abre una dirección en el navegador
 */
function createSpotifyApi({ clientId, redirect, load, save, open, fetch: doFetch = fetch }) {
  let access = null; // { token, until } — solo en memoria
  let pending = null; // { state, verifier, at, done } — una entrada en curso
  const id = () => (CLIENT_ID.test(clientId() ?? "") ? clientId() : "");

  async function token(body) {
    const r = await doFetch("https://accounts.spotify.com/api/token", { method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...body, client_id: id() }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      // Token revocado o vencido: se olvida, y el panel vuelve a pedir "Conectar".
      if (j.error === "invalid_grant" && body.grant_type === "refresh_token") save("");
      throw new Error(`token ${r.status}`);
    }
    access = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
    if (j.refresh_token) save(j.refresh_token); // a veces no manda uno nuevo: se conserva el que hay
    return access.token;
  }
  async function bearer() {
    if (access && Date.now() < access.until) return access.token;
    const refresh = load();
    if (!refresh) throw new Error("sin sesión");
    return token({ grant_type: "refresh_token", refresh_token: refresh });
  }
  async function call(method, path, body) {
    return doFetch(`https://api.spotify.com/v1${path}`, { method, signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${await bearer()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
  }

  return {
    configured: () => id() !== "",
    connected: () => id() !== "" && !!load(),

    /** Abre la página de permiso de Spotify. Termina cuando vuelve por `callback` (o a los 5 min). */
    login() {
      if (!id()) return Promise.resolve(false);
      pending?.done(false);
      const verifier = b64url(crypto.randomBytes(48));
      const state = crypto.randomBytes(16).toString("hex");
      return new Promise((resolve) => {
        const timer = setTimeout(() => entry.done(false), 5 * 60_000);
        const entry = { state, verifier, done: (ok) => { clearTimeout(timer); if (pending === entry) pending = null; resolve(ok); } };
        pending = entry;
        open(`https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: id(), response_type: "code", redirect_uri: redirect,
          code_challenge_method: "S256", code_challenge: challengeOf(verifier), state, scope: SCOPES })}`);
      });
    },

    /** La vuelta del navegador. Solo vale si hay una entrada en curso y el `state` es el suyo. */
    async callback(query) {
      const entry = pending;
      const state = String(query.get("state") ?? "");
      if (!entry || state.length !== entry.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(entry.state))) return false;
      pending = null; // el state vale una sola vez
      let ok = false;
      try {
        if (query.get("code")) { await token({ grant_type: "authorization_code", code: query.get("code"), redirect_uri: redirect, code_verifier: entry.verifier }); ok = true; }
      } catch {}
      entry.done(ok);
      return ok;
    },

    logout() { access = null; save(""); },

    async search(query) {
      const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!q) return { connected: true, tracks: [] };
      try {
        const r = await call("GET", `/search?${new URLSearchParams({ q, type: "track", limit: "6" })}`);
        if (!r.ok) return { error: true, tracks: [] };
        return { connected: true, tracks: tracksFrom(await r.json()) };
      } catch { return { error: true, tracks: [] }; }
    },

    /** Pone a sonar una canción. { ok } · o { error: "premium" | "device" | "fail" }. */
    async play(uri) {
      try {
        let r = await call("PUT", "/me/player/play", { uris: [uri] });
        if (r.status === 404) {
          // Ningún equipo "activo" (Spotify recién abierto o en pausa hace rato): se elige uno.
          const device = pickDevice((await (await call("GET", "/me/player/devices")).json().catch(() => ({}))).devices);
          if (!device) return { error: "device" };
          r = await call("PUT", `/me/player/play?device_id=${encodeURIComponent(device)}`, { uris: [uri] });
        }
        if (r.ok) return { ok: true };
        return { error: r.status === 403 ? "premium" : r.status === 404 ? "device" : "fail" };
      } catch { return { error: "fail" }; }
    },
  };
}

module.exports = { createSpotifyApi, pickDevice, tracksFrom, challengeOf, CLIENT_ID };

// Prueba rápida, sin red: `node spotify-api.js`
if (require.main === module) (async () => {
  const assert = require("assert");
  // Vector del RFC 7636 (PKCE).
  assert.strictEqual(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.strictEqual(pickDevice([{ id: "a", name: "Celular", type: "Smartphone" }, { id: "b", name: "MI-PC", type: "Computer" }], "mi-pc"), "b");
  assert.strictEqual(pickDevice([{ id: "a", name: "Celular", is_active: true }, { id: "b", name: "Otro", type: "Computer" }], "mi-pc"), "a");
  assert.strictEqual(pickDevice([{ id: "x", name: "Bloqueado", is_restricted: true }, { id: "", name: "sin id" }], "mi-pc"), null);
  assert.strictEqual(pickDevice(null), null);
  const tid = "4u7EnebtmKWzUH433cf5Qv";
  assert.deepStrictEqual(tracksFrom({ tracks: { items: [{ name: "Bohemian Rhapsody", artists: [{ name: "Queen" }, { name: "X" }], uri: `spotify:track:${tid}` }, { name: "malo", uri: "spotify:album:1" }, null] } }),
    [{ title: "Bohemian Rhapsody", artist: "Queen, X", uri: `spotify:track:${tid}` }]);
  assert.deepStrictEqual(tracksFrom({}), []);

  // Un Spotify de mentira: entrada, búsqueda, y reproducir cuando no hay equipo activo.
  const calls = [];
  let stored = "";
  let opened = "";
  const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  const fake = async (url, init) => {
    calls.push(`${init.method} ${url.replace(/^https:\/\/[^/]+/, "").split("?")[0]}`);
    if (url.endsWith("/api/token")) {
      const b = new URLSearchParams(init.body);
      assert.strictEqual(b.get("client_id"), "a".repeat(32));
      if (b.get("grant_type") === "authorization_code") { assert.strictEqual(challengeOf(b.get("code_verifier")), new URL(opened).searchParams.get("code_challenge")); return reply(200, { access_token: "A1", expires_in: 3600, refresh_token: "R1" }); }
      return b.get("refresh_token") === "R1" ? reply(200, { access_token: "A2", expires_in: 3600 }) : reply(400, { error: "invalid_grant" });
    }
    assert.match(init.headers.authorization, /^Bearer A[12]$/);
    if (url.includes("/search")) return reply(200, { tracks: { items: [{ name: "t", artists: [{ name: "a" }], uri: `spotify:track:${tid}` }] } });
    if (url.endsWith("/me/player/devices")) return reply(200, { devices: [{ id: "dev1", name: os.hostname(), type: "Computer" }] });
    if (url.endsWith("/me/player/play")) return reply(404, { error: { reason: "NO_ACTIVE_DEVICE" } });
    if (url.includes("/me/player/play?device_id=dev1")) { assert.deepStrictEqual(JSON.parse(init.body), { uris: [`spotify:track:${tid}`] }); return reply(204, {}); }
    return reply(500, {});
  };
  let cid = "a".repeat(32);
  const make = () => createSpotifyApi({ clientId: () => cid, redirect: "http://127.0.0.1:47823/spotify", load: () => stored, save: (v) => { stored = v; }, open: (u) => { opened = u; }, fetch: fake });
  const api = make();
  assert.strictEqual(api.connected(), false);
  const waiting = api.login();
  const auth = new URL(opened);
  assert.strictEqual(auth.origin + auth.pathname, "https://accounts.spotify.com/authorize");
  assert.strictEqual(auth.searchParams.get("redirect_uri"), "http://127.0.0.1:47823/spotify");
  assert.strictEqual(auth.searchParams.get("scope"), SCOPES);
  // Un state ajeno no entra, ni gasta la entrada en curso.
  assert.strictEqual(await api.callback(new URLSearchParams({ code: "c", state: "f".repeat(32) })), false);
  assert.strictEqual(await api.callback(new URLSearchParams({ code: "c", state: auth.searchParams.get("state") })), true);
  assert.strictEqual(await waiting, true);
  assert.strictEqual(stored, "R1");
  // El mismo state no vale dos veces.
  assert.strictEqual(await api.callback(new URLSearchParams({ code: "c", state: auth.searchParams.get("state") })), false);
  assert.deepStrictEqual(await api.search("queen"), { connected: true, tracks: [{ title: "t", artist: "a", uri: `spotify:track:${tid}` }] });
  assert.deepStrictEqual(await api.play(`spotify:track:${tid}`), { ok: true });
  assert.deepStrictEqual(calls.slice(-3), ["PUT /v1/me/player/play", "GET /v1/me/player/devices", "PUT /v1/me/player/play"]);
  // Otra instancia (Nimbo reiniciado): renueva con el token guardado, sin volver a entrar.
  assert.deepStrictEqual((await make().search("queen")).tracks.length, 1);
  // Token revocado: se olvida y deja de figurar conectado.
  stored = "viejo";
  const stale = make();
  assert.strictEqual((await stale.search("queen")).error, true);
  assert.strictEqual(stale.connected(), false);
  // Sin Client ID válido no se abre nada.
  cid = "no-es-un-id";
  opened = "";
  assert.strictEqual(await make().login(), false);
  assert.strictEqual(opened, "");
  // El usuario dice que no en la página de Spotify.
  cid = "a".repeat(32);
  const denied = make();
  const w2 = denied.login();
  assert.strictEqual(await denied.callback(new URLSearchParams({ error: "access_denied", state: new URL(opened).searchParams.get("state") })), false);
  assert.strictEqual(await w2, false);
  console.log("spotify-api.js ok");
})();

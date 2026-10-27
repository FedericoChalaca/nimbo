// Tu Google (Drive y Calendar) directo desde Nimbo, con TU app de Google Cloud (como Spotify Premium): sin pasar por los conectores de Claude.
// OAuth de app de escritorio con PKCE y vuelta a 127.0.0.1 (el servidor de Nimbo). Lo único guardado: el secreto de tu app y el token de
// renovación, cifrados por Windows (main.js, google.bin). Permisos mínimos:
//   · drive.file: SOLO los archivos y carpetas que crea Nimbo (la carpeta con Instinct), no el resto de tu Drive.
//   · calendar.events: ver y crear eventos de tus calendarios.
const crypto = require("crypto");

const CLIENT_ID = /^[\w-]{10,100}\.apps\.googleusercontent\.com$/;
const SECRET = /^GOCSPX-[\w-]{10,60}$/;
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events";
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Un evento de Calendar → lo que muestra Nimbo. */
const cleanEvent = (e) => ({
  id: str(e.id, 200), title: str(e.summary, 160) || "(sin título)", where: str(e.location, 120),
  start: str(e.start?.dateTime ?? e.start?.date, 40), end: str(e.end?.dateTime ?? e.end?.date, 40), allDay: !e.start?.dateTime,
  link: /^https:\/\/www\.google\.com\/calendar\//.test(e.htmlLink ?? "") ? e.htmlLink : "",
});

function createGoogle({ clientId, load, save, redirect, open, fetch: doFetch = fetch, base = {} }) {
  const AUTH = base.auth ?? "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN = base.token ?? "https://oauth2.googleapis.com/token";
  const API = base.api ?? "https://www.googleapis.com";
  const DOCS = base.docs ?? "https://docs.googleapis.com";
  let access = null; // { token, until } — solo en memoria
  let pending = null;
  const id = () => (CLIENT_ID.test(clientId() ?? "") ? clientId() : "");
  const creds = () => load() ?? {}; // { secret, refresh }

  async function token(body) {
    const r = await doFetch(TOKEN, { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, client_id: id(), client_secret: creds().secret ?? "" }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      if (j.error === "invalid_grant" && body.grant_type === "refresh_token") save({ ...creds(), refresh: "" }); // revocado o vencido: hay que volver a entrar
      throw new Error(`token ${r.status}`);
    }
    access = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
    if (j.refresh_token) save({ ...creds(), refresh: j.refresh_token });
    return access.token;
  }
  async function bearer() {
    if (access && Date.now() < access.until) return access.token;
    if (!creds().refresh) throw new Error("sin sesión");
    return token({ grant_type: "refresh_token", refresh_token: creds().refresh });
  }
  async function call(method, url, body) {
    const r = await doFetch(url, { method, signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${await bearer()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`google ${r.status}`);
    return r.status === 204 ? null : r;
  }
  const json = async (method, url, body) => (await call(method, url, body)).json();

  return {
    configured: () => id() !== "" && SECRET.test(creds().secret ?? ""),
    connected: () => id() !== "" && !!creds().refresh,

    /** Abre la página de permiso de Google. Termina cuando vuelve por `callback` (o a los 5 min). */
    login() {
      if (!id()) return Promise.resolve(false);
      pending?.done(false);
      const verifier = b64url(crypto.randomBytes(48));
      const state = crypto.randomBytes(16).toString("hex");
      return new Promise((resolve) => {
        const timer = setTimeout(() => entry.done(false), 5 * 60_000);
        const entry = { state, verifier, done: (ok) => { clearTimeout(timer); if (pending === entry) pending = null; resolve(ok); } };
        pending = entry;
        open(`${AUTH}?${new URLSearchParams({ client_id: id(), response_type: "code", redirect_uri: redirect, scope: SCOPES, state,
          code_challenge_method: "S256", code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), access_type: "offline", prompt: "consent" })}`);
      });
    },
    /** La vuelta del navegador: solo vale con una entrada en curso y su `state` (una sola vez). */
    async callback(query) {
      const entry = pending;
      const state = String(query.get("state") ?? "");
      if (!entry || state.length !== entry.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(entry.state))) return false;
      pending = null;
      let ok = false;
      try { if (query.get("code")) { await token({ grant_type: "authorization_code", code: query.get("code"), redirect_uri: redirect, code_verifier: entry.verifier }); ok = true; } } catch {}
      entry.done(ok);
      return ok;
    },
    logout() { access = null; save({ ...creds(), refresh: "" }); },

    /** Tus próximos eventos (calendario principal), de ahora a `days` días. */
    async events(days = 7) {
      const now = new Date();
      const q = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + days * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "40" });
      const j = await json("GET", `${API}/calendar/v3/calendars/primary/events?${q}`);
      return (Array.isArray(j.items) ? j.items : []).map(cleanEvent);
    },

    // --- Drive (solo lo que crea Nimbo) ---
    /** Busca o crea una carpeta de Nimbo por nombre. → { id, link } */
    async folder(name) {
      const q = `name = '${name.replace(/['\\]/g, "\\$&")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const found = await json("GET", `${API}/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,webViewLink)", pageSize: "1" })}`);
      if (found.files?.[0]) return { id: found.files[0].id, link: found.files[0].webViewLink };
      const made = await json("POST", `${API}/drive/v3/files?fields=id,webViewLink`, { name, mimeType: "application/vnd.google-apps.folder" });
      return { id: made.id, link: made.webViewLink };
    },
    /** Busca o crea un documento de Google dentro de una carpeta. → { id, link } */
    async doc(folderId, name, firstText = "") {
      const q = `name = '${name.replace(/['\\]/g, "\\$&")}' and '${folderId}' in parents and trashed = false`;
      const found = await json("GET", `${API}/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,webViewLink)", pageSize: "1" })}`);
      if (found.files?.[0]) return { id: found.files[0].id, link: found.files[0].webViewLink };
      const made = await json("POST", `${API}/drive/v3/files?fields=id,webViewLink`, { name, parents: [folderId], mimeType: "application/vnd.google-apps.document" });
      if (firstText) await this.append(made.id, firstText);
      return { id: made.id, link: made.webViewLink };
    },
    /** El texto de un documento (como texto plano). */
    async read(docId) {
      const r = await call("GET", `${API}/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=text/plain`);
      return (await r.text()).replace(/^\uFEFF/, "").slice(0, 200_000);
    },
    /** Agrega texto al final de un documento. */
    async append(docId, text) {
      await json("POST", `${DOCS}/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, { requests: [{ insertText: { endOfSegmentLocation: {}, text: String(text).slice(0, 20_000) } }] });
    },
  };
}

module.exports = { createGoogle, CLIENT_ID, SECRET, cleanEvent };

// Autoprueba sin red: `node src/integrations/google.js` (un Google de mentira en tu PC)
if (require.main === module) {
  const assert = require("assert");
  const http = require("http");
  assert.ok(CLIENT_ID.test("1234567890-abcdef.apps.googleusercontent.com") && !CLIENT_ID.test("x.evil.com"));
  assert.ok(SECRET.test("GOCSPX-abcdefghijkl") && !SECRET.test("hola"));
  assert.deepStrictEqual(cleanEvent({ id: "1", summary: " Clase ", start: { date: "2026-10-28" }, end: { date: "2026-10-29" }, htmlLink: "https://evil/x" }),
    { id: "1", title: "Clase", where: "", start: "2026-10-28", end: "2026-10-29", allDay: true, link: "" });
  (async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
        seen.push(`${req.method} ${req.url.split("?")[0]} ${req.headers.authorization ?? ""}`);
        const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        if (req.url === "/token") { const p = new URLSearchParams(body); return p.get("client_secret") === "GOCSPX-secretito1234" ? send(200, { access_token: "AT", expires_in: 3600, refresh_token: p.get("grant_type") === "authorization_code" ? "RT" : undefined }) : send(401, { error: "invalid_client" }); }
        if (req.url.startsWith("/calendar/v3/calendars/primary/events")) return send(200, { items: [{ id: "e", summary: "Parcial", start: { dateTime: "2026-10-28T08:00:00-05:00" }, end: { dateTime: "2026-10-28T10:00:00-05:00" } }] });
        if (req.url.startsWith("/drive/v3/files?q=")) return send(200, { files: [] });
        if (req.url.startsWith("/drive/v3/files?fields")) return send(200, { id: "F1", webViewLink: "https://drive.google.com/x" });
        if (req.url.includes(":batchUpdate")) return send(200, {});
        if (req.url.includes("/export")) { res.writeHead(200, { "content-type": "text/plain" }); return res.end("\uFEFFhola Nimbo"); }
        send(404, {});
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const o = `http://127.0.0.1:${server.address().port}`;
    let stored = { secret: "GOCSPX-secretito1234" };
    let opened = "";
    const g = createGoogle({ clientId: () => "1234567890-abcdef.apps.googleusercontent.com", load: () => stored, save: (v) => { stored = v; }, redirect: "http://127.0.0.1:47823/google",
      open: (u) => { opened = u; }, base: { auth: `${o}/auth`, token: `${o}/token`, api: o, docs: o } });
    assert.ok(g.configured() && !g.connected());
    const done = g.login();
    const u = new URL(opened);
    assert.strictEqual(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("scope").includes("drive.file") && !u.searchParams.get("scope").includes("auth/drive "));
    assert.strictEqual(await g.callback(new URLSearchParams({ state: "malo", code: "c" })), false); // state ajeno: nada
    assert.strictEqual(await g.callback(new URLSearchParams({ state: u.searchParams.get("state"), code: "c" })), true);
    assert.strictEqual(await done, true);
    assert.strictEqual(stored.refresh, "RT");
    assert.deepStrictEqual((await g.events()).map((e) => e.title), ["Parcial"]);
    assert.deepStrictEqual(await g.folder("Nimbo e Instinct"), { id: "F1", link: "https://drive.google.com/x" });
    await g.doc("F1", "Para Nimbo", "hola");
    assert.strictEqual(await g.read("F1"), "hola Nimbo");
    assert.ok(seen.some((s) => s.includes(":batchUpdate") && s.includes("Bearer AT")));
    g.logout();
    assert.ok(!g.connected() && g.configured()); // el secreto se queda; solo se olvida la sesión
    server.close();
    console.log("google.js ok");
  })();
}

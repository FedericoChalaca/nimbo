// Versiones nuevas (opcional, solo si el dueño lo aceptó): consulta la página de versiones de Nimbo en GitHub, avisa cuando hay una más nueva y, en Windows con
// la app instalada, baja el instalador, comprueba su SHA-256 contra el que publica GitHub y lo abre. Idea tomada de Coucou ("new version in the notch", MIT).
// No se envía nada tuyo: son dos peticiones GET a api.github.com y github.com. Sin Electron, para poder probarlo (`node src/main/updates.js`).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO = "FedericoChalaca/nimbo";
const API = "https://api.github.com";
const ASSET_URL = new RegExp(`^https://github\\.com/${REPO}/releases/download/v\\d+\\.\\d+\\.\\d+/[A-Za-z0-9._-]+$`);
const PAGE_URL = new RegExp(`^https://github\\.com/${REPO}/releases/`);
const MAX_BYTES = 500 * 1024 * 1024;

const parseV = (v) => { const m = String(v ?? "").match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
/** ¿a es una versión más nueva que b? (x.y.z; lo que no se entiende nunca es "más nuevo") */
function isNewer(a, b) {
  const x = parseV(a), y = parseV(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** El archivo de la versión que corresponde a este sistema (los nombres los fija build.yml / package.json). */
function pickAsset(assets, platform, arch) {
  const names = { win32: ["Nimbo-Setup.exe"], linux: ["Nimbo-linux-x64.deb", "Nimbo-linux-x64.AppImage"], darwin: [`Nimbo-mac-${arch === "arm64" ? "arm64" : "x64"}.dmg`] }[platform] ?? [];
  for (const n of names) { const a = (Array.isArray(assets) ? assets : []).find((x) => x?.name === n); if (a) return a; }
  return null;
}

/** Las notas de la versión como líneas cortas de texto plano (sin Markdown), hasta 8. */
function summarizeNotes(body) {
  return String(body ?? "").replace(/\r/g, "").split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/\*\*|__|`|\[([^\]]*)\]\([^)]*\)/g, (m, g) => g ?? "").trim())
    .filter(Boolean).slice(0, 8).map((l) => l.slice(0, 160));
}

async function getJson(url, f) {
  const r = await f(url, { headers: { accept: "application/vnd.github+json", "user-agent": "Nimbo-updater" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

const info = (j, platform, arch) => {
  const a = pickAsset(j.assets, platform, arch);
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(String(a?.digest ?? ""))?.[1]?.toLowerCase() ?? null;
  return {
    version: String(j.tag_name).replace(/^v/, ""),
    page: PAGE_URL.test(String(j.html_url ?? "")) ? j.html_url : `https://github.com/${REPO}/releases`,
    notes: summarizeNotes(j.body),
    asset: a ? { name: a.name, url: String(a.browser_download_url ?? ""), size: Number(a.size) || 0, sha256: sha } : null,
  };
};

/** La última versión publicada si es más nueva que \`current\`; si no, null. Lanza si no hay red. */
async function latest({ current, platform, arch, api = API, fetch: f = fetch }) {
  const j = await getJson(`${api}/repos/${REPO}/releases/latest`, f);
  if (!j || j.draft || j.prerelease || !parseV(j.tag_name) || !isNewer(j.tag_name, current)) return null;
  return info(j, platform, arch);
}

/** Las notas de una versión ya instalada (para "qué hay de nuevo"). [] si no se pueden leer. */
async function notesFor(version, { api = API, fetch: f = fetch } = {}) {
  try {
    if (!parseV(version)) return [];
    return summarizeNotes((await getJson(`${api}/repos/${REPO}/releases/tags/v${version}`, f)).body);
  } catch { return []; }
}

/**
 * Baja el instalador a \`dir\` y comprueba que su SHA-256 sea el que GitHub publicó. Sin ese número no se instala nada
 * ({ error: "nodigest" }: la página de la versión se abre en el navegador). Un archivo que no coincide se borra.
 * Devuelve { file } o { error: "nodigest" | "url" | "http" | "size" | "hash" | "fail" }.
 */
async function download(asset, dir, { fetch: f = fetch, onProgress = () => {}, urlOk = (u) => ASSET_URL.test(u) } = {}) {
  if (!asset?.sha256) return { error: "nodigest" };
  if (!urlOk(String(asset.url)) || !/^[A-Za-z0-9._-]+$/.test(String(asset.name))) return { error: "url" };
  let file;
  try {
    const r = await f(asset.url, { headers: { "user-agent": "Nimbo-updater" }, signal: AbortSignal.timeout(10 * 60_000) });
    if (!r.ok || !r.body) return { error: "http" };
    const total = Number(r.headers.get("content-length")) || asset.size || 0;
    if (total > MAX_BYTES) return { error: "size" };
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, asset.name);
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(file);
    let got = 0, last = -1;
    for await (const chunk of r.body) {
      got += chunk.length;
      if (got > MAX_BYTES) { out.destroy(); fs.rmSync(file, { force: true }); return { error: "size" }; }
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : null;
      if (pct !== null && pct !== last) { last = pct; onProgress(pct); }
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    if (hash.digest("hex") !== asset.sha256) { fs.rmSync(file, { force: true }); return { error: "hash" }; }
    onProgress(100);
    return { file };
  } catch { if (file) fs.rmSync(file, { force: true }); return { error: "fail" }; }
}

module.exports = { isNewer, pickAsset, summarizeNotes, latest, notesFor, download };

// Autoprueba (sin internet, con un GitHub de mentira): \`node src/main/updates.js\`
if (require.main === module) (async () => {
  const assert = require("assert");
  const http = require("http");
  const os = require("os");
  assert.ok(isNewer("0.9.0", "0.8.0") && isNewer("v0.8.1", "0.8.0") && isNewer("1.0.0", "0.99.99") && isNewer("0.10.0", "0.9.9"));
  assert.ok(!isNewer("0.8.0", "0.8.0") && !isNewer("0.7.9", "0.8.0") && !isNewer("basura", "0.8.0") && !isNewer("0.9.0", "x"));
  const assets = [{ name: "Nimbo-Setup.exe" }, { name: "Nimbo-linux-x64.AppImage" }, { name: "Nimbo-linux-x64.deb" }, { name: "Nimbo-mac-arm64.dmg" }, { name: "Nimbo-mac-x64.dmg" }];
  assert.deepStrictEqual([pickAsset(assets, "win32", "x64"), pickAsset(assets, "linux", "x64"), pickAsset(assets, "darwin", "arm64"), pickAsset(assets, "darwin", "x64"), pickAsset(assets, "freebsd", "x64"), pickAsset([], "win32", "x64")].map((a) => a?.name ?? null),
    ["Nimbo-Setup.exe", "Nimbo-linux-x64.deb", "Nimbo-mac-arm64.dmg", "Nimbo-mac-x64.dmg", null, null]);
  assert.deepStrictEqual(summarizeNotes("## Novedades\r\n- **Telegram**: chat y [avisos](http://x)\n\n> nota \`corta\`\n" + "- y\n".repeat(12)).slice(0, 3), ["Novedades", "Telegram: chat y avisos", "nota corta"]);
  assert.strictEqual(summarizeNotes("x\n".repeat(30)).length, 8);

  // Un GitHub de mentira: la API y el archivo del instalador.
  const body = Buffer.from("MZ-instalador-de-mentira".repeat(2000));
  const good = crypto.createHash("sha256").update(body).digest("hex");
  let release;
  const server = http.createServer((req, res) => {
    const json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/repos/FedericoChalaca/nimbo/releases/latest") return json(release);
    if (req.url === "/repos/FedericoChalaca/nimbo/releases/tags/v0.9.0") return json({ body: "- Algo nuevo" });
    if (req.url.startsWith("/repos/")) return json({ message: "Not Found" }, 404);
    if (req.url === "/dl/Nimbo-Setup.exe") { res.writeHead(200, { "content-length": body.length }); return res.end(body); }
    if (req.url === "/dl/malo.exe") { res.writeHead(200); return res.end("otro contenido"); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const rel = (extra = {}) => ({ tag_name: "v0.9.0", draft: false, prerelease: false, html_url: "https://github.com/FedericoChalaca/nimbo/releases/tag/v0.9.0", body: "- Linux y macOS\n- Mejoras",
    assets: [{ name: "Nimbo-Setup.exe", size: body.length, digest: "sha256:" + good, browser_download_url: `${base}/dl/Nimbo-Setup.exe` }], ...extra });

  release = rel();
  const i = await latest({ current: "0.8.0", platform: "win32", arch: "x64", api: base });
  assert.deepStrictEqual([i.version, i.notes, i.asset.name, i.asset.sha256 === good, i.page], ["0.9.0", ["Linux y macOS", "Mejoras"], "Nimbo-Setup.exe", true, "https://github.com/FedericoChalaca/nimbo/releases/tag/v0.9.0"]);
  assert.strictEqual(await latest({ current: "0.9.0", platform: "win32", arch: "x64", api: base }), null); // ya está al día
  release = rel({ prerelease: true }); assert.strictEqual(await latest({ current: "0.8.0", platform: "win32", arch: "x64", api: base }), null);
  release = rel({ draft: true }); assert.strictEqual(await latest({ current: "0.8.0", platform: "win32", arch: "x64", api: base }), null);
  release = rel({ html_url: "https://malo.example/x" }); // una dirección de página ajena se cambia por la de siempre
  assert.strictEqual((await latest({ current: "0.8.0", platform: "win32", arch: "x64", api: base })).page, "https://github.com/FedericoChalaca/nimbo/releases");
  release = rel({ assets: [{ name: "Nimbo-Setup.exe", size: 5, browser_download_url: "x" }] }); // sin digest: no se puede verificar
  assert.strictEqual((await latest({ current: "0.8.0", platform: "win32", arch: "x64", api: base })).asset.sha256, null);
  await assert.rejects(latest({ current: "0.8.0", platform: "win32", arch: "x64", api: `${base}/nada` }));
  assert.deepStrictEqual(await notesFor("0.9.0", { api: base }), ["Algo nuevo"]);
  assert.deepStrictEqual(await notesFor("0.7.0", { api: base }), []); // sin nota o sin red: lista vacía
  assert.deepStrictEqual(await notesFor("../x", { api: base }), []);

  // Descarga: solo con SHA-256 conocido, desde una dirección de GitHub, y se verifica.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-upd-"));
  const pcts = [];
  const okUrl = (u) => u.startsWith(base);
  const asset = { name: "Nimbo-Setup.exe", url: `${base}/dl/Nimbo-Setup.exe`, size: body.length, sha256: good };
  const d = await download(asset, tmp, { urlOk: okUrl, onProgress: (p) => pcts.push(p) });
  assert.ok(d.file && fs.readFileSync(d.file).equals(body) && pcts.at(-1) === 100);
  assert.deepStrictEqual(await download({ ...asset, name: "malo.exe", url: `${base}/dl/malo.exe` }, tmp, { urlOk: okUrl }), { error: "hash" }); // no coincide: se rechaza
  assert.ok(!fs.existsSync(path.join(tmp, "malo.exe")) && fs.existsSync(d.file));
  fs.rmSync(d.file);
  assert.deepStrictEqual(await download({ ...asset, sha256: null }, tmp, { urlOk: okUrl }), { error: "nodigest" });
  assert.deepStrictEqual(await download(asset, tmp), { error: "url" }); // por defecto, solo github.com/FedericoChalaca/nimbo/releases/download/vX.Y.Z/...
  assert.deepStrictEqual(await download({ ...asset, name: "../x.exe" }, tmp, { urlOk: okUrl }), { error: "url" });
  assert.deepStrictEqual(await download({ ...asset, url: `${base}/dl/no-existe.exe` }, tmp, { urlOk: okUrl }), { error: "http" });
  assert.ok(ASSET_URL.test("https://github.com/FedericoChalaca/nimbo/releases/download/v0.9.0/Nimbo-Setup.exe") && !ASSET_URL.test("https://github.com/otro/nimbo/releases/download/v0.9.0/Nimbo-Setup.exe") && !ASSET_URL.test("http://github.com/FedericoChalaca/nimbo/releases/download/v0.9.0/Nimbo-Setup.exe"));
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
  console.log("updates.js ok");
})();

// Lo que suena en Spotify y sus botones (pausa, siguiente, anterior), sin cuenta, sin claves y sin Premium:
//   · Windows: los controles multimedia del sistema (media-watch.ps1).
//   · Linux: `playerctl` (el estándar MPRIS que usan las teclas de música). Hay que tenerlo instalado.
//   · macOS: AppleScript (la primera vez, macOS pide permiso para que Nimbo controle Spotify).
// Lo que llega (título, artista, carátula) lo escribe otra app: se valida y se recorta.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const ORDERS = new Set(["toggle", "next", "prev"]);
const ART = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Valida lo que emitió el script. null = no suena nada. */
function cleanMedia(raw) {
  if (!raw || typeof raw !== "object" || !str(raw.title, 200)) return null;
  const art = typeof raw.art === "string" && raw.art.length < 600_000 && ART.test(raw.art) ? raw.art : "";
  return { title: str(raw.title, 200), artist: str(raw.artist, 200), album: str(raw.album, 200), playing: raw.playing === true, art };
}

// --- Linux y macOS: se pregunta cada 2 s (y cada 250 ms durante 2 s tras una orden) ---
const ART_HOSTS = new Set(["i.scdn.co", "open.spotify.com", "mosaic.scdn.co"]); // de dónde se baja la carátula de Spotify

/** "título⇥artista⇥álbum⇥carátula⇥estado" (⇥ = tabulador) → lo que Nimbo necesita. null = no hay nada. */
function parseMediaLine(line) {
  const [title = "", artist = "", album = "", artUrl = "", status = ""] = String(line ?? "").replace(/\r?\n$/, "").split("\t");
  return title.trim() ? { title, artist, album, artUrl: artUrl.trim(), playing: /^playing$/i.test(status.trim()) } : null;
}

/** La carátula como imagen incrustada. Solo de hosts conocidos de Spotify, solo PNG/JPEG y de hasta 400 KB. */
async function fetchArt(url, { fetch: doFetch = fetch, hosts = ART_HOSTS, allowHttp = false } = {}) {
  let u;
  try { u = new URL(url); } catch { return ""; }
  if ((u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) || !hosts.has(u.hostname)) return "";
  const r = await doFetch(u, { signal: AbortSignal.timeout(6000) });
  const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!r.ok || !/^image\/(png|jpeg)$/.test(type)) return "";
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 0 && buf.length <= 400_000 ? `data:${type};base64,${buf.toString("base64")}` : "";
}

/**
 * Un vigilante que pregunta cada tanto en vez de recibir eventos.
 * @param read      () => texto de una línea (ver parseMediaLine)
 * @param command   (orden) => ejecuta "toggle" | "next" | "prev"
 */
function pollingWatcher({ read, command, onChange, art = fetchArt, interval = 2000 }) {
  let timer = null;
  let last = "";
  let stopped = false;
  let busy = false;
  let fast = 0;
  let artCache = { url: "", data: "" };
  async function tick() {
    let raw = null;
    try { raw = parseMediaLine(await read()); } catch {}
    let media = null;
    if (raw) {
      if (raw.artUrl !== artCache.url) artCache = { url: raw.artUrl, data: raw.artUrl ? await art(raw.artUrl).catch(() => "") : "" };
      media = cleanMedia({ ...raw, art: artCache.data });
    }
    const key = JSON.stringify(media);
    if (key !== last) { last = key; onChange(media); }
  }
  async function loop() {
    if (stopped || busy) return;
    busy = true;
    try { await tick(); } finally { busy = false; }
    if (!stopped) timer = setTimeout(loop, fast-- > 0 ? 250 : interval);
  }
  loop();
  return {
    send(order) {
      if (!ORDERS.has(order)) return;
      Promise.resolve().then(() => command(order)).catch(() => {}).then(() => { fast = 8; clearTimeout(timer); loop(); });
    },
    stop() { stopped = true; clearTimeout(timer); },
  };
}

const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 4000, windowsHide: true }, (e, out) => (e ? reject(e) : resolve(String(out)))));
const LINUX_FORMAT = "{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}\t{{status}}";
const MAC_READ = `if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then return ""
    return (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & (artwork url of current track) & tab & (player state as string)
  end tell
end if
return ""`;
const MAC_ORDERS = { toggle: "playpause", next: "next track", prev: "previous track" };
const LINUX_ORDERS = { toggle: "play-pause", next: "next", prev: "previous" };

/** Arranca el vigilante. Devuelve { send(orden), stop() }. */
function watchMedia(onChange) {
  if (process.platform === "linux") {
    return pollingWatcher({ onChange, read: () => run("playerctl", ["-p", "spotify", "metadata", "--format", LINUX_FORMAT]), command: (o) => run("playerctl", ["-p", "spotify", LINUX_ORDERS[o]]) });
  }
  if (process.platform === "darwin") {
    return pollingWatcher({ onChange, read: () => run("osascript", ["-e", MAC_READ]), command: (o) => run("osascript", ["-e", `tell application "Spotify" to ${MAC_ORDERS[o]}`]) });
  }
  const script = fs.readFileSync(path.join(__dirname, "media-watch.ps1"), "utf8").replace(/^\uFEFF/, "");
  // -EncodedCommand y ruta completa a PowerShell, igual que whatsapp.js.
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // ponytail: si PowerShell se cae no se relanza (Spotify sale de la isla hasta reiniciar Nimbo); relanzar si pasa de verdad.
  const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true });
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("media:")) continue;
      try { onChange(cleanMedia(JSON.parse(line.slice(6)))); } catch {}
    }
  });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.on("close", () => onChange(null));
  return {
    send(order) { if (ORDERS.has(order) && child.exitCode === null) child.stdin.write(`${order}\n`); },
    stop() { child.kill(); },
  };
}

module.exports = { watchMedia, cleanMedia, parseMediaLine, fetchArt, pollingWatcher };

// Prueba rápida: `node media.js` · en vivo (9 s, sin tocar nada): `node media.js ver`
if (require.main === module) {
  const assert = require("assert");
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.deepStrictEqual(cleanMedia({ title: "  Nada ", artist: "Penyair", album: "X", playing: true, art: png }),
    { title: "Nada", artist: "Penyair", album: "X", playing: true, art: png });
  assert.strictEqual(cleanMedia({ title: "a", playing: "true" }).playing, false);
  // La carátula solo puede ser una imagen PNG o JPEG en base64: nada de enlaces ni SVG.
  for (const bad of ["https://x.example/a.png", "data:image/svg+xml;base64,PHN2Zz4=", `${png}" onerror="x`, "data:text/html;base64,AAAA", 7, `data:image/png;base64,${"A".repeat(600_000)}`]) {
    assert.strictEqual(cleanMedia({ title: "a", art: bad }).art, "");
  }
  for (const none of [null, "texto", {}, { title: "   " }]) assert.strictEqual(cleanMedia(none), null);
  // Linux y macOS: leer una línea, la carátula y las órdenes (con un vigilante falso, sin Spotify ni playerctl).
  assert.deepStrictEqual(parseMediaLine("Nada\tPenyair\tLa Ley Del Todo\thttps://i.scdn.co/image/ab\tPlaying\n"), { title: "Nada", artist: "Penyair", album: "La Ley Del Todo", artUrl: "https://i.scdn.co/image/ab", playing: true });
  assert.strictEqual(parseMediaLine("Nada\ta\tb\t\tpaused").playing, false);
  assert.deepStrictEqual([parseMediaLine(""), parseMediaLine("\t\t\t\t"), parseMediaLine(null)], [null, null, null]);
  (async () => {
    const http = require("http");
    const big = Buffer.alloc(500_000, 1);
    const server = http.createServer((req, res) => {
      if (req.url === "/ok.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("PNGDATA")); }
      if (req.url === "/grande.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(big); }
      if (req.url === "/svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end("<svg/>"); }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const opt = { hosts: new Set(["127.0.0.1"]), allowHttp: true };
    assert.strictEqual(await fetchArt(`${base}/ok.png`, opt), `data:image/png;base64,${Buffer.from("PNGDATA").toString("base64")}`);
    for (const bad of [`${base}/grande.png`, `${base}/svg`, `${base}/no-existe`]) assert.strictEqual(await fetchArt(bad, opt), "");
    assert.strictEqual(await fetchArt(`${base}/ok.png`), ""); // sin permitir ese host (ni http): nada
    assert.strictEqual(await fetchArt("https://evil.example/a.png"), ""); // un host que no es de Spotify
    assert.strictEqual(await fetchArt("file:///etc/passwd", { hosts: new Set([""]), allowHttp: true }), "");
    server.close();
    // El vigilante: avisa solo cuando algo cambia, baja la carátula una vez por canción y ejecuta las órdenes.
    const lines = ["A\tx\ty\thttps://i.scdn.co/image/1\tPlaying", "A\tx\ty\thttps://i.scdn.co/image/1\tPlaying", "A\tx\ty\thttps://i.scdn.co/image/1\tPaused", ""];
    const seen = [];
    const arts = [];
    const orders = [];
    let i = 0;
    const w = pollingWatcher({ interval: 20, onChange: (m) => seen.push(m && [m.title, m.playing, m.art.length > 0]),
      read: async () => lines[Math.min(i++, lines.length - 1)], command: async (o) => { orders.push(o); },
      art: async (u) => { arts.push(u); return "data:image/png;base64,AAAA"; } });
    await new Promise((r) => setTimeout(r, 400));
    w.send("toggle"); w.send("hackear"); w.send("next");
    await new Promise((r) => setTimeout(r, 200));
    w.stop();
    assert.deepStrictEqual(seen, [["A", true, true], ["A", false, true], null]); // 4 lecturas, 3 cambios (la repetida no cuenta)
    assert.deepStrictEqual(arts, ["https://i.scdn.co/image/1"]); // la carátula, una sola vez
    assert.deepStrictEqual(orders, ["toggle", "next"]); // la orden inventada no pasa
    console.log("media.js ok");
  })();
  if (process.argv[2] === "ver") {
    const w = watchMedia((m) => console.log(m && { ...m, art: m.art ? `(${Math.round(m.art.length / 1024)} KB)` : "" }));
    setTimeout(() => w.stop(), 9000);
  }
}

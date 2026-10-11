// Lo que suena en Spotify y sus botones (pausa, siguiente, anterior), con los controles
// multimedia de Windows (media-watch.ps1): sin cuenta, sin claves y sin Premium.
// Lo que llega (título, artista, carátula) lo escribe otra app: se valida y se recorta.
const { spawn } = require("child_process");
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

/** Arranca el vigilante. Devuelve { send(orden), stop() }. */
function watchMedia(onChange) {
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

module.exports = { watchMedia, cleanMedia };

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
  console.log("media.js ok");
  if (process.argv[2] === "ver") {
    const w = watchMedia((m) => console.log(m && { ...m, art: m.art ? `(${Math.round(m.art.length / 1024)} KB)` : "" }));
    setTimeout(() => w.stop(), 9000);
  }
}

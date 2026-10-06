// Genera promo/nimbo.gif (el del README): solo la isla de Nimbo, sin textos, ~18 s.
// Misma idea que promo-main.js: interfaz real fuera de pantalla + API falsa + guion (gif-demo.js).
// Uso: npm run promo:gif
const { app, BrowserWindow, protocol, net } = require("electron");
const { pathToFileURL } = require("url");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");
const fs = require("fs");
const path = require("path");

const NIMBO = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "nimbo.gif");
const ZOOM = 1.1;
const W = Math.round(440 * ZOOM), H = Math.round(360 * ZOOM);
const FPS = 10;

app.setPath("userData", path.join(app.getPath("temp"), "nimbo-promo-userdata"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
protocol.registerSchemesAsPrivileged([
  { scheme: "nimbo", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
// Fondo liso: en un GIF comprime mucho mejor que un degradado y no hace bandas.
const CSS = `html, body { margin: 0 !important; height: 100%; overflow: hidden !important; background: #10121b !important; }
  #nimbo { height: 100% !important; }`;

app.whenReady().then(() => {
  protocol.handle("nimbo", (req) => {
    const file = path.resolve(NIMBO, "." + decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(NIMBO + path.sep)) return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, backgroundColor: "#10121b",
    webPreferences: { offscreen: true, preload: path.join(__dirname, "promo-preload.js"), contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  win.webContents.setAudioMuted(true);

  let latest = null;
  const frames = [];
  win.webContents.on("paint", (_e, _dirty, image) => { latest = image; });
  win.webContents.on("dom-ready", () => {
    win.webContents.setZoomFactor(ZOOM);
    win.webContents.insertCSS(CSS);
  });
  win.webContents.once("did-finish-load", async () => {
    // Un cuadro cada 100 ms, haya cambiado la pantalla o no: el GIF dura lo mismo que el guion.
    // (Desde los 700 ms, para que el primer cuadro ya muestre a Nimbo y no el fondo vacío.)
    const started = Date.now();
    const timer = setInterval(() => {
      if (!latest || Date.now() - started < 700) return;
      frames.push(latest.toBitmap());
      // Una muestra cada 4 s en la carpeta temporal, para revisar el resultado sin abrir el GIF.
      if (frames.length % 40 === 20) fs.writeFileSync(path.join(app.getPath("temp"), `nimbo-gif-${frames.length}.png`), latest.toPNG());
    }, 1000 / FPS);
    try {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, "gif-demo.js"), "utf8"));
    } catch (e) {
      console.log("ERROR en el guion:", e.message);
    }
    clearInterval(timer);
    const size = latest.getSize();
    // BGRA → RGBA, y una paleta única sacada de una muestra de todos los cuadros (sin parpadeo).
    for (const f of frames) for (let i = 0; i < f.length; i += 4) { const b = f[i]; f[i] = f[i + 2]; f[i + 2] = b; }
    const step = Math.max(1, Math.floor(frames.length / 24));
    const sample = Buffer.concat(frames.filter((_f, i) => i % step === 0));
    const palette = quantize(sample, 256);
    const gif = GIFEncoder();
    for (const f of frames) gif.writeFrame(applyPalette(f, palette), size.width, size.height, { palette, delay: 1000 / FPS });
    gif.finish();
    fs.writeFileSync(OUT, gif.bytes());
    console.log("gif:", OUT, (gif.bytes().length / 1e6).toFixed(1) + " MB,", frames.length, "cuadros,", `${size.width}×${size.height}`);
    app.quit();
  });
  win.loadURL("nimbo://app/index.html?lang=en"); // el README principal está en inglés
});
setTimeout(() => { console.log("tiempo agotado"); app.exit(1); }, 120_000);

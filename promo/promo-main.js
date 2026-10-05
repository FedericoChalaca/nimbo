// Graba un video de demostración de Nimbo sin tocar la pantalla del usuario:
// carga la interfaz REAL (index.html) en una ventana fuera de pantalla, con una API falsa
// (promo-preload.js) y un guion (promo-demo.js), y manda cada cuadro a una segunda ventana
// oculta que lo codifica con MediaRecorder (encoder.html).
// Uso: npm run promo  → promo/nimbo-promo.mp4 (tarda ~80 s y no muestra ninguna ventana)
const { app, BrowserWindow, protocol, net, ipcMain } = require("electron");
const { pathToFileURL } = require("url");
const fs = require("fs");
const path = require("path");

const NIMBO = path.resolve(__dirname, "..");
const OUT = process.argv[2] || path.join(__dirname, "nimbo-promo");
const FRAMES = path.join(app.getPath("temp"), "nimbo-promo-frames"); // una muestra cada 1,5 s, para revisar
const W = 1280, H = 720;

app.setPath("userData", path.join(app.getPath("temp"), "nimbo-promo-userdata")); // nada del perfil real de Nimbo
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([
  { scheme: "nimbo", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let recording = false;
let frames = 0;
app.whenReady().then(() => {
  protocol.handle("nimbo", (req) => {
    const file = path.resolve(NIMBO, "." + decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(NIMBO + path.sep)) return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const enc = new BrowserWindow({ width: W, height: H, show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  enc.loadFile(path.join(__dirname, "encoder.html"));

  ipcMain.once("ready", (_e, type) => {
    console.log("codificador:", type);
    const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, backgroundColor: "#0c0e16",
      webPreferences: { offscreen: true, preload: path.join(__dirname, "promo-preload.js"), contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    win.webContents.setFrameRate(30);
    win.webContents.setAudioMuted(true);
    win.webContents.on("paint", (_e2, _dirty, image) => {
      if (!recording) return;
      const jpg = image.toJPEG(95);
      enc.webContents.send("frame", jpg);
      if (frames++ % 45 === 0) fs.writeFileSync(path.join(FRAMES, `f${String(Math.round(frames / 30)).padStart(3, "0")}s.jpg`), jpg);
    });
    win.webContents.on("console-message", (_e3, _lvl, msg) => console.log("página:", msg));
    win.webContents.on("dom-ready", () => {
      win.webContents.setZoomFactor(1.5);
      win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, "promo.css"), "utf8"));
    });
    win.webContents.once("did-finish-load", async () => {
      recording = true;
      try {
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, "promo-demo.js"), "utf8"));
      } catch (e) {
        console.log("ERROR en el guion:", e.message);
      }
      recording = false;
      enc.webContents.send("stop");
    });
    win.loadURL("nimbo://app/index.html");
  });

  ipcMain.once("video", (_e, type, buf) => {
    const file = OUT + (type.includes("mp4") ? ".mp4" : ".webm");
    fs.writeFileSync(file, Buffer.from(buf));
    console.log("video:", file, (buf.length / 1e6).toFixed(1) + " MB,", frames, "cuadros");
    app.quit();
  });
});
setTimeout(() => { console.log("tiempo agotado"); app.exit(1); }, 150_000);

// Volumen de la app que suena (Spotify, el navegador…) con volumen.cs: el mismo control del mezclador de Windows.
// Solo Windows. El nombre del proceso sale de una lista fija según el reproductor que informa media.js: la página nunca lo manda.
const path = require("path");
const { execFile } = require("child_process");
const { ensureExe } = require("./windows");

const PROCESS = { Spotify: "spotify", Chrome: "chrome", Edge: "msedge", Brave: "brave", Firefox: "firefox", "Apple Music": "AppleMusic", Reproductor: "Media" };
const procOf = (app) => PROCESS[app] ?? null;

function createVolume(binDir) {
  let exe = null;
  const run = (args) => new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(-1);
    try { exe ??= ensureExe(binDir, path.join(__dirname, "volumen.cs"), "volumen"); } catch { return resolve(-1); }
    execFile(exe, args, { windowsHide: true, timeout: 4000 }, (_e, out) => {
      try { const v = JSON.parse(String(out).trim()).v; resolve(Number.isInteger(v) && v >= -1 && v <= 100 ? v : -1); } catch { resolve(-1); }
    });
  });
  return {
    /** 0–100, o -1 si esa app no tiene sonido abierto (o no se pudo). */
    get: (app) => (procOf(app) ? run(["get", procOf(app)]) : Promise.resolve(-1)),
    set: (app, v) => {
      const n = Math.round(Number(v));
      return procOf(app) && n >= 0 && n <= 100 ? run(["set", procOf(app), String(n)]) : Promise.resolve(-1);
    },
  };
}

module.exports = { createVolume, procOf };

// Autoprueba: `node src/integrations/volume.js` (con "ver" compila el ayudante y lee el volumen de Spotify, sin cambiarlo)
if (require.main === module) {
  const assert = require("assert");
  assert.strictEqual(procOf("Spotify"), "spotify");
  assert.strictEqual(procOf("calc.exe; rm"), null);
  (async () => {
    const v = createVolume(require("os").tmpdir());
    assert.strictEqual(await v.set("Spotify", 150), -1); // fuera de rango: ni lo intenta
    assert.strictEqual(await v.get("Nada"), -1);
    console.log("volume.js ok");
    if (process.argv[2] === "ver") console.log("Spotify:", await v.get("Spotify"));
  })();
}

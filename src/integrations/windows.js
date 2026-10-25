// Nimbo como barra de tareas (solo Windows): las ventanas abiertas en la isla, cambiar entre ellas y la barra de Windows en
// auto-ocultar. El trabajo con Windows lo hace ventanas.cs, que se compila una vez con el csc.exe que trae Windows (sin instalar nada)
// en la carpeta de datos de Nimbo; un programa de ~10 KB gasta mucho menos que otro PowerShell abierto.
// Sin Electron, para poder probarlo: `node src/integrations/windows.js`.
const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "ventanas.cs");
const CSC = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

/** Compila ventanas.cs si hace falta (el nombre lleva el hash del código: una versión nueva se recompila sola). → ruta del .exe */
function ensureExe(binDir) {
  const src = fs.readFileSync(SOURCE);
  const exe = path.join(binDir, `ventanas-${crypto.createHash("sha1").update(src).digest("hex").slice(0, 10)}.exe`);
  if (fs.existsSync(exe)) return exe;
  if (!fs.existsSync(CSC)) throw new Error("csc");
  fs.mkdirSync(binDir, { recursive: true });
  execFileSync(CSC, ["-nologo", "-optimize", `-out:${exe}`, SOURCE], { windowsHide: true, timeout: 60_000 });
  for (const old of fs.readdirSync(binDir)) if (/^ventanas-.*\.exe$/.test(old) && path.join(binDir, old) !== exe) fs.rmSync(path.join(binDir, old), { force: true });
  return exe;
}

/** Una línea del programa → { windows: [...] } | { autohide: 0|1 } | null. Las ventanas se validan: el resto de Nimbo confía en esto. */
function parseLine(line) {
  let o;
  try { o = JSON.parse(String(line).trim()); } catch { return null; }
  if (Array.isArray(o?.windows)) {
    return { windows: o.windows.filter((w) => /^\d{1,20}$/.test(w?.h)).map((w) => ({ h: w.h, title: String(w.t ?? "").slice(0, 200), path: String(w.p ?? ""), desc: String(w.d ?? "").slice(0, 80), min: w.m === true, fg: w.f === true })) };
  }
  if (o && (o.autohide === 0 || o.autohide === 1)) return { autohide: o.autohide };
  return null;
}

/** Nombre para mostrar: la descripción del .exe, sin colas técnicas ("Steam Client WebHelper" → "Steam", "WhatsApp.Root" → "WhatsApp"). */
const appName = (desc) => String(desc ?? "").replace(/\s+(Client\s+)?(Web)?Helper$/i, "").replace(/^(\w+)(\.\w+)+$/, "$1").trim();

/**
 * Agrupa las ventanas por programa, en el orden en que aparecieron (como la barra de Windows: los íconos no saltan de lugar).
 * order: Map programa → orden de llegada (se actualiza aquí). → [{ key, name, path, windows, fg, min }]
 */
function groupApps(windows, order) {
  const groups = new Map();
  for (const w of windows) {
    const key = (w.path || w.title).toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, name: appName(w.desc) || path.basename(w.path || "", ".exe") || w.title, path: w.path, windows: [] });
    groups.get(key).windows.push({ h: w.h, title: w.title, min: w.min, fg: w.fg });
  }
  for (const key of groups.keys()) if (!order.has(key)) order.set(key, order.size ? Math.max(...order.values()) + 1 : 0);
  for (const key of [...order.keys()]) if (!groups.has(key)) order.delete(key);
  return [...groups.values()].sort((a, b) => order.get(a.key) - order.get(b.key))
    .map((g) => ({ ...g, fg: g.windows.some((w) => w.fg), min: g.windows.every((w) => w.min) }));
}

/**
 * @param binDir   dónde guardar el .exe compilado
 * @param onApps   (apps) => cada vez que cambian las ventanas
 * @param onAutoHide (0|1) => estado de la barra de Windows
 * @param hide     esconder la barra de Windows mientras el programa corre (vuelve sola al apagarlo, aunque Nimbo se cierre de golpe)
 */
function createWindows({ binDir, onApps, onAutoHide = () => {}, onError = () => {}, hide = false, platform = process.platform }) {
  let child = null;
  let want = false;
  let restart = 0;
  let fails = 0;
  let last = [];
  const order = new Map();

  function launch() {
    if (!want || child || platform !== "win32") return;
    let exe;
    try { exe = ensureExe(binDir); } catch (e) { want = false; return onError(e.message === "csc" ? "csc" : "compile"); }
    // detached: si no, Node lo mete en un "job" de Windows que lo mata junto con Nimbo, y si Nimbo se cierra de golpe la barra no
    // alcanza a volver. Suelto, nota que Nimbo ya no está (se le cierra la entrada), devuelve la barra y se va.
    child = spawn(exe, hide ? [String(process.pid), "hide"] : [String(process.pid)], { windowsHide: true, detached: true });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const ev = parseLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (ev?.windows) { fails = 0; last = ev.windows; onApps(groupApps(ev.windows, order)); }
        if (ev && "autohide" in ev) onAutoHide(ev.autohide);
      }
    });
    child.stdin.on("error", () => {});
    const me = child;
    // Si no arranca (pasó al prender el PC: Windows todavía revisaba el programa) o se cae, se vuelve a intentar cada vez más espaciado.
    const again = () => { if (child !== me) return; child = null; if (want) { clearTimeout(restart); restart = setTimeout(launch, Math.min(30_000, 1000 * 2 ** fails++)); } };
    me.on("error", again);
    me.on("exit", again);
  }

  const send = (line) => { if (child && child.exitCode === null) child.stdin.write(line + "\n"); };
  return {
    set(on) {
      want = !!on && platform === "win32";
      if (want) return launch();
      clearTimeout(restart);
      const c = child;
      child = null;
      // Cerrarle la entrada lo hace terminar solo y devolver la barra; matarlo de una la dejaría escondida.
      c?.stdin.end();
      if (c) setTimeout(() => { if (c.exitCode === null) c.kill(); }, 1500).unref();
      onApps([]);
    },
    /** focus / min / close de una ventana que esté en la última lista (la página nunca manda otra cosa). */
    act(action, h) {
      if (!["focus", "min", "close"].includes(action) || !last.some((w) => w.h === String(h))) return false;
      send(`${action} ${h}`);
      return true;
    },
    autoHide(on) { send(`autohide ${on ? 1 : 0}`); },
    state() { send("state"); },
    stop() { this.set(false); },
  };
}

module.exports = { createWindows, parseLine, groupApps, ensureExe, appName };

// Autoprueba: node src/integrations/windows.js  (en Windows también compila el programa y lee las ventanas de verdad)
if (require.main === module) (async () => {
  const assert = require("assert");
  const os = require("os");
  assert.strictEqual(parseLine("basura"), null);
  assert.deepStrictEqual(parseLine('{"autohide":1}'), { autohide: 1 });
  const p = parseLine('{"windows":[{"h":"12","t":"Doc \\"uno\\"","p":"C:\\\\x\\\\code.exe","d":"Visual Studio Code","m":false,"f":true},{"h":"abc","t":"mala"}]}');
  assert.deepStrictEqual(p.windows, [{ h: "12", title: 'Doc "uno"', path: "C:\\x\\code.exe", desc: "Visual Studio Code", min: false, fg: true }]); // un id raro se descarta
  // Agrupar: por programa, en orden de llegada, estable aunque cambie el orden de Windows.
  const order = new Map();
  const w = (h, path, fg = false, min = false) => ({ h, title: "t" + h, path, desc: "", min, fg });
  let g = groupApps([w("1", "C:\\a\\code.exe"), w("2", "C:\\b\\brave.exe", true), w("3", "C:\\a\\code.exe", false, true)], order);
  assert.deepStrictEqual(g.map((x) => [x.name, x.windows.length, x.fg]), [["code", 2, false], ["brave", 1, true]]);
  g = groupApps([w("2", "C:\\b\\brave.exe"), w("1", "C:\\a\\code.exe"), w("9", "C:\\c\\spotify.exe")], order);
  assert.deepStrictEqual(g.map((x) => x.name), ["code", "brave", "spotify"]); // el nuevo va al final; los demás no se mueven
  assert.deepStrictEqual(["Steam Client WebHelper", "WhatsApp.Root", "Visual Studio Code", "Brave Browser"].map(appName), ["Steam", "WhatsApp", "Visual Studio Code", "Brave Browser"]);
  assert.strictEqual(groupApps([w("5", "C:\\c\\x.exe", false, true)], new Map())[0].min, true);
  if (process.platform !== "win32") return console.log("windows.js ok (sin Windows: solo lo básico)");
  // De verdad: compila, arranca, recibe la lista y no acepta ventanas que no estén en ella.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-ventanas-"));
  let apps = null;
  const win = createWindows({ binDir: bin, onApps: (a) => { if (a.length) apps = a; } });
  win.set(true);
  for (let i = 0; i < 50 && !apps; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(Array.isArray(apps) && apps.length > 0, "no llegó la lista de ventanas");
  assert.strictEqual(win.act("focus", "999999999999"), false);
  assert.strictEqual(win.act("borrar", apps[0].windows[0].h), false);
  win.stop();
  await new Promise((r) => setTimeout(r, 800)); // que el programa termine de cerrarse antes de borrar su carpeta
  try { fs.rmSync(bin, { recursive: true, force: true }); } catch {}
  console.log(`windows.js ok (compilado y leyó ${apps.length} programas abiertos)`);
})();

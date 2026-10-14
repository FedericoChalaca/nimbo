// Prueba de humo: arranca Nimbo DE VERDAD (con sus datos en una carpeta temporal) y comprueba que carga, que su
// panel responde y que el servidor de hooks escucha. La usa el CI en Linux y macOS (y sirve en Windows).
//   node scripts/smoke.js         (en Linux sin pantalla: xvfb-run -a node scripts/smoke.js)
// OJO: usa el puerto 47823 (el de los hooks): en tu PC cierra Nimbo antes. Necesita Node 22 o más (WebSocket incluido).
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const PORT = 9477;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-smoke-"));
const electron = require("electron"); // la ruta del ejecutable de Electron instalado
const log = [];
// NIMBO_SMOKE_EXE: probar el paquete INSTALADO (el .deb, el .app) en vez del código. En el CI (máquina desechable) Nimbo usa sus
// carpetas normales, y así se comprueba también que hook.js encuentra el token donde la app lo guarda; en tu PC, datos temporales.
const packaged = process.env.NIMBO_SMOKE_EXE;
const isolate = !process.env.CI;
const child = spawn(packaged || electron, [...(packaged ? [] : ["."]), "--no-sandbox", `--remote-debugging-port=${PORT}`, ...(isolate ? [`--user-data-dir=${tmp}`] : []), ...(process.platform === "linux" ? ["--disable-gpu"] : [])],
  { cwd: root, env: { ...process.env, NIMBO_SMOKE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => log.push(String(d)));
child.stderr.on("data", (d) => log.push(String(d)));
let exited = null;
child.on("exit", (code, signal) => { exited = { code, signal }; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    if (exited) throw new Error(`Nimbo se cerró solo (${JSON.stringify(exited)}) mientras esperaba: ${what}`);
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() > end) throw new Error(`tiempo agotado esperando: ${what}`);
    await sleep(500);
  }
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("no pude abrir el WebSocket de depuración")); });
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d.result); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    setTimeout(() => reject(new Error("la página no respondió en 60 s")), 60_000);
  });
  ws.close();
  if (result.exceptionDetails) throw new Error(`error en la página: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
  return result.result.value;
}

function stop() {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

(async () => {
  try {
    const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page" && p.url.includes("index.html")), 90_000, "que cargue la ventana de Nimbo");
    console.log("ok  la ventana cargó:", page.url.replace(/\?.*/, ""));
    // La página puede seguir cargando cuando aparece en la lista: se espera hasta que TODO esté definido.
    let state = {};
    await waitFor(async () => {
      state = await evaluate(page.webSocketDebuggerUrl, `(async () => ({ api: typeof api, setState: typeof setState, renderApps: typeof renderApps, mailBtn: !!document.getElementById("mailBtn"), aiSelect: !!document.getElementById("ai") }))()`);
      return Object.values(state).every((v) => v && v !== "undefined");
    }, 45_000, "que la página defina sus funciones");
    console.log("ok  la página está completa");
    const setup = await evaluate(page.webSocketDebuggerUrl, `api.setup()`);
    if (setup.platform !== process.platform) throw new Error(`la plataforma de Nimbo (${setup.platform}) no es ${process.platform}`);
    console.log(`ok  el panel de conexiones responde (plataforma ${setup.platform}; claude: ${setup.claude}; hooks: ${setup.hooks})`);
    const hook = await fetch("http://127.0.0.1:47823/hook").catch(() => null);
    if (!hook || hook.status !== 404) throw new Error("el servidor de hooks no está escuchando en 127.0.0.1:47823");
    console.log("ok  el servidor de hooks escucha (y rechaza lo que no está firmado)");
    // Lo esencial: un evento de un hook (el mismo comando que Claude Code ejecutaría) llega a la isla. Solo en el CI y no en Windows
    // (ahí la carpeta de datos temporal no coincide con la que lee hook.js).
    if (process.env.CI && process.platform !== "win32") {
      let command = `node "${path.join(root, "hook.js")}"`;
      if (packaged) {
        await evaluate(page.webSocketDebuggerUrl, `api.setupDo("hooks-on")`);
        const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
        command = settings.hooks.UserPromptSubmit[0].hooks[0].command;
      }
      const event = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "smoke-session", cwd: root, prompt: "hola" });
      require("child_process").execSync(command, { input: event, timeout: 20_000, stdio: ["pipe", "ignore", "inherit"] });
      await waitFor(() => evaluate(page.webSocketDebuggerUrl, `sessions.has("smoke-session")`), 15_000, "que el hook llegue a la isla");
      console.log(`ok  el hook llegó a la isla (${packaged ? "comando instalado: " + command : "desde el código"})`);
    }
    const media = await evaluate(page.webSocketDebuggerUrl, `api.media()`);
    console.log(`ok  la música responde (${media ? "algo suena" : "sin Spotify, como se espera"})`);
    console.log("PRUEBA DE HUMO: todo bien");
    stop();
    process.exit(0);
  } catch (e) {
    console.error("PRUEBA DE HUMO FALLÓ:", e.message);
    console.error("--- salida de Nimbo (últimas líneas) ---\n" + log.join("").split("\n").slice(-40).join("\n"));
    stop();
    process.exit(1);
  }
})();

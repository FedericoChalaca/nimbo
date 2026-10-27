// Nimbo: ventana transparente arriba de la pantalla + servidor local que recibe
// los hooks de Claude Code y se los pasa al personaje.
const { app, BrowserWindow, powerMonitor, screen, ipcMain, Menu, globalShortcut, session, protocol, net, shell, Notification, clipboard, desktopCapturer, Tray, nativeImage, safeStorage, dialog } = require("electron");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createOrchestrator, sessionTitle, sessionContext, claudeFound, listSessions } = require("./orchestrator");
const { createVillage } = require("./village");
const { createWake, createLive } = require("../integrations/wake");
const { createWindows, AUMID } = require("../integrations/windows");
const hooks = require("./install-hooks");
const { translator } = require("../shared/i18n");
const { createReminders } = require("./reminders");
const { createTrello } = require("../integrations/trello");
const { searchSpotify, TRACK_URI } = require("../integrations/spotify");
const { watchMedia } = require("../integrations/media");
const { fetchLyrics } = require("../integrations/lyrics");
const { askInterview } = require("./interview");
const { createMusicBar } = require("./musicbar");
const { extraBinDirs, findInPath, ollamaLocations, userDataDir } = require("./platform");
const { createAlerts } = require("./alerts");
const { createMail, threadUrl } = require("../integrations/mail");
const { createAi, pullModel, RECOMMENDED, KEYED, KEY_FORMAT } = require("../integrations/ai");
const { createClaudeApi, HAIKU } = require("../integrations/claude-api");
const updates = require("./updates");
const { foreground, isWatching } = require("./foreground");
const { cleanDelegates, imageFileName, insideDir } = require("./delegate");
const { createTelegram, parseInbox } = require("../integrations/telegram");
const { createSpotifyApi, CLIENT_ID } = require("../integrations/spotify-api");
const { createWhatsapp } = require("../integrations/whatsapp");
const { fetchSpeech, speechUrl } = require("./tts");
const { readPlan, planSpeech } = require("./plan");
const { createRemoteApi } = require("./remote-api");

// La carpeta de Nimbo (donde están package.json, hook.js, node_modules y assets). Este archivo vive en src/main.
const ROOT = path.resolve(__dirname, "..", "..");
// macOS y Linux: una app gráfica arranca con un PATH mínimo; se le suman las carpetas donde viven `claude`, `gh`, `ollama`, `playerctl`.
if (process.platform !== "win32") process.env.PATH = [...new Set([...extraBinDirs(), ...String(process.env.PATH ?? "").split(path.delimiter)])].join(path.delimiter);
// En un AppImage el sandbox de Chromium no puede usar su ayudante con permisos especiales (Ubuntu 24.04 lo bloquea): sin esto no abre.
if (process.env.APPIMAGE) app.commandLine.appendSwitch("no-sandbox");
const PORT = 47823;
// Ancho de la ventana (transparente: fuera de la isla no atrapa el mouse). En modo barra es más ancha: caben el texto, Nimbo y tus programas.
let W = 440; // se ajusta al leer prefs (setWinWidth)
const H = 480;
// Alto real de la ventana: la página lo pide según lo que muestra (isla compacta ≈ 130 px, abierta = H). La ventana es
// transparente y Windows copia la ventana ENTERA en cada cuadro animado: cuanto más chica, menos gasta.
let winH = H;
const MINI_SHORTCUT = "Control+Alt+N";
// Acceso rápido (como el de la app de Claude): abre el chat de Nimbo desde cualquier programa.
const ASK_SHORTCUT = "Control+Alt+Space";
// Si nadie decide en este tiempo, la pregunta vuelve a la terminal.
const DECISION_TIMEOUT = 60_000;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0); // sin esto el resto del archivo corría y pisaba el token de la instancia viva
}

// La app se sirve como nimbo://app/ y no como file://: con file:// Chromium bloquea los
// workers de tipo módulo (Whisper) y la caché del modelo. Los encabezados COOP/COEP
// activan SharedArrayBuffer, que deja a Whisper usar varios hilos.
protocol.registerSchemesAsPrivileged([
  { scheme: "nimbo", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
function serveAppFiles() {
  protocol.handle("nimbo", async (req) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url).pathname));
    // Solo archivos de la carpeta de Nimbo: nada de ../ para salir de ahí.
    if (!file.startsWith(ROOT + path.sep)) return new Response("", { status: 403 });
    const res = await net.fetch(pathToFileURL(file).href).catch(() => null);
    if (!res) return new Response("", { status: 404 }); // el archivo no existe
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    headers.set("Cache-Control", "no-cache"); // archivos locales: siempre la versión actual
    return new Response(res.body, { status: res.status, headers });
  });
}

// Secreto compartido con hook.js. Vive en %APPDATA%\nimbo, que solo puede leer tu
// usuario, y cambia en cada arranque. Nunca viaja por la red: solo firmas HMAC.
const TOKEN = crypto.randomBytes(32).toString("hex");
const tokenFile = path.join(app.getPath("userData"), "token");
fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
const mac = (msg) => crypto.createHmac("sha256", TOKEN).update(msg).digest("hex");
const sameMac = (a, b) => {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

let win;
let tray; // se guarda aquí para que no lo recoja el recolector de basura
let muted = false;

function createWindow() {
  const start = dockBounds();
  win = new BrowserWindow({
    ...start,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin") win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // la isla sigue al usuario entre escritorios
  // Los clics atraviesan la ventana salvo sobre la nube y las cajas (ver más abajo).
  win.setIgnoreMouseEvents(true);
  win.loadURL(pageUrl());
  // Soltar un archivo en la ventana no debe abrirlo como página: lo maneja index.html.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("did-finish-load", () => {
    win.webContents.send("theme", prefs.theme);
    win.webContents.send("wake-on", prefs.wakeWord === true && !mini);
    win.webContents.send("dock", dockState().edge);
    win.webContents.send("anchor", dockState().pos);
    if (mini) win.webContents.send("mini", true); // tras recargar (cambio de idioma)
    if (plan) win.webContents.send("plan", planView(false)); // idem: la página recargada vuelve a tener el plan
    win.webContents.send("name", String(prefs.name ?? ""));
    // Primera vez: se abre solo el panel de conexiones para dejar todo andando.
    if (!prefs.onboarded) setTimeout(() => { if (!mini && !win.isDestroyed()) win.webContents.send("setup-open"); }, 4500);
    if (whatsapp) win.webContents.send("whatsapp", whatsapp);
    if (lastTasks) win.webContents.send("tasks", lastTasks);
  });

  // Cada 33 ms: los ojos siguen al cursor por toda la pantalla, y si el cursor está
  // sobre una parte tocable la ventana deja de ser "transparente" a los clics.
  // No se usa { forward: true }: el reenvío de mouse de Electron en Windows dejaba
  // de funcionar y Nimbo no se podía tocar.
  let last = "";
  let over = false;
  setInterval(() => {
    if (win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // Ningún arrastre dura medio minuto: si la página no avisó que terminó, se corta aquí
    // para que Nimbo nunca quede pegado al cursor.
    if (drag && Date.now() - drag.since > 30_000) {
      drag = null;
      savePrefs();
      win.webContents.send("drag-abort");
    }
    if (drag) {
      // Arrastrando, la ventana entera (la isla con sus franjas) viaja pegada al cursor, en cualquier pantalla, sin cambiar de forma;
      // cerca de un borde, la página muestra que se va a pegar ahí. Solo al soltar se decide dónde queda.
      drag.gx += (drag.tx - drag.gx) * 0.3; // cada 33 ms se acerca un 30 %: en ~0,3 s queda en el punto del clic
      drag.gy += (drag.ty - drag.gy) * 0.3;
      const wx = Math.round(p.x - drag.gx), wy = Math.round(p.y - drag.gy);
      if (wx !== b.x || wy !== b.y) win.setBounds({ x: wx, y: wy, width: drag.w, height: drag.h });
      const snap = snapEdge(p);
      if (snap !== drag.snap) { drag.snap = snap; win.webContents.send("drag-snap", snap); }
      return;
    }
    const x = p.x - b.x;
    const y = p.y - b.y;
    const inside = hitRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (inside !== over) {
      over = inside;
      win.setIgnoreMouseEvents(!inside);
      win.webContents.send("hover", inside);
    }
    const key = `${x},${y}`;
    if (key === last) return;
    last = key;
    win.webContents.send("cursor", { x, y });
  }, 33);
}

// Arrastrar a Nimbo por el borde superior: la página avisa cuándo empieza (con el ancho de
// la isla y el punto de agarre) y cuándo termina; el bucle del cursor mueve la ventana.
let drag = null;
ipcMain.on("drag-start", (_e, d) => {
  if (mini) return;
  const wb = win.getBounds(), cur = screen.getCursorScreenPoint();
  windows.watchLeft(); // red de seguridad: el botón izquierdo de verdad (si la página pierde el "soltar", igual se suelta)
  // gx/gy = dónde va el mouse dentro de la ventana. Arranca donde está ahora (pasada la resistencia) y se va acercando (tx/ty) al punto donde
  // hiciste clic: así Nimbo vuelve a quedar agarrado justo de ahí, con un tirón suave y no de golpe.
  const ok = (v) => Number.isFinite(v) && Math.abs(v) < 100_000;
  const tx = ok(d?.x) ? d.x - wb.x : cur.x - wb.x, ty = ok(d?.y) ? d.y - wb.y : cur.y - wb.y;
  drag = { since: Date.now(), snap: dockState().edge === "float" ? "" : dockState().edge, gx: cur.x - wb.x, gy: cur.y - wb.y, tx, ty, w: wb.width, h: wb.height };
  win.setIgnoreMouseEvents(false); // mientras se arrastra, la ventana no suelta el mouse
});
// Al soltar: cerca de un borde (de la pantalla donde está el cursor) se pega a ese borde en ese punto; lejos, queda flotando ahí.
ipcMain.on("drag-end", () => finishDrag(false));
function finishDrag(fromHelper) {
  if (!drag) return;
  drag = null;
  const p = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(p);
  const a = disp.workArea;
  const edge = snapEdge(p) || "float";
  const frac = (v, from, len, size) => Math.min(1, Math.max(0, (v - from - size / 2) / Math.max(1, len - size)));
  prefs.dock = edge === "float" ? { edge, display: disp.id, x: Math.round(p.x), y: Math.round(p.y - 34) }
    : { edge, display: disp.id, pos: edge === "top" || edge === "bottom" ? frac(p.x, a.x, a.width, W) : frac(p.y, a.y, a.height, SIDE_H) };
  savePrefs();
  placeWindow();
  win.webContents.send("dock", edge);
  win.webContents.send("anchor", dockState().pos);
  if (fromHelper) win.webContents.send("drag-abort"); // la página termina su arrastre (si no lo había hecho ya)
}

ipcMain.on("win-height", (_e, h) => {
  h = Math.round(Number(h));
  if (!Number.isFinite(h)) return;
  winH = Math.min(H, Math.max(100, h));
  if (mini || drag || !win || win.isDestroyed()) return;
  const edge = dockState().edge;
  if (edge !== "top" && edge !== "bottom") return; // a los lados y flotando la ventana tiene tamaño fijo
  const b = win.getBounds();
  if (b.height !== winH) win.setBounds(dockBounds());
});

// Zonas tocables (la nube y las cajas visibles), en coordenadas de la ventana.
let hitRects = [];
ipcMain.on("hit-rects", (_e, rects) => {
  if (Array.isArray(rects)) hitRects = rects.filter((r) => [r?.x, r?.y, r?.w, r?.h].every(Number.isFinite));
});

// Modo mini (para jugar): Nimbo se encoge en una esquina y sigue reaccionando,
// pero sin sonidos ni tarjetas; los permisos se preguntan en la terminal.
let mini = false;
const prefsFile = path.join(app.getPath("userData"), "prefs.json");
// name: cómo te saluda · vault: carpeta de notas que el orquestador puede leer (opcional) ·
// whatsappRead: leer y resumir notificaciones de WhatsApp (apagado hasta que lo actives).
let prefs = { corner: "top-right", theme: "jarvis", pos: 0.5, name: "", vault: "", whatsappRead: false, waModel: "", onboarded: false,
  // Voz: "speak" es el interruptor; "ttsUrl", el servicio de texto a voz (ver tts.js). Sin dirección no hay voz.
  speak: false, ttsUrl: "",
  // Spotify con Premium (opcional): el Client ID de TU app de developer.spotify.com (ver spotify-api.js).
  spotifyClientId: "",
  // Entrenador de entrevistas: modelo de tu claude ("" = haiku, el más barato; "sonnet" para un entrenador más exigente).
  interviewModel: "sonnet",
  // Correo (mail.js): Nimbo revisa tu Gmail con el conector de tu claude. Apagado hasta que lo actives en Conexiones.
  mailRead: false,
  // Avisos al celular por Telegram (alerts.js): qué categorías mandan aviso y si solo cuando estás lejos del PC.
  telegramAlerts: { claude: true, reminders: true, mail: true, whatsapp: false, onlyAway: true },
  // Otras IAs en el chat (ai.js): cuál se usa ("claude", "ollama", "gemini", "openai") y, si quieres, el modelo de cada una.
  chatProvider: "claude", aiModels: {},
  // Barra flotante de música (musicbar.js): aparece cuando Spotify tiene algo cargado; se mueve y su sitio se guarda.
  musicBar: true, musicBarPos: null,
  // Modelo del chat de Nimbo, en la isla y en Telegram ("sonnet" por defecto; "" = el que use tu claude, normalmente el más caro; "haiku" gasta aún menos).
  chatModel: "sonnet",
  // Telegram (opcional): la cuenta vinculada (0 = ninguna). El token del bot NO va aquí: va cifrado en telegram.bin.
  telegramChat: 0,
  // Plan del día (ver plan.js): dónde está, y la fecha del último plan que ya te mostró.
  planRepo: "", planBranch: "", planFile: "", planSeen: "" };
// Tus ajustes nunca se pierden por un archivo dañado (el 2026-10-26 un prefs.json guardado con BOM no se pudo leer, Nimbo arrancó de fábrica y al
// guardar borró el modo barra, las ancladas y «Oye Nimbo»): se tolera el BOM, cada arranque bueno deja una copia (prefs.json.bak) y, si el archivo
// no se puede leer, se aparta como prefs.json.roto-<hora> y se usa la copia.
const readPrefs = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
try {
  prefs = { ...prefs, ...readPrefs(prefsFile) };
  fs.copyFileSync(prefsFile, prefsFile + ".bak");
} catch {
  if (fs.existsSync(prefsFile)) try { fs.copyFileSync(prefsFile, `${prefsFile}.roto-${Date.now()}`); } catch {}
  try { prefs = { ...prefs, ...readPrefs(prefsFile + ".bak") }; } catch {}
}
W = prefs.taskbarMode === true ? 640 : 440;
let corner = prefs.corner;
// Se escribe en un archivo aparte y se cambia de nombre: si el PC se apaga a mitad, prefs.json queda entero (el viejo o el nuevo).
const savePrefs = () => {
  const data = JSON.stringify({ ...prefs, corner });
  try { fs.writeFileSync(prefsFile + ".tmp", data); fs.renameSync(prefsFile + ".tmp", prefsFile); } catch { fs.writeFileSync(prefsFile, data); }
};
// Idioma: el elegido en el menú (prefs.lang) o, si no, el de Windows. Los textos están en
// español en el código; i18n.js trae el inglés.
const lang = () => (["es", "en"].includes(prefs.lang) ? prefs.lang : app.getLocale().toLowerCase().startsWith("es") ? "es" : "en");
const t = (s, ...a) => translator(lang())(s, ...a);
const pageUrl = () => `nimbo://app/src/renderer/index.html?lang=${lang()}`;
const MINI_W = 100;
const MINI_H = 60;
const MARGIN = 8;

// --- Dónde vive Nimbo (prefs.dock): pegado a un borde (arriba, abajo, izquierda, derecha) de cualquier pantalla, o flotando ---
// { edge, display (id de la pantalla), pos (0…1 a lo largo del borde), x, y (flotando: el centro de arriba de la isla) }.
const EDGES = ["top", "bottom", "left", "right", "float"];
const SIDE_W = 440, SIDE_H = 640; // a los lados: la ventana es vertical
const FLOAT_W = 440, FLOAT_H = 500; // abierta mide hasta 470 + 14 de margen arriba
function dockState() {
  const d = prefs.dock ?? {};
  return { edge: EDGES.includes(d.edge) ? d.edge : "top", display: d.display, pos: Number.isFinite(d.pos) ? d.pos : Number(prefs.pos) || 0.5, x: d.x, y: d.y };
}
const displayOf = (d) => screen.getAllDisplays().find((s) => s.id === d.display) ?? screen.getPrimaryDisplay();
function dockBounds() {
  const d = dockState();
  const a = displayOf(d).workArea;
  const clampIn = (v, from, len, size) => Math.round(Math.min(from + len - size, Math.max(from, v)));
  // Contra una esquina la ventana se corre 14 px hacia afuera de la pantalla (esa franja es transparente: son las "orejas" de la isla),
  // así la isla queda pegada al borde de verdad.
  const rowX = () => Math.round(a.x + d.pos * (a.width - W) + (d.pos <= 0.03 ? -14 : d.pos >= 0.97 ? 14 : 0));
  if (d.edge === "top") return { x: rowX(), y: a.y, width: W, height: winH };
  if (d.edge === "bottom") return { x: rowX(), y: a.y + a.height - winH, width: W, height: winH };
  const sideH = Math.min(SIDE_H, a.height);
  if (d.edge === "left") return { x: a.x, y: Math.round(a.y + d.pos * (a.height - sideH)), width: SIDE_W, height: sideH };
  if (d.edge === "right") return { x: a.x + a.width - SIDE_W, y: Math.round(a.y + d.pos * (a.height - sideH)), width: SIDE_W, height: sideH };
  return { x: clampIn((d.x ?? a.x + a.width / 2) - FLOAT_W / 2, a.x, a.width, FLOAT_W), y: clampIn((d.y ?? a.y + 40) - 14, a.y, a.height, FLOAT_H), width: FLOAT_W, height: FLOAT_H };
}
function setDock(d) {
  prefs.dock = { edge: d.edge, display: displayOf(d).id, pos: Number.isFinite(d.pos) ? d.pos : 0.5, x: d.x, y: d.y };
  savePrefs();
  if (!win || win.isDestroyed() || mini) return;
  placeWindow();
  win.webContents.send("dock", d.edge);
  win.webContents.send("anchor", dockState().pos);
}
// ¿Cerca de qué borde está el cursor? (70 px; "" = lejos de todos: flotando)
function snapEdge(p) {
  const a = screen.getDisplayNearestPoint(p).workArea;
  const near = [["top", p.y - a.y], ["bottom", a.y + a.height - p.y], ["left", p.x - a.x], ["right", a.x + a.width - p.x]].filter(([, dist]) => dist < 70).sort((x, y) => x[1] - y[1]);
  return near[0]?.[0] ?? "";
}
function placeWindow() {
  const { workArea: a } = screen.getPrimaryDisplay();
  if (!mini) {
    win.setBounds(dockBounds());
    return;
  }
  const [v, h] = corner.split("-");
  win.setBounds({
    x: h === "left" ? a.x + MARGIN : a.x + a.width - MINI_W - MARGIN,
    y: v === "top" ? a.y + MARGIN : a.y + a.height - MINI_H - MARGIN,
    width: MINI_W,
    height: MINI_H,
  });
}

function setMini(on) {
  mini = on;
  syncWake(); // jugando no escucha
  if (mini) pending?.finish("");
  else {
    if (prefs.whatsappRead === true) wa.poke(); // lo que llegó mientras jugabas
    checkPlan();
  }
  win.webContents.send("mini", mini);
  musicBar.sync(); // en modo mini (jugando) la barra se esconde
  placeWindow();
}
ipcMain.on("toggle-mini", () => setMini(!mini));

// --- Chat + orquestador: usa tu Claude Code, sin API key aparte ---
const CHAT_DIR = path.join(app.getPath("userData"), "chat");
// La API de Claude (opcional, con tu clave de la Consola): motor alterno para el chat y los resúmenes de WhatsApp. La clave vive cifrada en ai-keys.bin (id "anthropic").
const claudeApi = createClaudeApi({ getKey: () => aiLoad().anthropic ?? "" });
const orchestrator = createOrchestrator(CHAT_DIR, { vault: prefs.vault, lang, plan: () => plan, model: () => prefs.chatModel, engine: () => prefs.engine, claudeApi });

// --- Plan del día: se lee al arrancar y cada 30 min; si trae fecha nueva, la isla lo anuncia ---
let plan = null; // el último plan leído (ya validado) o null
const planView = (fresh) => (plan ? { ...plan, say: planSpeech(plan, t), fresh } : null);
async function checkPlan() {
  if (!prefs.planRepo) return;
  plan = await readPlan(prefs);
  if (!win || win.isDestroyed()) return;
  // "Nuevo" = un plan con fecha que aún no te mostró. En modo mini no se anuncia (ni se da por
  // visto): se anuncia al salir de mini.
  const fresh = !!plan && plan.fecha !== prefs.planSeen && !mini;
  if (fresh) { prefs.planSeen = plan.fecha; savePrefs(); }
  win.webContents.send("plan", planView(fresh));
}
// A pedido ("dame el plan de hoy"): lo trae de nuevo por si salió uno más reciente.
ipcMain.handle("plan", async () => {
  if (prefs.planRepo) plan = await readPlan(prefs);
  return planView(false);
});
// --- Recordatorios: el orquestador los crea/cierra desde el chat; aquí se guardan y se avisan ---
const reminders = createReminders(path.join(app.getPath("userData"), "reminders.json"));
const remindersChanged = () => win?.webContents.send("reminders", reminders.pending());
ipcMain.handle("reminders", () => reminders.pending());
ipcMain.on("reminder-done", (_e, id) => { reminders.complete(String(id)); remindersChanged(); });
ipcMain.on("reminder-snooze", (_e, id, min) => { reminders.snooze(String(id), Math.min(Math.max(Number(min) || 10, 1), 1440)); remindersChanged(); });
// Cada 15 s: lo que venció avisa en la isla y con una notificación de Windows (se ve aunque
// Nimbo esté en mini o estés jugando).
function checkReminders() {
  for (const r of reminders.takeDue()) {
    win?.webContents.send("reminder", r);
    alerts.notify("reminders", t("⏰ Recordatorio: {0}", r.text));
    if (Notification.isSupported()) new Notification({ title: t("Nimbo · recordatorio"), body: r.text, silent: mini }).show();
  }
}

// Un solo `ask` a la vez: la isla y Telegram hablan con la MISMA conversación, y dos a la vez la bifurcarían.
let askChain = Promise.resolve();
async function doAsk(msg) {
  const r = await orchestrator.ask(msg, { reminders: reminders.pending() });
  const added = (r.reminders ?? []).map((x) => reminders.add(x)).filter(Boolean);
  for (const id of r.complete ?? []) reminders.complete(String(id));
  if (added.length || r.complete?.length) remindersChanged();
  return { ...r, added };
}
const askNimbo = (msg) => (askChain = askChain.then(() => doAsk(msg), () => doAsk(msg)));
// --- Otras IAs (ai.js): Ollama local, Gemini, OpenAI. Solo conversación; los adjuntos y las herramientas son de Claude. ---
const aiKeysFile = path.join(app.getPath("userData"), "ai-keys.bin");
let aiKeys; // undefined = aún no se leyó del disco
const aiLoad = () => {
  if (aiKeys === undefined) { try { aiKeys = JSON.parse(safeStorage.decryptString(fs.readFileSync(aiKeysFile))); } catch { aiKeys = {}; } }
  return aiKeys;
};
const aiSave = () => {
  try {
    if (Object.keys(aiLoad()).length && safeStorage.isEncryptionAvailable()) fs.writeFileSync(aiKeysFile, safeStorage.encryptString(JSON.stringify(aiKeys)));
    else fs.rmSync(aiKeysFile, { force: true });
  } catch {}
};
const ai = createAi({ getKey: (id) => aiLoad()[id] ?? "", models: () => prefs.aiModels ?? {} });
const aiHistory = new Map(); // id → mensajes de la conversación con esa IA (solo en memoria)
// Ollama según el sistema: Windows (ollama app.exe), macOS (Ollama.app) o Linux (el comando `ollama`).
const ollamaWhere = () => ollamaLocations({ env: process.env });
const ollamaInstalled = () => { const o = ollamaWhere(); return !!o.path && (o.kind === "cli" ? true : fs.existsSync(o.path)); };
function openOllama() {
  const o = ollamaWhere();
  if (!ollamaInstalled()) return;
  if (o.kind === "file") shell.openPath(o.path);
  else if (o.kind === "app") execFile("open", ["-a", "Ollama"], () => {});
  else require("child_process").spawn(o.path, ["serve"], { detached: true, stdio: "ignore" }).unref();
}
let aiPull = null; // la descarga del modelo recomendado en curso: { percent, controller }
async function aiState() {
  const st = await ai.status();
  const providers = [{ id: "claude", label: "Claude" }, ...st.providers];
  return { installed: ollamaInstalled(), recommended: RECOMMENDED, pull: aiPull ? { percent: aiPull.percent } : null, providers, current: providers.some((p) => p.id === prefs.chatProvider) ? prefs.chatProvider : "claude", ollama: st.ollama, keyed: { ...st.keyed, anthropic: !!aiLoad().anthropic }, engine: prefs.engine === "api" ? "api" : "" };
}
const aiSystem = () => `Eres Nimbo, el compañero de escritorio del usuario (una nube pequeña arriba de su pantalla). Responde en el idioma del usuario, claro y breve (máximo 4 frases salvo que pidan más). No tienes acceso a sus archivos, recordatorios, chats ni a internet: si te lo piden, dilo en una frase y sugiere cambiar a Claude en el selector del chat. Hoy es ${new Date().toLocaleDateString(lang() === "es" ? "es-CO" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
async function askOther(provider, text) {
  const history = aiHistory.get(provider.id) ?? [];
  const r = await ai.chat(provider.id, history, text, aiSystem());
  if (r.error) {
    const why = { key: "{0} no aceptó la clave. Pégala de nuevo en Conexiones → Otras IAs.", limit: "{0} dice que llegaste a su límite. Espera un rato o cambia de IA.",
      model: "{0} no tiene el modelo que se necesita. Instálalo o revisa su nombre.", offline: "No pude conectarme con {0}." }[r.error] ?? "{0} no pudo responder.";
    return { text: t(why, provider.label), dispatch: [], added: [] };
  }
  aiHistory.set(provider.id, [...history, { role: "user", content: text }, { role: "assistant", content: r.text }].slice(-24));
  return { text: r.text, dispatch: [], added: [] };
}
// Los adjuntos (imágenes y archivos) y todo lo que usa herramientas son de Claude: con una de estas IAs elegida,
// un mensaje con adjuntos igual va a Claude.
ipcMain.handle("ask", async (_e, msg) => {
  if (!msg?.images?.length && !msg?.files?.length && prefs.chatProvider && prefs.chatProvider !== "claude") {
    const st = await aiState();
    const provider = st.providers.find((p) => p.id === st.current);
    if (provider && provider.id !== "claude") return askOther(provider, String(msg?.text ?? ""));
  }
  return askNimbo(msg);
});
ipcMain.on("ask-cancel", () => orchestrator.cancel());
ipcMain.handle("ai-providers", () => aiState());
ipcMain.on("ai-select", async (_e, id) => {
  if ((await aiState()).providers.some((p) => p.id === String(id))) { prefs.chatProvider = String(id); savePrefs(); }
});
// --- Encargos a otra IA (delegate.js): Claude propone, tú decides en la tarjeta. "Abrir en Gemini" copia el encargo y abre su web
// (sirve con tu cuenta/licencia, sin clave); "Generar aquí" usa tu clave de Gemini y guarda las imágenes en Imágenes\Nimbo. ---
const imagesDir = () => path.join(app.getPath("pictures"), "Nimbo");
ipcMain.on("delegate-open", (_e, d) => {
  const [x] = cleanDelegates([d]);
  if (!x) return;
  clipboard.writeText(x.prompt);
  shell.openExternal("https://gemini.google.com/app");
});
ipcMain.handle("delegate-run", async (_e, d) => {
  const [x] = cleanDelegates([d]);
  if (!x) return { error: "fail" };
  if (x.kind === "text") {
    const r = await ai.chat("gemini", [], x.prompt, "Haz exactamente lo que se pide, en el idioma del encargo, sin preámbulos.");
    return r.error ? { error: r.error } : { kind: "text", text: r.text };
  }
  const r = await ai.image(x.prompt);
  if (r.error) return { error: r.error };
  try {
    fs.mkdirSync(imagesDir(), { recursive: true });
    const file = path.join(imagesDir(), imageFileName(r.mime));
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return { kind: "image", mime: r.mime, data: r.data, file };
  } catch { return { error: "fail" }; }
});
ipcMain.on("delegate-show", (_e, file) => { if (insideDir(file, imagesDir())) shell.showItemInFolder(path.resolve(String(file))); });
// --- Correo (opcional, mail.js): tu Gmail por el conector de tu claude, solo lectura. SOLO cuando lo pides (botón ✉, chat o /correo). ---
const mail = createMail(path.join(app.getPath("userData"), "mail.json"));
async function refreshMail({ quiet = false } = {}) {
  win?.webContents.send("mail-busy", true);
  let r;
  try { r = await mail.refresh(); } finally { win?.webContents.send("mail-busy", false); }
  win?.webContents.send("mail", { on: prefs.mailRead === true, ...mail.cached() });
  // A tu celular solo llegan los importantes nuevos (la primera vez, al activar, no: ya los ves en la isla).
  if (r?.ok && !quiet) for (const e of r.fresh.slice(0, 3)) alerts.notify("mail", t("✉️ Correo de {0}: {1}", e.from, e.subject));
  return r;
}
ipcMain.handle("mail", () => ({ on: prefs.mailRead === true, ...mail.cached() }));
ipcMain.on("mail-refresh", () => { if (prefs.mailRead === true) refreshMail(); });
ipcMain.on("mail-open", (_e, id) => { const url = threadUrl(id); if (url) shell.openExternal(url); });
// --- Telegram (opcional, telegram.js): hablar con Nimbo desde el celular. El token del bot va cifrado por Windows. ---
const telegramTokenFile = path.join(app.getPath("userData"), "telegram.bin");
let telegramToken; // undefined = aún no se leyó del disco
const telegramSaveToken = (value) => {
  telegramToken = "";
  try {
    if (value && safeStorage.isEncryptionAvailable()) { fs.writeFileSync(telegramTokenFile, safeStorage.encryptString(value)); telegramToken = value; }
    else fs.rmSync(telegramTokenFile, { force: true });
  } catch {}
};
async function telegramReply(text) {
  if (/^\/(start|help|ayuda)\b/i.test(text)) return t("Soy Nimbo. Escríbeme como en el chat de la isla. /plan te da el plan de hoy. /pendiente <texto> anota un pendiente (aunque mi PC esté apagado, lo anoto al encender), /pendientes los lista /hecho <n> marca uno y /correo te dice qué correos importan.");
  if (/^\/correo\b/i.test(text)) {
    if (prefs.mailRead !== true) return t("El correo está apagado: actívalo en Conexiones de Nimbo.");
    if (!(Date.now() - Date.parse(mail.cached().at || 0) < 30 * 60_000)) await refreshMail({ quiet: true }); // la lista tiene más de 30 min: se revisa
    const list = mail.cached().emails;
    const important = list.filter((e) => e.important);
    return list.length ? `${t("✉ {0} sin leer ({1} importantes):", list.length, important.length)}\n${[...important, ...list.filter((e) => !e.important)].slice(0, 8).map((e) => `${e.important ? "★" : "•"} ${e.from}: ${e.summary || e.subject}`).join("\n")}` : t("No tienes correos sin leer. 📭");
  }
  const note = parseInbox(text);
  if (note !== null) {
    if (!note) return t("Escribe /pendiente seguido de lo que quieras anotar.");
    reminders.add({ text: note, due: "" });
    remindersChanged();
    return t("Anotado ✔ ({0} pendientes): {1}", reminders.pending().length, note);
  }
  if (/^\/pendientes\b/i.test(text)) {
    const list = reminders.pending();
    return list.length ? `${t("Tus pendientes:")}\n${list.map((r, i) => `${i + 1}. ${r.text}${r.due ? " ⏰" : ""}`).join("\n")}` : t("No tienes pendientes. 🎉");
  }
  const done = /^\/hecho\s+(\d{1,3})\b/i.exec(text);
  if (done) {
    const target = reminders.pending()[Number(done[1]) - 1];
    if (!target) return t("No encuentro el pendiente {0}.", done[1]);
    reminders.complete(target.id);
    remindersChanged();
    return t("Hecho ✔: {0}", target.text);
  }
  if (/^\/plan\b/i.test(text)) {
    if (prefs.planRepo) plan = await readPlan(prefs);
    return plan ? [planSpeech(plan, t), ...plan.proyectos.filter((p) => p.propuesta).slice(0, 8).map((p) => `• ${p.nombre}: ${p.propuesta.titulo}`)].join("\n") : t("No tengo el plan de hoy: no está configurado, no hay conexión o todavía no ha salido.");
  }
  const r = await askNimbo({ text });
  let out = r.text || t("(sin respuesta)");
  if (r.added?.length) out += `\n\n⏰ ${r.added.map((x) => x.text).join(" · ")}`;
  // Los encargos para otros chats NO se envían desde aquí: hay que confirmarlos en la isla.
  if (r.delegate?.length) out += `

${t("Propuse {0} encargo(s) para Gemini; ábrelos en Nimbo para decidir.", r.delegate.length)}`;
  if (r.dispatch?.length) out += `\n\n${t("Tengo {0} encargo(s) para otros chats; no se envían desde Telegram, confírmalos en Nimbo:", r.dispatch.length)}\n${r.dispatch.map((d) => `• ${d.title || d.project}`).join("\n")}`;
  return out;
}
const telegram = createTelegram({
  token: () => {
    if (telegramToken === undefined) { try { telegramToken = safeStorage.decryptString(fs.readFileSync(telegramTokenFile)); } catch { telegramToken = ""; } }
    return telegramToken;
  },
  chatId: () => Number(prefs.telegramChat) || 0,
  setChatId: (id) => { prefs.telegramChat = id; savePrefs(); },
  onMessage: telegramReply,
  // Las notas /pendiente que le mandaste con el PC apagado se anotan al encender (lo demás se descarta).
  onBacklog: async (notes) => {
    const added = notes.map((x) => parseInbox(x)).filter(Boolean).map((x) => reminders.add({ text: x, due: "" })).filter(Boolean);
    remindersChanged();
    return added.length ? `${t("Estaba apagado y anoté {0} pendiente(s) que me mandaste:", added.length)}\n${added.map((r) => `• ${r.text}`).join("\n")}` : "";
  },
  texts: () => ({ welcome: t("¡Listo! Ya estás vinculado con Nimbo. Escríbeme lo que quieras."), failed: t("No pude responder. Revisa Nimbo en tu PC."), backlog: t("Estaba apagado: ignoré tus mensajes anteriores. Reenvía lo que sea importante.") }),
  onChange: () => win?.webContents.send("telegram", telegram.status()),
});
app.on("before-quit", () => telegram.stop());
const alertCfg = () => ({ claude: true, reminders: true, mail: true, whatsapp: false, onlyAway: true, ...(prefs.telegramAlerts ?? {}) });
const alerts = createAlerts({ send: (text) => telegram.notify(text), enabled: (k) => alertCfg()[k] === true, idle: () => powerMonitor.getSystemIdleTime(), t });
ipcMain.handle("dispatch", (_e, id, prompt) => orchestrator.dispatch(String(id), String(prompt)));
// --- Celular (remote-api.js): Nimbo en el iPhone, por el puente del asistente. Solo 127.0.0.1 y con su token. ---
const remote = createRemoteApi({
  tokenFile: path.join(app.getPath("userData"), "remote-token"),
  ask: askNimbo,
  dispatch: (id, prompt) => orchestrator.dispatch(String(id), String(prompt)),
  reminders,
  remindersChanged,
  permission: () => pending && { id: pending.remoteId, payload: pending.payload },
  decide: (id, decision) => { if (pending?.remoteId === id) pending.finish(decision); },
  idle: () => powerMonitor.getSystemIdleTime(),
});

// --- GitHub: notificaciones con la sesión que ya tiene `gh` (Nimbo no guarda claves) ---
function pollGithub() {
  execFile("gh", ["api", "notifications", "--jq", "[.[] | {title: .subject.title, repo: .repository.full_name}]"],
    { windowsHide: true, timeout: 20_000 }, (err, out) => {
      if (err || !win || win.isDestroyed()) return; // sin gh o sin sesión: no se muestra nada
      try { win.webContents.send("github", JSON.parse(out)); } catch {}
    });
}
ipcMain.on("open-github", () => shell.openExternal("https://github.com/notifications"));
// Abre enlaces de tarjetas o notificaciones: solo https de trello.com y github.com.
ipcMain.on("open-url", (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === "https:" && ["trello.com", "github.com"].includes(u.hostname)) shell.openExternal(u.href);
  } catch {}
});

// --- WhatsApp de escritorio, solo lectura (ver whatsapp.js) ---
// Chats sin leer (título de la ventana) + quién escribió y qué es urgente (notificaciones de
// Windows clasificadas por tu claude, sin herramientas). No toca la sesión ni envía nada.
let whatsapp = null; // { running, access, count, chats, headline }
const wa = createWhatsapp({
  rulesFile: path.join(app.getPath("userData"), "whatsapp-reglas.txt"),
  seenFile: path.join(app.getPath("userData"), "whatsapp-vistos.json"), // solo números de notificación, sin texto
  lang,
  model: () => prefs.waModel, // "" automático · "claude" · o un modelo de Ollama
  api: { active: () => prefs.engine === "api" && claudeApi.has(), ask: ({ system, user, schema }) => claudeApi.structured({ model: HAIKU, system, schema, messages: [{ role: "user", content: user }], maxTokens: 3000 }) },
  onError: (code) => win?.webContents.send("ai-error", t(code === "key" ? "La clave de la API de Claude no sirve. Pégala de nuevo en Conexiones → Otras IAs."
    : code === "billing" ? "A la API de Claude se le acabaron los créditos. Cambia a «Suscripción» en el menú → Motor de Nimbo."
    : code === "limit" ? "La API de Claude dice que vas muy rápido o está saturada. Espera un momento y vuelve a intentar."
    : code === "offline" ? "No pude conectarme con la API de Claude." : "La API de Claude no pudo resumir los mensajes de WhatsApp.")),
  paused: () => mini,
  // Los resúmenes gastan: solo se hacen cuando abres WhatsApp en Nimbo (prefs.whatsappAuto = true vuelve a resumir cada mensaje al llegar).
  auto: () => prefs.whatsappAuto === true,
  onChange(state, alert) {
    whatsapp = state;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("whatsapp", state, alert);
    // Lo urgente también sale como notificación de Windows: se ve en mini o jugando.
    if (alert) alerts.notify("whatsapp", t("WhatsApp urgente · {0}", alert.name)); // apagado por defecto; solo el nombre del chat
    if (alert && Notification.isSupported()) new Notification({ title: t("WhatsApp urgente · {0}", alert.name), body: alert.summary }).show();
  },
});
let waChild = null;
function watchWhatsapp() {
  waChild?.kill();
  waChild = wa.watch(prefs.whatsappRead === true);
}
app.on("before-quit", () => waChild?.kill());
// Tras una suspensión, el lector de notificaciones de Windows puede quedar sin respuesta: se vuelve a lanzar.
app.whenReady().then(() => powerMonitor.on("resume", () => setTimeout(watchWhatsapp, 3000)));
ipcMain.on("whatsapp-refresh", () => wa.refresh());
ipcMain.on("whatsapp-summarize", () => wa.summarize());
ipcMain.on("whatsapp-dismiss", () => wa.dismiss());
// Copiar la respuesta sugerida: Nimbo no escribe en WhatsApp, tú la pegas si te sirve.
ipcMain.on("copy", (_e, text) => clipboard.writeText(String(text ?? "").slice(0, 500)));

// --- Trello: a través de tu claude (conector de claude.ai), solo lectura; tableros 1 vez al día, tarjetas al tocar un tablero ---
const trello = createTrello(path.join(app.getPath("userData"), "trello.json"));
ipcMain.handle("trello", () => trello.cached());
// Lo que corre ahora: la lista de tableros (sola) y las tarjetas de UN tablero (al tocarlo). La página recibe
// qué consultas están en curso (`trello-busy`: lista de claves) y los datos nuevos al terminar cada una.
const trelloActive = new Set();
async function trelloJob(key, job) {
  if (trelloActive.has(key)) return;
  trelloActive.add(key);
  win?.webContents.send("trello-busy", [...trelloActive]);
  try { await job(); } finally {
    trelloActive.delete(key);
    win?.webContents.send("trello-busy", [...trelloActive]);
    win?.webContents.send("trello", trello.cached());
  }
}
const refreshTrello = () => trelloJob("boards", () => trello.refreshBoards());
ipcMain.on("trello-refresh", () => refreshTrello());
// La página solo puede pedir tableros de la lista que ya se conoce (nunca una dirección cualquiera).
ipcMain.on("trello-board", (_e, url) => { if (trello.hasBoard(String(url))) trelloJob(String(url), () => trello.refreshBoard(String(url))); });
// La lista de tableros corre sola una vez al día: si lo último que trajo tiene más de 20 h. "Actualizar"
// (botón o menú) la corre cuando quieras.
const TRELLO_MAX_AGE = 20 * 3600_000;
// Si falla (al encender Windows puede no haber red todavía: el 2026-10-13 la consulta del arranque no dejó nada),
// reintenta cada 15 min hasta 3 veces seguidas; después espera 6 h. Cada intento fallido casi no cuesta.
let trelloTried = 0;
let trelloTries = 0;
function refreshTrelloIfStale() {
  const at = Date.parse(trello.cached()?.at ?? "");
  if (Date.now() - (Number.isFinite(at) ? at : 0) < TRELLO_MAX_AGE) { trelloTries = 0; return; }
  const since = Date.now() - trelloTried;
  if (since < 10 * 60_000 || (trelloTries >= 3 && since < 6 * 3600_000)) return;
  if (since >= 6 * 3600_000) trelloTries = 0;
  trelloTried = Date.now();
  trelloTries++;
  refreshTrello();
}

// --- Spotify: busca tu claude (conector de claude.ai); la canción elegida se abre en tu app ---
// Con Premium y tu propia app de Spotify (opcional, spotify-api.js): la búsqueda es instantánea y la
// canción elegida suena. Lo único guardado es el token de renovación, cifrado por Windows (DPAPI,
// `safeStorage`): solo tu usuario de Windows en este equipo puede leerlo. Sin cifrado no se guarda.
const spotifyTokenFile = path.join(app.getPath("userData"), "spotify.bin");
let spotifyToken; // undefined = todavía no se leyó del disco
const spotifyApi = createSpotifyApi({
  clientId: () => prefs.spotifyClientId,
  redirect: `http://127.0.0.1:${PORT}/spotify`,
  load() {
    if (spotifyToken === undefined) {
      try { spotifyToken = safeStorage.decryptString(fs.readFileSync(spotifyTokenFile)); } catch { spotifyToken = ""; }
    }
    return spotifyToken;
  },
  save(value) {
    spotifyToken = "";
    try {
      if (value && safeStorage.isEncryptionAvailable()) { fs.writeFileSync(spotifyTokenFile, safeStorage.encryptString(value)); spotifyToken = value; }
      else fs.rmSync(spotifyTokenFile, { force: true });
    } catch {}
  },
  // Se abre en el navegador por defecto, que puede no ser donde tienes tu sesión de Spotify (pasó: Edge por
  // defecto, sesión en otro): el enlace también queda copiado para pegarlo en el navegador que uses.
  open: (url) => { clipboard.writeText(url); shell.openExternal(url); },
});
// "plays" le dice a la página que la canción elegida va a sonar (y no solo abrirse).
// Entrenador de entrevistas (interview.js): un turno por llamada, sin guardar nada.
ipcMain.handle("interview", (_e, req) => askInterview(req, { lang: lang(), model: prefs.interviewModel }));
ipcMain.handle("spotify-search", async (_e, query) => (spotifyApi.connected() ? { ...(await spotifyApi.search(query)), plays: true } : searchSpotify(query)));
// Con Premium la canción suena; sin eso (o si Spotify está cerrado) se abre su página en la app.
ipcMain.handle("spotify-play", async (_e, uri) => {
  if (!TRACK_URI.test(String(uri))) return { error: "fail" };
  const r = spotifyApi.connected() ? await spotifyApi.play(String(uri)) : { opened: true };
  if (!r.ok) shell.openExternal(String(uri));
  return r;
});
// Lo que suena y sus botones: controles multimedia de Windows (media.js), sin cuenta ni claves.
let media = null;
const musicBar = createMusicBar({
  page: () => `nimbo://app/src/renderer/player.html?lang=${lang()}`,
  preload: path.join(__dirname, "player-preload.js"),
  getPos: () => prefs.musicBarPos,
  setPos: (pos) => { prefs.musicBarPos = pos; savePrefs(); },
  enabled: () => prefs.musicBar !== false,
  mini: () => mini,
});
let mediaTime = null; // { pos, dur, at }: en qué segundo va (para la barra de avance)
const player = watchMedia((m) => { media = m; if (win && !win.isDestroyed()) win.webContents.send("media", m); musicBar.update(m); },
  (tm) => { mediaTime = tm; if (win && !win.isDestroyed()) win.webContents.send("media-time", tm); });
app.on("before-quit", () => { player.stop(); musicBar.destroy(); });
ipcMain.handle("media", () => media);
ipcMain.handle("media-time", () => mediaTime);
// La letra de lo que suena AHORA (main decide qué canción: la página no puede pedir otra cosa). Caché por canción mientras Nimbo está abierto.
const lyricsCache = new Map();
ipcMain.handle("lyrics", async () => {
  if (!media) return null;
  const key = `${media.title}|${media.artist}`;
  if (!lyricsCache.has(key)) {
    const got = await fetchLyrics({ ...media, dur: mediaTime?.dur }).catch(() => ({ error: true }));
    if (got?.error) return got; // un error no se guarda: se puede reintentar
    if (lyricsCache.size > 50) lyricsCache.clear();
    lyricsCache.set(key, got);
  }
  return lyricsCache.get(key);
});
ipcMain.on("media-do", (_e, order) => player.send(String(order)));

// La ventana normalmente no roba el foco; solo lo toma mientras el chat está abierto.
// Comandos "/" del chat que tocan el proceso principal: conversación nueva y modelo del chat (los demás los resuelve la página).
ipcMain.handle("chat-cmd", (_e, action, value) => {
  if (action === "new") { orchestrator.reset(); aiHistory.clear(); return { ok: true }; }
  if (action === "model") {
    const model = ["haiku", "sonnet", "opus"].includes(value) ? value : null;
    if (!model) return { model: prefs.chatModel };
    prefs.chatModel = model;
    savePrefs();
    return { model, changed: true };
  }
  return null;
});
ipcMain.on("chat-open", (_e, open) => {
  win.setFocusable(open);
  if (open) win.focus();
});

// --- "Oye Nimbo" (wake.js): el reconocedor de Windows escucha SOLO la frase de activación; al oírla, la isla abre el chat y dicta. ---
// Apagado hasta que lo actives (prefs.wakeWord). Mientras dictas y en modo mini no escucha (se apaga el proceso, no se ignora).
let wakeTimer = 0;
// Frases con las que Nimbo avisa que te está escuchando (se sortea una cada vez para que no suene siempre igual). Base chica y editable:
// %APPDATA%\nimbo\frases.json { "escuchando": [...] }. El audio se genera una vez con la voz de Windows (Helena en español) y queda en voz\.
const PHRASES_FILE = path.join(app.getPath("userData"), "frases.json");
const VOICE_DIR = path.join(app.getPath("userData"), "voz");
const DEFAULT_PHRASES = { es: { escuchando: ["Aquí estoy", "Te escucho", "Dime", "Dime, te escucho", "¿Sí? Dime", "Aquí estoy, dime", "Te estoy escuchando"] },
  en: { escuchando: ["I'm here", "I'm listening", "Go ahead", "Yes? Go ahead", "Listening"] } };
function pickPhrase(kind) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(PHRASES_FILE, "utf8")); } catch {}
  if (!fs.existsSync(PHRASES_FILE)) { try { fs.writeFileSync(PHRASES_FILE, JSON.stringify(DEFAULT_PHRASES, null, 2)); db = DEFAULT_PHRASES; } catch {} }
  const list = (db[lang()]?.[kind] ?? DEFAULT_PHRASES[lang()][kind]).filter((x) => typeof x === "string" && x.trim() && x.length <= 80);
  return list[Math.floor(Math.random() * list.length)] ?? "";
}
const SAY_PS = String.raw`
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$want = $env:NIMBO_VOICE
try { $s.SelectVoice($want) } catch { $first = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $env:NIMBO_LANG } | Select-Object -First 1; if ($first) { $s.SelectVoice($first.VoiceInfo.Name) } }
$s.SetOutputToWaveFile($env:NIMBO_OUT)
$s.Speak($env:NIMBO_TEXT)
$s.Dispose()
`;
// Voz amable (opcional): Piper, voz neuronal sin internet. Federico descargó piper.exe y una voz en español a D:\piper (2026-10-26); se usa
// SOLO si lo enciende en el menú (prefs.voiceEngine = "piper"). Texto por la entrada estándar, sin shell; solo frases de frases.json (≤ 80 letras).
const piperDir = () => String(prefs.piperDir || "D:\\piper");
const piperExe = () => path.join(piperDir(), "piper", "piper.exe");
const piperModel = () => { try { return fs.readdirSync(piperDir()).filter((f) => /\.onnx$/i.test(f)).map((f) => path.join(piperDir(), f))[0] ?? ""; } catch { return ""; } };
const havePiper = () => process.platform === "win32" && fs.existsSync(piperExe()) && !!piperModel();
const usePiper = () => prefs.voiceEngine === "piper" && havePiper();
function renderPiper(text, out) {
  return new Promise((res, rej) => {
    const c = require("child_process").spawn(piperExe(), ["--model", piperModel(), "--output_file", out], { windowsHide: true, cwd: path.dirname(piperExe()) });
    const timer = setTimeout(() => { c.kill(); rej(new Error("timeout")); }, 30_000);
    c.on("error", (e) => { clearTimeout(timer); rej(e); });
    c.on("exit", (code) => { clearTimeout(timer); code === 0 ? res() : rej(new Error("piper " + code)); });
    c.stdin.on("error", () => {});
    c.stdin.end(text + "\n");
  });
}
let lastPhrase = "";
// Archivo de audio de una frase (se genera la primera vez y queda guardado; la próxima es instantánea).
async function phraseFile(text) {
  const engine = usePiper() ? "piper:" + path.basename(piperModel()) : "sapi";
  const file = path.join(VOICE_DIR, require("crypto").createHash("sha1").update(engine + "|" + lang() + "|" + text).digest("hex").slice(0, 16) + ".wav");
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  if (engine !== "sapi") { await renderPiper(text, file); return file; }
  const ps = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await new Promise((res, rej) => execFile(ps, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SAY_PS, "utf16le").toString("base64")],
    { windowsHide: true, timeout: 20_000, env: { ...process.env, NIMBO_TEXT: text, NIMBO_OUT: file, NIMBO_LANG: lang(), NIMBO_VOICE: lang() === "en" ? "Microsoft Zira Desktop" : "Microsoft Helena Desktop" } },
    (err) => (err ? rej(err) : res())));
  return file;
}
ipcMain.handle("say-phrase", async (_e, kind) => {
  if (prefs.cueVoice === false || process.platform !== "win32") return null;
  let text = pickPhrase("escuchando");
  if (text === lastPhrase) text = pickPhrase("escuchando") || text; // que no se repita seguido
  lastPhrase = text;
  if (!text) return null;
  try { return new Uint8Array(await fs.promises.readFile(await phraseFile(text))); } catch { return null; }
});
// Al arrancar (y al cambiar de voz) se generan TODAS las frases: así, cuando lo llamas, el "te escucho" sale al instante sin esperar a la voz.
let warming = false;
async function warmPhrases() {
  if (warming || prefs.cueVoice === false || process.platform !== "win32") return;
  warming = true;
  try {
    pickPhrase("escuchando"); // crea frases.json si no existe
    let db = {};
    try { db = JSON.parse(fs.readFileSync(PHRASES_FILE, "utf8")); } catch {}
    for (const text of (db[lang()]?.escuchando ?? DEFAULT_PHRASES[lang()].escuchando).filter((x) => typeof x === "string" && x.trim() && x.length <= 80)) {
      try { await phraseFile(text); } catch {}
    }
  } finally { warming = false; }
}
app.whenReady().then(() => setTimeout(warmPhrases, 4000));

// Historial de «Oye Nimbo» (menú → "Historial de «Oye Nimbo»"): cada posible llamada, qué oyó cada paso y qué se mandó después, para
// entender por qué se activa solo. Texto plano, SOLO en este PC, las últimas 400 líneas. Lleva pedacitos de lo que se oyó cerca del micrófono.
const WAKE_LOG = path.join(app.getPath("userData"), "oye-nimbo-historial.txt");
const pct = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
let wakeLogQueue = Promise.resolve();
function wakeLog(line) {
  const when = new Date().toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  // Privacidad: por defecto el historial NO guarda lo que se oyó ni lo que dijiste, solo qué pasó y con qué seguridad (prefs.wakeDebug = true lo activa).
  let clean = String(line).replace(/\s+/g, " ").slice(0, 400);
  if (prefs.wakeDebug !== true) clean = clean.replace(/«[^»]*»/g, "«…»");
  // En fila: dos anotaciones seguidas leerían el mismo archivo y una se perdería.
  wakeLogQueue = wakeLogQueue.then(async () => {
    const old = await fs.promises.readFile(WAKE_LOG, "utf8").catch(() => "");
    await fs.promises.writeFile(WAKE_LOG, [...old.split(/\r?\n/).filter(Boolean).slice(-399), `${when}  ${clean}`].join("\r\n") + "\r\n");
  }).catch(() => {});
}
// Los últimos 5 audios de llamadas aceptadas por Windows (oye-nimbo-clips, solo en este PC): para entender qué oyó Whisper si falla.
const CLIPS_DIR = path.join(app.getPath("userData"), "oye-nimbo-clips");
// Privacidad: los audios NO se guardan salvo con prefs.wakeDebug = true; al arrancar se borran los que hubiera.
fs.promises.rm(CLIPS_DIR, { recursive: true, force: true }).catch(() => {});
async function keepClip(bytes) {
  if (prefs.wakeDebug !== true) return;
  try {
    await fs.promises.mkdir(CLIPS_DIR, { recursive: true });
    const name = new Date().toISOString().replace(/[:.]/g, "-") + ".wav";
    await fs.promises.writeFile(path.join(CLIPS_DIR, name), bytes);
    const all = (await fs.promises.readdir(CLIPS_DIR)).filter((f) => f.endsWith(".wav")).sort();
    for (const old of all.slice(0, -5)) await fs.promises.rm(path.join(CLIPS_DIR, old), { force: true });
    wakeLog(`   audio guardado: oye-nimbo-clips\\${name}`);
  } catch {}
}
const WHY = { "otra-frase": "el dictado de Windows oyó otra frase", "poca-confianza": "poca seguridad" };
const wake = createWake({
  lang,
  // 0,4 y no 0,6: con la voz de Federico la revisión da 0,43–0,64 cuando de verdad lo llama (historial del 2026-10-25: casi todas sus
  // llamadas se perdían por "poca seguridad"). Lo que separa una llamada de otra frase es que en la revisión GANE la frase sobre el
  // dictado; la última palabra la tiene Whisper (voice.js checkWake).
  min: () => (Number(prefs.wakeMin) > 0 && Number(prefs.wakeMin) < 1 ? Number(prefs.wakeMin) : 0.4),
  onCand: (c) => {
    // Algo sonó parecido: que Whisper se vaya cargando, por si es una llamada (así no hay que esperarlo).
    if (win && !win.isDestroyed()) win.webContents.send("wake-warm");
    // Solo se anotan las posibles llamadas (en la revisión ganó la frase); lo demás era gente hablando y llenaba el historial.
    if (c.why === "otra-frase") return;
    wakeLog(c.ok ? `POSIBLE LLAMADA: Windows oyó «${c.step1}» (${pct(c.conf1)}) y en la revisión «${c.step2}» (${pct(c.conf2)})`
      : `descartado (${WHY[c.why] ?? c.why}): «${c.step1}» (${pct(c.conf1)}) · revisión: «${c.step2}» (${pct(c.conf2)})`);
  },
  onWake: async (ev) => {
    if (mini || !win || win.isDestroyed()) return;
    wake.set(false); // mientras te escucha el dictado, la palabra de activación descansa
    // El pedacito de audio de la llamada: la página lo revisa con Whisper antes de despertarse (Windows solo se confundía con videos).
    let clip = null;
    if (ev.clip) { clip = await fs.promises.readFile(ev.clip).catch(() => null); fs.promises.rm(ev.clip, { force: true }).catch(() => {}); }
    if (clip) keepClip(clip);
    if (clip && clip.length > 2_000_000) clip = null;
    win.webContents.send("wake", clip ? new Uint8Array(clip) : null, { conf: Number(ev.conf) || 0 });
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(syncWake, 60_000); // por si la página nunca avisa que terminó
  },
  onError: (e) => { if (win && !win.isDestroyed()) win.webContents.send("ai-error", e === "no-recognizer" ? t("«Oye Nimbo» necesita el reconocedor de voz de Windows en tu idioma (Configuración → Hora e idioma → Voz).") : t("«Oye Nimbo» no pudo escuchar: {0}", e)); },
});
function syncWake() {
  clearTimeout(wakeTimer);
  const on = prefs.wakeWord === true && !mini;
  wake.set(on);
  if (win && !win.isDestroyed()) win.webContents.send("wake-on", on); // la isla muestra un puntito mientras escucha la frase
}
// Mientras dictas, el dictado de Windows va mostrando lo que entiende (vista previa; el texto final es de Whisper).
const live = createLive({ lang, onPartial: (text) => { if (win && !win.isDestroyed()) win.webContents.send("dictation-partial", text); } });
ipcMain.on("live-dictation", (_e, on) => (on === true ? live.start() : live.stop()));
app.on("before-quit", () => live.stop());
ipcMain.on("wake-done", syncWake);
// Lo que pasó después de una llamada (lo manda la página): qué oyó Whisper en ella y qué dijiste.
ipcMain.on("wake-log", (_e, kind, text, note) => {
  const q = String(text ?? "").slice(0, 200);
  const n = String(note ?? "");
  if (kind === "check") wakeLog(`   Whisper oyó en la llamada: «${q}» → ${n.startsWith("ok") ? `me desperté (${n === "ok:nimbo" ? "oyó nimbo" : "saludo + Windows seguro"})` : `falsa alarma, no me desperté (${n.slice(3, 30)})`}`);
  if (kind === "said") wakeLog(`   después dijiste: «${q}» → ${String(note ?? "").slice(0, 80)}`);
});
app.on("before-quit", () => wake.stop());
app.whenReady().then(() => { syncWake(); powerMonitor.on("resume", () => { if (prefs.wakeWord === true) setTimeout(() => wake.restart(), 3000); }); });

// --- Nimbo como barra de tareas (windows.js, solo Windows): tus programas abiertos en la isla y la barra de Windows en auto-ocultar. ---
// prefs.taskbarMode lo prende (menú). Al prenderlo se guarda cómo estaba la barra (prefs.taskbarPrevAutoHide) para dejarla igual al apagarlo.
const iconCache = new Map(); // ruta del programa → data: URL de su ícono (32 px)
async function iconOf(file) {
  if (!file) return "";
  if (!iconCache.has(file)) iconCache.set(file, (async () => (await storeLogo(file)) || app.getFileIcon(file, { size: "normal" }).then((i) => (i.isEmpty() ? "" : i.toDataURL())).catch(() => ""))());
  return iconCache.get(file);
}
// Apps de la Tienda (C:\Program Files\WindowsApps\<paquete>\…): el .exe suele traer un ícono genérico; su logo de verdad está en el
// AppxManifest.xml del paquete (Square44x44Logo), en varios tamaños: se usa el más cercano a 48 px.
async function storeLogo(file) {
  const m = /^(.*\\WindowsApps\\[^\\]+)\\/i.exec(file);
  if (!m) return "";
  try {
    const manifest = await fs.promises.readFile(path.join(m[1], "AppxManifest.xml"), "utf8");
    const rel = /Square44x44Logo="([^"]+)"/.exec(manifest)?.[1] ?? /<Logo>([^<]+)<\/Logo>/.exec(manifest)?.[1];
    if (!rel) return "";
    const dir = path.join(m[1], path.dirname(rel));
    const stem = path.basename(rel, path.extname(rel)).toLowerCase();
    const files = (await fs.promises.readdir(dir)).filter((n) => n.toLowerCase().startsWith(stem) && /\.png$/i.test(n) && !/contrast|unplated/i.test(n));
    const size = (n) => { const tgt = /targetsize-(\d+)/i.exec(n); const sc = /scale-(\d+)/i.exec(n); return tgt ? Number(tgt[1]) : sc ? (44 * Number(sc[1])) / 100 : 44; };
    const best = files.sort((a, b) => Math.abs(size(a) - 48) - Math.abs(size(b) - 48))[0];
    if (!best) return "";
    const img = nativeImage.createFromPath(path.join(dir, best));
    return img.isEmpty() ? "" : img.resize({ width: 32, height: 32, quality: "best" }).toDataURL();
  } catch { return ""; }
}
let lastTasks = null; // la última lista: se reenvía cuando la página carga (el ayudante solo avisa cuando algo cambia)
let taskbarArming = false; // prendiendo: falta leer cómo estaba la barra antes de ocultarla
// Programas anclados (prefs.taskbarPins): salen siempre, abiertos o no; clic derecho en uno lo ancla o lo quita. La primera vez se
// copian los accesos directos anclados en la barra de Windows (las apps de la Tienda no dejan acceso directo: se anclan desde Nimbo).
const PINNED_DIR = path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
function taskbarPins() {
  if (!Array.isArray(prefs.taskbarPins)) {
    let lnks = [];
    try { lnks = fs.readdirSync(PINNED_DIR).filter((f) => /\.lnk$/i.test(f)); } catch {}
    prefs.taskbarPins = lnks.map((f) => {
      const lnk = path.join(PINNED_DIR, f);
      let target = "";
      try { target = shell.readShortcutLink(lnk).target; } catch {}
      return /\.exe$/i.test(target) ? { key: target.toLowerCase(), name: path.basename(f, ".lnk"), path: target, lnk } : null;
    }).filter(Boolean);
    savePrefs();
  }
  return prefs.taskbarPins;
}
// Las apps de la Tienda ancladas en la barra de Windows (Xbox, Claude, Apple Music…) no dejan acceso directo: Windows las guarda en el
// registro (Taskband\FavoritesResolve) con su identificador (AUMID). Se importan una vez (prefs.taskbarPinsV): nombre con Get-StartApps y
// carpeta con Get-AppxPackage (de ahí sale su ícono). Solo lectura; lo que ya anclaste desde Nimbo no se toca.
const IMPORT_PINS = String.raw`
$b = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband').FavoritesResolve
if (-not $b) { '[]'; exit }
$txt = @(); foreach ($o in 0,1) { $seg = New-Object byte[] ($b.Length - $o); [Array]::Copy($b, $o, $seg, 0, $seg.Length); $txt += [System.Text.Encoding]::Unicode.GetString($seg) }
$ids = $txt | ForEach-Object { [regex]::Matches($_, '[A-Za-z0-9.\-_]{3,}![A-Za-z0-9.\-_]{2,}') | ForEach-Object { $_.Value } } | Select-Object -Unique
$apps = Get-StartApps; $pk = Get-AppxPackage
$out = foreach ($id in $ids) {
  $fam = $id.Split('!')[0]
  $loc = ($pk | Where-Object { $_.PackageFamilyName -eq $fam } | Select-Object -First 1).InstallLocation
  [pscustomobject]@{ aumid = $id; name = ($apps | Where-Object { $_.AppID -eq $id } | Select-Object -First 1).Name; dir = $loc }
}
@($out) | ConvertTo-Json -Compress
`;
function importWindowsPins() {
  if (process.platform !== "win32" || prefs.taskbarPinsV === 1) return;
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", IMPORT_PINS], { windowsHide: true, timeout: 60_000, maxBuffer: 1 << 20 }, (err, out) => {
    if (err) return;
    let list = [];
    try { list = [].concat(JSON.parse(String(out).trim() || "[]")); } catch { return; }
    const pins = taskbarPins();
    for (const x of list) {
      if (!AUMID.test(String(x?.aumid ?? "")) || pins.some((q) => q.aumid === x.aumid)) continue;
      pins.push({ key: `aumid:${x.aumid.toLowerCase()}`, name: String(x.name || x.aumid.split("!")[0].split("_")[0]).slice(0, 60), aumid: x.aumid,
        path: x.dir && /WindowsApps/i.test(x.dir) ? path.join(String(x.dir), "AppxManifest.xml") : "" }); // el "archivo" solo sirve para sacar el ícono
    }
    prefs.taskbarPins = pins;
    prefs.taskbarPinsV = 1;
    savePrefs();
    sendTasks();
  });
}
// Las ventanas de Nimbo que no son "un programa" (la isla y la barra de música) no van en la lista; la aldea sí, como "Nimbo".
const hwndOf = (w) => { try { return w.getNativeWindowHandle().readBigUInt64LE(0).toString(); } catch { return ""; } };
const NIMBO_ICON = () => nativeImage.createFromPath(path.join(ROOT, "assets", "icon.png")).resize({ width: 32, height: 32 }).toDataURL();
let lastApps = [];
const usedAt = new Map(); // programa → cuándo estuvo al frente por última vez (flotando, Nimbo muestra los 4 últimos que usaste)
async function sendTasks() {
  if (prefs.taskbarMode !== true) { lastTasks = []; if (win && !win.isDestroyed()) win.webContents.send("tasks", []); return; }
  const own = process.execPath.toLowerCase();
  const skip = new Set(BrowserWindow.getAllWindows().filter((w) => w !== village.window()).map(hwndOf));
  const apps = lastApps.map((a) => ({ ...a, windows: a.windows.filter((w) => !skip.has(w.h)) })).filter((a) => a.windows.length);
  for (const a of apps) if (a.fg) usedAt.set(a.key, Date.now());
  const pins = taskbarPins();
  // Un anclado se reconoce abierto por su ruta o, si es de la Tienda, por su identificador (AUMID).
  const match = (p, a) => a.key === p.key || (p.aumid && a.aumid === p.aumid);
  const list = [...pins.map((p) => { const r = apps.find((a) => match(p, a)); return { ...(r ?? { windows: [], fg: false, min: false }), key: p.key, name: r?.name || p.name, path: p.path || r?.path, pinned: true }; }),
    ...apps.filter((a) => !pins.some((p) => match(p, a)))];
  const out = await Promise.all(list.map(async (a) => ({ key: a.key, name: a.key === own ? "Nimbo" : a.name, icon: a.key === own ? NIMBO_ICON() : await iconOf(a.path),
    fg: a.fg, min: a.min, pinned: !!a.pinned, used: usedAt.get(a.key) ?? 0, windows: a.windows.map((w) => ({ h: w.h, title: w.title, fg: w.fg, min: w.min })) })));
  lastTasks = out;
  if (win && !win.isDestroyed()) win.webContents.send("tasks", out);
}
function launchPin(p) {
  if (p.lnk && fs.existsSync(p.lnk)) return shell.openPath(p.lnk);
  if (p.aumid && AUMID.test(p.aumid)) return require("child_process").spawn("explorer.exe", [`shell:AppsFolder\\${p.aumid}`], { detached: true, stdio: "ignore" }).unref();
  if (/\.exe$/i.test(p.path ?? "") && !/\\WindowsApps\\/i.test(p.path) && fs.existsSync(p.path)) return shell.openPath(p.path);
}
ipcMain.on("task-launch", (_e, key) => { const p = taskbarPins().find((x) => x.key === String(key)); if (p) launchPin(p); });
ipcMain.on("task-menu", (_e, key) => {
  const pins = taskbarPins();
  const pin = pins.find((x) => x.key === String(key));
  const app_ = lastApps.find((a) => a.key === String(key));
  if (!pin && !app_) return;
  const items = [pin
    ? { label: t("Quitar de la barra de Nimbo"), click: () => { prefs.taskbarPins = pins.filter((x) => x !== pin); savePrefs(); sendTasks(); } }
    : { label: t("Anclar a la barra de Nimbo"), click: () => { prefs.taskbarPins = [...pins, { key: app_.key, name: app_.name, path: app_.path, aumid: app_.aumid || "" }]; savePrefs(); sendTasks(); } }];
  if (app_?.windows.length) items.push({ type: "separator" }, { label: app_.windows.length > 1 ? t("Cerrar las {0} ventanas", app_.windows.length) : t("Cerrar ventana"), click: () => app_.windows.forEach((w) => windows.act("close", w.h)) });
  Menu.buildFromTemplate(items).popup({ window: win });
});
// Registro de la barra de tareas (%APPDATA%\nimbo\barra.log, solo texto técnico, últimas ~200 líneas): si al encender el PC falla algo, ahí queda por qué.
const BARRA_LOG = path.join(app.getPath("userData"), "barra.log");
function barraLog(line) {
  try {
    let old = [];
    try { old = fs.readFileSync(BARRA_LOG, "utf8").split(/\r?\n/).filter(Boolean).slice(-199); } catch {}
    fs.writeFileSync(BARRA_LOG, [...old, `${new Date().toISOString()} ${String(line).slice(0, 300)}`].join("\r\n") + "\r\n");
  } catch {}
}
const windows = createWindows({
  binDir: path.join(app.getPath("userData"), "bin"),
  log: barraLog,
  onLeftUp: () => finishDrag(true), // soltaron el botón: si la página no se enteró, se suelta igual
  hide: true, // el auto-ocultar solo no basta: con un botón parpadeando la barra de Windows se queda a la vista
  onApps: (apps) => {
    // Un programa anclado guarda su identificador de la Tienda la primera vez que se ve abierto (para poder abrirlo cerrado).
    for (const p of taskbarPins()) { const a = apps.find((x) => x.key === p.key); if (a?.aumid && !p.aumid) { p.aumid = a.aumid; savePrefs(); } }
    lastApps = apps;
    sendTasks();
  },
  onAutoHide: (v) => {
    if (!taskbarArming) return;
    taskbarArming = false;
    prefs.taskbarPrevAutoHide = v;
    savePrefs();
    windows.autoHide(true);
  },
  onError: (e) => { if (win && !win.isDestroyed()) win.webContents.send("ai-error", e === "csc" ? t("No encontré el compilador de C# de Windows (.NET Framework 4): sin él Nimbo no puede leer tus ventanas.") : t("No pude preparar la barra de tareas de Nimbo.")); },
});
function setTaskbarMode(on) {
  prefs.taskbarMode = on;
  savePrefs();
  W = on ? 640 : 440;
  if (win && !win.isDestroyed() && !mini) placeWindow();
  if (on) { windows.set(true); taskbarArming = true; setTimeout(() => windows.state(), 1500); } // primero se lee cómo estaba la barra; después se oculta
  else { windows.autoHide(prefs.taskbarPrevAutoHide === 1); setTimeout(() => windows.set(false), 600); }
}
ipcMain.on("task-do", (_e, action, h) => { windows.act(String(action), String(h)); });
app.whenReady().then(() => {
  if (prefs.taskbarMode !== true) return;
  barraLog("arranque de Nimbo: se prende la barra");
  try { windows.set(true); } catch (e) { barraLog("windows.set falló: " + e.message); } // un fallo aquí NO puede impedir que salgan las ancladas
  sendTasks(); // las ancladas salen ya: al encender el PC el lector de ventanas puede tardar en responder
  importWindowsPins();
});
app.on("before-quit", () => windows.stop());

// --- La aldea (village.js): cada carpeta con chats es una casa y cada chat, un aldeano. Ventana aparte, opaca (barata de dibujar). ---
const village = createVillage({
  listSessions: () => listSessions(CHAT_DIR, { limit: 60, includeScratch: true }),
  configFile: path.join(app.getPath("userData"), "aldea.json"), // qué chat vive en qué casa (texto editable: lo leen el vault y el Orquestador)
  page: () => `nimbo://app/src/renderer/village.html?lang=${lang()}`,
  preload: path.join(__dirname, "village-preload.js"),
  name: () => String(prefs.name ?? ""),
});
ipcMain.on("village-show", () => village.open());

// --- Conexiones y ajustes: el estado de cada conexión y las acciones del panel ---
// La app instalada no exige tener Node: un .cmd corre hook.js con el propio ejecutable de Nimbo
// en modo Node (ELECTRON_RUN_AS_NODE). En desarrollo se usa `node hook.js`.
function hookCommand() {
  if (!app.isPackaged) return undefined;
  if (process.platform !== "win32") {
    // macOS y Linux: un hook.sh. El .app y el .deb tienen una ruta fija y corren hook.js con su propio ejecutable en modo Node.
    // Un AppImage se monta en una carpeta distinta cada vez (y arrancarlo en cada evento sería lento): ahí se copia hook.js
    // a la carpeta de datos y se corre con el `node` del sistema.
    const sh = path.join(app.getPath("userData"), "hook.sh");
    let text;
    if (process.env.APPIMAGE) {
      const hookDir = path.join(app.getPath("userData"), "hook");
      fs.mkdirSync(path.join(hookDir, "src", "main"), { recursive: true });
      fs.copyFileSync(path.join(ROOT, "hook.js"), path.join(hookDir, "hook.js"));
      fs.copyFileSync(path.join(__dirname, "platform.js"), path.join(hookDir, "src", "main", "platform.js"));
      if (!findInPath(["node"])) throw new Error(t("El AppImage necesita Node.js para conectar los hooks. Instala Node.js o usa el paquete .deb."));
      text = `#!/bin/sh\nexec node "${path.join(hookDir, "hook.js")}"\n`;
    } else {
      text = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${path.join(ROOT, "hook.js")}"\n`;
    }
    if (!fs.existsSync(sh) || fs.readFileSync(sh, "utf8") !== text) fs.writeFileSync(sh, text);
    fs.chmodSync(sh, 0o755);
    return `"${sh}"`;
  }
  const cmd = path.join(app.getPath("userData"), "hook.cmd");
  const text = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${path.join(ROOT, "hook.js")}"\r\n`;
  if (fs.readFileSync(cmd, { encoding: "utf8", flag: "a+" }) !== text) fs.writeFileSync(cmd, text);
  return `"${cmd.replace(/\\/g, "/")}"`;
}
// Páginas que el panel puede abrir: una lista fija, la página nunca manda la URL.
const LINKS = { ollama: "https://ollama.com/download", claude: "https://claude.com/claude-code", gh: "https://cli.github.com", connectors: "https://claude.ai/settings/connectors", spotifyDev: "https://developer.spotify.com/dashboard" };
const loginItem = () => (app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] });
// Iniciar con el sistema: Electron lo hace en Windows y macOS; en Linux se deja un archivo .desktop en la carpeta de autoinicio.
const linuxAutostart = () => path.join(process.env.XDG_CONFIG_HOME || path.join(require("os").homedir(), ".config"), "autostart", "nimbo.desktop");
const autostartOn = () => (process.platform === "linux" ? fs.existsSync(linuxAutostart()) : app.getLoginItemSettings(loginItem()).openAtLogin);
function setAutostart(on) {
  if (process.platform !== "linux") return app.setLoginItemSettings({ ...loginItem(), openAtLogin: on });
  if (!on) return fs.rmSync(linuxAutostart(), { force: true });
  fs.mkdirSync(path.dirname(linuxAutostart()), { recursive: true });
  const exe = process.env.APPIMAGE || process.execPath;
  fs.writeFileSync(linuxAutostart(), `[Desktop Entry]\nType=Application\nName=Nimbo\nExec="${exe}"${app.isPackaged ? "" : ` "${app.getAppPath()}"`}\nX-GNOME-Autostart-enabled=true\n`);
}
const ghStatus = () => new Promise((resolve) => {
  execFile("gh", ["auth", "status"], { windowsHide: true, timeout: 10_000 }, (err) => resolve(!err ? "on" : err.code === "ENOENT" ? "missing" : "off"));
});
async function setupStatus() {
  let hookState = "error"; // settings.json ilegible
  try { hookState = hooks.status(hookCommand()); } catch {}
  const t = trello.cached();
  return {
    name: String(prefs.name ?? ""),
    claude: claudeFound(),
    hooks: hookState,
    github: await ghStatus(),
    trello: t && t.boards.length ? t.boards.length : null,
    telegram: telegram.status(),
    ai: await aiState(),
    mail: { on: prefs.mailRead === true, count: mail.cached().emails.length, important: mail.cached().emails.filter((e) => e.important).length },
    spotify: !spotifyApi.configured() ? null : spotifyApi.connected(), // null = sin Client ID · false = falta entrar
    theme: prefs.theme,
    voice: voiceReady() ? prefs.speak === true : null, // null = no hay servicio de voz configurado
    wake: process.platform === "win32" ? prefs.wakeWord === true : null, // null = no se puede (solo Windows)
    taskbar: process.platform === "win32" ? prefs.taskbarMode === true : null,
    whatsappRead: prefs.whatsappRead === true,
    whatsappBrain: prefs.whatsappRead === true ? await wa.brain() : "",
    autostart: autostartOn(),
    platform: process.platform,
  };
}
// --- Ver la pantalla: UN pantallazo, solo cuando tú pulsas 🖥 en el chat ---
// No hay vista en vivo ni capturas automáticas. Se toma la pantalla donde está el cursor, se
// reduce a lo que Claude aprovecha (1568 px de lado) y vuelve a la página como miniatura: tú
// decides si la mandas. Nimbo se excluye de su propia captura para no tapar lo que hay debajo.
const SHOT_MAX_SIDE = 1568;
ipcMain.handle("screenshot", async () => {
  if (!win || win.isDestroyed() || mini) return null;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const px = { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor };
    const k = Math.min(1, SHOT_MAX_SIDE / Math.max(px.width, px.height));
    const thumbnailSize = { width: Math.round(px.width * k), height: Math.round(px.height * k) };
    win.setContentProtection(true);
    await new Promise((r) => setTimeout(r, 150)); // que Windows alcance a ocultar la ventana de la captura
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    const size = source.thumbnail.getSize();
    return { media_type: "image/jpeg", data: source.thumbnail.toJPEG(82).toString("base64"), width: size.width, height: size.height };
  } catch {
    return null;
  } finally {
    if (!win.isDestroyed()) win.setContentProtection(false);
  }
});

// --- Voz: la página pide el audio de una respuesta; aquí se decide con qué voz (el tema activo) ---
// Devuelve el mp3 o null. null = en silencio, sin avisos: voz apagada, sonidos silenciados, sin
// servicio configurado, sin internet o el servicio falló (una sola llamada, sin reintentos).
const voiceReady = () => speechUrl(prefs.ttsUrl) !== null;
ipcMain.handle("tts", (_e, text) => {
  if (prefs.speak !== true || muted || mini || !voiceReady()) return null;
  return fetchSpeech(prefs.ttsUrl, text, prefs.theme);
});
function setTheme(id) {
  if (!["jarvis", "cloud"].includes(id)) return;
  prefs.theme = id;
  savePrefs();
  win.webContents.send("theme", id); // la página corta lo que estuviera diciendo: la siguiente respuesta ya sale con la otra voz
}
function setSpeak(on) {
  prefs.speak = on === true;
  savePrefs();
  win.webContents.send("voice", prefs.speak);
}

ipcMain.handle("setup", () => setupStatus());
ipcMain.handle("setup-do", async (_e, action, value) => {
  let error;
  try {
    switch (String(action)) {
      case "hooks-on": hooks.install(hookCommand()); break;
      case "hooks-off": hooks.uninstall(); break;
      case "name":
        prefs.name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
        savePrefs();
        win.webContents.send("name", prefs.name);
        break;
      case "autostart": setAutostart(value === true); break;
      case "whatsapp": if (process.platform !== "win32") break; // lee las notificaciones de Windows: solo existe allí
        prefs.whatsappRead = value === true; savePrefs(); watchWhatsapp(); break;
      case "theme": setTheme(String(value)); break;
      case "speak": setSpeak(value === true); break;
      case "wake": prefs.wakeWord = value === true; savePrefs(); syncWake(); break;
      case "taskbar": setTaskbarMode(value === true); break;
      case "whatsapp-rules": shell.openPath(wa.rulesFile); break;
      case "trello": await refreshTrello(); break;
      case "spotify-id": {
        const id = String(value ?? "").trim().toLowerCase();
        if (id && !CLIENT_ID.test(id)) throw new Error(t("Ese no parece un Client ID de Spotify (son 32 letras y números)."));
        if (id !== prefs.spotifyClientId) spotifyApi.logout();
        prefs.spotifyClientId = id;
        savePrefs();
        break;
      }
      case "spotify-login":
        if (!safeStorage.isEncryptionAvailable()) throw new Error(t("Windows no puede cifrar el token en este equipo."));
        // No se espera: el permiso se da en el navegador y puede tardar. Al volver se avisa a la página.
        spotifyApi.login().then((ok) => { if (win && !win.isDestroyed()) win.webContents.send("spotify", ok); });
        break;
      case "spotify-logout": spotifyApi.logout(); break;
      case "telegram-token": {
        const token = String(value ?? "").trim();
        if (!telegram.TOKEN.test(token)) throw new Error(t("Ese no parece un token de bot de Telegram (se ve así: 123456789:AAH…)."));
        if (!safeStorage.isEncryptionAvailable()) throw new Error(t("Windows no puede cifrar el token en este equipo."));
        try { await telegram.verify(token); } catch { throw new Error(t("Telegram no aceptó ese token. Cópialo de nuevo desde @BotFather.")); }
        telegram.stop();
        telegramSaveToken(token);
        prefs.telegramChat = 0; // otro bot: hay que vincular de nuevo
        savePrefs();
        telegram.start();
        break;
      }
      case "mail-on": {
        const r = await refreshMail({ quiet: true }); // se comprueba de verdad antes de dejarlo activo (15–45 s)
        if (!r.ok) throw new Error(r.reason === "connector" ? t("No encuentro el conector de Gmail en tu Claude: actívalo en claude.ai y vuelve a intentar.") : t("No pude revisar el correo. Inténtalo de nuevo."));
        prefs.mailRead = true;
        savePrefs();
        win?.webContents.send("mail", { on: true, ...mail.cached() });
        break;
      }
      case "mail-off": prefs.mailRead = false; savePrefs(); mail.clear(); win?.webContents.send("mail", { on: false, ...mail.cached() }); break;
      case "mail-refresh": if (prefs.mailRead === true) await refreshMail(); break;
      case "ai-key": {
        const text = String(value ?? "");
        const id = text.slice(0, text.indexOf(":"));
        const key = text.slice(text.indexOf(":") + 1).trim();
        if (![...KEYED, "anthropic"].includes(id) || !KEY_FORMAT.test(key)) throw new Error(t("Esa clave no tiene el formato esperado."));
        if (!safeStorage.isEncryptionAvailable()) throw new Error(t("Windows no puede cifrar el token en este equipo."));
        const accepted = id === "anthropic" ? await claudeApi.verify(key) : await ai.verify(id, key);
        if (!accepted) throw new Error(t("{0} no aceptó esa clave.", id === "gemini" ? "Gemini" : id === "anthropic" ? "Claude (API)" : "OpenAI"));
        aiLoad()[id] = key;
        aiSave();
        break;
      }
      case "ollama-open": openOllama(); break;
      case "ollama-pull": {
        // Solo el modelo recomendado y solo con el clic del usuario; avisa el avance a la página cada segundo.
        if (aiPull) break;
        const controller = new AbortController();
        aiPull = { percent: 0, controller };
        let sentAt = 0;
        pullModel({ name: RECOMMENDED, signal: controller.signal, onProgress: (p) => {
          if (p.percent !== null) aiPull.percent = p.percent;
          if (Date.now() - sentAt > 1000) { sentAt = Date.now(); aiState().then((s) => win?.webContents.send("ai", s)); }
        } }).then(async (r) => {
          aiPull = null;
          const s = await aiState();
          win?.webContents.send("ai", s);
          if (r.error && r.error !== "cancelled") win?.webContents.send("ai-error", t("No pude descargar el modelo. Revisa tu conexión y que Ollama esté abierto."));
        });
        break;
      }
      case "ollama-pull-cancel": aiPull?.controller.abort(); break;
      case "ai-key-clear": {
        const id = String(value ?? "");
        if ([...KEYED, "anthropic"].includes(id)) {
          delete aiLoad()[id]; aiSave(); aiHistory.delete(id);
          if (id === "anthropic" && prefs.engine === "api") { prefs.engine = ""; savePrefs(); } // sin clave no hay motor API
        }
        break;
      }
      case "telegram-pair": if (telegram.pair()) telegram.start(); break;
      case "telegram-logout": telegram.stop(); telegram.logout(); telegramSaveToken(""); prefs.telegramChat = 0; savePrefs(); break;
      case "open":
        // "guide" = la guía de conexiones del README, en el idioma de la interfaz.
        if (value === "ai-guide") shell.openExternal(`https://github.com/FedericoChalaca/nimbo/blob/main/${lang() === "es" ? "README.es.md#12-otras-ias-opcional" : "README.md#12-other-ais-optional"}`);
        else if (value === "telegram-bot") { const b = telegram.status().bot; if (/^[A-Za-z0-9_]{4,32}$/.test(b)) shell.openExternal(`https://t.me/${b}`); }
        else if (value === "telegram-guide") shell.openExternal(`https://github.com/FedericoChalaca/nimbo/blob/main/${lang() === "es" ? "README.es.md#11-telegram-opcional" : "README.md#11-telegram-optional"}`);
        else if (value === "spotify-guide") shell.openExternal(`https://github.com/FedericoChalaca/nimbo/blob/main/${lang() === "es" ? "README.es.md#10-spotify-opcional" : "README.md#10-spotify-optional"}`);
        else if (value === "guide") shell.openExternal(`https://github.com/FedericoChalaca/nimbo/blob/main/${lang() === "es" ? "README.es.md#conectar-todo" : "README.md#connect-everything"}`);
        else if (Object.hasOwn(LINKS, value)) shell.openExternal(LINKS[value]);
        break;
      case "done": prefs.onboarded = true; savePrefs(); break;
    }
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 160);
  }
  const status = { ...(await setupStatus()), error };
  if (String(action).startsWith("ai-")) win?.webContents.send("ai", status.ai); // el selector del chat se actualiza solo
  return status;
});

// El menú de opciones. Sale con clic derecho sobre Nimbo, con el botón ⋮ de la isla y con el
// icono de Nimbo junto al reloj (por si a alguien no le funciona el clic derecho).
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: t("Revisar correo"), click: () => win.webContents.send("mail-open-ui") },
    { label: t("Conexiones y ajustes…"), click: () => win.webContents.send("setup-open") },
    { type: "separator" },
    {
      label: t("Modo mini  ({0})", MINI_SHORTCUT.replace("Control", "Ctrl")),
      type: "checkbox",
      checked: mini,
      click: () => setMini(!mini),
    },
    {
      label: t("Esquina del modo mini"),
      submenu: [
        ["top-left", t("Arriba a la izquierda")],
        ["top-right", t("Arriba a la derecha")],
        ["bottom-left", t("Abajo a la izquierda")],
        ["bottom-right", t("Abajo a la derecha")],
      ].map(([id, label]) => ({
        label,
        type: "radio",
        checked: corner === id,
        click: () => {
          corner = id;
          savePrefs();
          if (mini) placeWindow();
        },
      })),
    },
    {
      label: t("Apariencia"),
      submenu: [
        ["jarvis", "JARVIS"],
        ["cloud", t("Nube")],
      ].map(([id, label]) => ({
        label,
        type: "radio",
        checked: prefs.theme === id,
        click: () => setTheme(id),
      })),
    },
    {
      label: "Idioma / Language",
      submenu: [
        ["es", "Español"],
        ["en", "English"],
      ].map(([id, label]) => ({
        label,
        type: "radio",
        checked: lang() === id,
        click: () => {
          prefs.lang = id;
          savePrefs();
          win.loadURL(pageUrl()); // la página se recarga en el idioma nuevo
          musicBar.reload();
          watchWhatsapp();
          setTimeout(pollGithub, 3000);
        },
      })),
    },
    { label: t("Actualizar Trello"), click: () => refreshTrello() },
    ...(updateInfo ? [{ label: t("⬆ Actualizar Nimbo a {0}", updateInfo.version), click: () => win.webContents.send("update", updateInfo) }] : []),
    { label: t("Buscar actualizaciones"), click: () => checkUpdates({ manual: true }) },
    { label: t("Avisarme de versiones nuevas"), type: "checkbox", checked: prefs.updateCheck === true, click: (item) => { prefs.updateCheck = item.checked; savePrefs(); if (item.checked) checkUpdates(); } },
    { label: t("Silencio si estoy mirando la terminal"), type: "checkbox", checked: prefs.quietWhenWatching !== false, click: (item) => { prefs.quietWhenWatching = item.checked; savePrefs(); } },
    {
      label: t("Leer mensajes de WhatsApp (los resume tu Claude)"),
      type: "checkbox",
      checked: prefs.whatsappRead === true,
      click: (item) => {
        prefs.whatsappRead = item.checked;
        savePrefs();
        watchWhatsapp();
      },
    },
    { label: t("Reglas de WhatsApp…"), enabled: prefs.whatsappRead === true, click: () => shell.openPath(wa.rulesFile) },
    {
      label: t("Motor de Nimbo"),
      submenu: [
        ["", t("Suscripción de Claude (usa tu plan; un poco más lento)")],
        ["api", aiLoad().anthropic ? t("API de Claude (más rápido; gasta tus créditos de API)") : t("API de Claude (primero pega tu clave en Conexiones → Otras IAs)")],
      ].map(([value, label]) => ({
        label, type: "radio", checked: (prefs.engine === "api" ? "api" : "") === value, enabled: value === "" || !!aiLoad().anthropic,
        click: () => { prefs.engine = value; savePrefs(); },
      })),
    },
    { label: t("Nueva conversación"), click: () => { orchestrator.reset(); aiHistory.clear(); } },
    { label: t("Aldea de agentes"), click: () => village.open() },
    { type: "separator" },
    {
      label: t("Avisos al celular (Telegram)"),
      enabled: telegram.status().paired,
      submenu: [
        ["claude", "Claude Code: terminó un trabajo o te necesita"], ["reminders", "Recordatorios"], ["mail", "Correo importante"],
        ["whatsapp", "WhatsApp urgente (solo el nombre del chat)"], ["onlyAway", "Solo si estoy lejos del PC"],
      ].map(([key, label]) => ({
        label: t(label), type: "checkbox", checked: alertCfg()[key] === true,
        click: (item) => { prefs.telegramAlerts = { ...alertCfg(), [key]: item.checked }; savePrefs(); },
      })),
    },
    {
      label: t("Barra de música flotante"),
      type: "checkbox",
      checked: prefs.musicBar !== false,
      click: (item) => { prefs.musicBar = item.checked; savePrefs(); if (item.checked) musicBar.reset(); else musicBar.sync(); },
    },
    {
      label: t("Nimbo como barra de tareas"),
      type: "checkbox",
      checked: prefs.taskbarMode === true,
      visible: process.platform === "win32",
      click: (item) => setTaskbarMode(item.checked),
    },
    {
      // También se puede arrastrar: cerca de un borde se pega ahí; lejos, queda flotando.
      label: t("Posición de Nimbo"),
      submenu: [["top", t("Arriba")], ["bottom", t("Abajo")], ["left", t("A la izquierda")], ["right", t("A la derecha")], ["float", t("Flotando")]].map(([edge, label]) => ({
        label, type: "radio", checked: dockState().edge === edge, click: () => setDock({ ...dockState(), edge }),
      })).concat(screen.getAllDisplays().length > 1 ? [{ type: "separator" }, { label: t("Pasar a la otra pantalla"), click: () => {
        const all = screen.getAllDisplays();
        const now = displayOf(dockState());
        setDock({ ...dockState(), display: all[(all.findIndex((d) => d.id === now.id) + 1) % all.length].id, x: undefined, y: undefined });
      } }] : []),
    },
    {
      label: t("«Oye Nimbo»: escuchar siempre"),
      type: "checkbox",
      checked: prefs.wakeWord === true,
      visible: process.platform === "win32",
      click: (item) => { prefs.wakeWord = item.checked; savePrefs(); syncWake(); },
    },
    {
      label: t("Decir «te escucho» al llamarlo"),
      type: "checkbox",
      checked: prefs.cueVoice !== false,
      visible: process.platform === "win32",
      click: (item) => { prefs.cueVoice = item.checked; savePrefs(); },
    },
    {
      label: t("Voz amable de Piper (en D:\\piper)"),
      type: "checkbox",
      checked: prefs.voiceEngine === "piper",
      visible: havePiper(),
      click: (item) => { prefs.voiceEngine = item.checked ? "piper" : ""; savePrefs(); warmPhrases(); },
    },
    {
      label: t("Historial de «Oye Nimbo»"),
      visible: process.platform === "win32" && fs.existsSync(WAKE_LOG),
      click: () => shell.openPath(WAKE_LOG),
    },
    {
      label: t("Leer las respuestas en voz alta"),
      type: "checkbox",
      checked: prefs.speak === true,
      enabled: voiceReady(),
      click: (item) => setSpeak(item.checked),
    },
    {
      label: t("Silenciar sonidos"),
      type: "checkbox",
      checked: muted,
      click: (item) => {
        muted = item.checked;
        win.webContents.send("muted", muted);
      },
    },
    { type: "separator" },
    { label: t("Salir"), click: () => app.quit() },
  ]);
}
ipcMain.on("menu", () => buildMenu().popup({ window: win }));
function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, "assets", "icon.png"));
  if (icon.isEmpty()) return; // sin icono no hay bandeja; el resto de Nimbo sigue igual
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip("Nimbo");
  const open = () => tray.popUpContextMenu(buildMenu()); // se arma en el momento: las marcas reflejan el estado actual
  tray.on("click", open);
  tray.on("right-click", open);
  if (process.env.NIMBO_DEBUG) console.error("bandeja:", JSON.stringify(tray.getBounds()));
}

// --- Permisos: una tarjeta a la vez ---
let pending = null; // { finish(decision) }

ipcMain.on("decision", (_e, decision, rid) => { if (pending && pending.id === rid) pending.finish(decision); });

function askPermission(payload, nonce, res) {
  const reply = (decision) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ decision, mac: mac(`res:${nonce}:${decision}`) }));
  };
  // Ya hay una tarjeta abierta, o Nimbo está en mini: la pregunta va a la terminal.
  if (pending || mini || !win || win.isDestroyed()) return reply("");

  const me = {
    id: nonce,
    remoteId: crypto.randomUUID(), // el celular decide con este id, nunca con el nonce del hook
    payload,
    finish(decision) {
      // Cada petición solo cierra su propia tarjeta, nunca la de la siguiente.
      if (pending !== me) return;
      clearTimeout(timer);
      pending = null;
      if (!win.isDestroyed()) win.webContents.send("permission-done");
      if (!res.writableEnded) reply(["allow", "always", "deny"].includes(decision) ? decision : "");
    },
  };
  pending = me;
  const timer = setTimeout(() => me.finish(""), DECISION_TIMEOUT);
  // Claude Code mató el hook (o respondiste en la terminal): quita la tarjeta.
  res.on("close", () => me.finish(""));
  win.webContents.send("permission", { ...payload, rid: nonce });
}

// Solo escucha en 127.0.0.1 y solo acepta mensajes firmados por hook.js, cada uno una vez.
const seenNonces = new Set();
http
  .createServer((req, res) => {
    // La vuelta del permiso de Spotify (spotify-api.js): solo vale con una entrada en curso y su `state`.
    if (req.method === "GET" && req.url.startsWith("/spotify?") && req.headers.host === `127.0.0.1:${PORT}`) {
      spotifyApi.callback(new URLSearchParams(req.url.slice(9))).then((ok) => {
        res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Nimbo</title><body style="font:16px Segoe UI,sans-serif;background:#0b0c0e;color:#eceef2;display:grid;place-items:center;height:100vh;margin:0"><p>${ok ? t("Spotify quedó conectado con Nimbo. Ya puedes cerrar esta pestaña.") : t("No se pudo conectar Spotify. Vuelve a Nimbo e inténtalo de nuevo.")}</p>`);
      });
      return;
    }
    if (req.method !== "POST" || !["/hook", "/permission"].includes(req.url) || req.headers.host !== `127.0.0.1:${PORT}`) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1 << 20) req.destroy();
    });
    req.on("end", () => {
      const nonce = String(req.headers["x-nimbo-nonce"] ?? "");
      if (!nonce || !sameMac(req.headers["x-nimbo-mac"], mac(`req:${nonce}:${body}`))) {
        res.writeHead(401).end();
        return;
      }
      if (seenNonces.has(nonce)) {
        res.writeHead(401).end();
        return;
      }
      seenNonces.add(nonce);
      if (seenNonces.size > 5000) seenNonces.clear();
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      // Qué chat es: el título de la barra lateral (o la carpeta si no tiene título).
      payload.title = sessionTitle(payload.transcript_path) ||
        (path.resolve(String(payload.cwd ?? "")) === CHAT_DIR ? "Nimbo" : path.basename(String(payload.cwd ?? "")));
      // Cuánto contexto lleva ese chat: al empezar y al terminar cada turno (y entre herramientas, solo si la transcripción creció).
      if (["UserPromptSubmit", "Stop", "PostToolUse", "SessionStart"].includes(payload.hook_event_name)) payload.context = sessionContext(payload.transcript_path);
      try { alerts.onHook(payload); } catch {} // avisos al celular (solo el título del chat y el nombre de la herramienta)
      try { remote.onHook(payload); } catch {} // estado de los chats para la app del iPhone
      if (req.url === "/permission") return askPermission(payload, nonce, res);
      res.writeHead(204).end();
      const deliver = () => { if (win && !win.isDestroyed()) win.webContents.send("hook", payload); try { village.hook(payload); } catch {} };
      // "Silencio si estoy mirando": si el trabajo terminó con la terminal o el chat de Claude al frente, la isla no suena (solo cambia de estado).
      if (payload.hook_event_name === "Stop" && prefs.quietWhenWatching !== false) foreground().then((name) => { payload.watching = isWatching(name); deliver(); }, deliver);
      else deliver();
    });
  })
  .listen(PORT, "127.0.0.1");

// --- Versiones nuevas (updates.js): solo si el dueño lo aceptó. Avisa; en Windows con la app instalada baja el instalador, verifica su SHA-256 y lo abre. ---
let updateInfo = null; // la versión más nueva que se encontró (o null)
async function checkUpdates({ manual = false } = {}) {
  if (prefs.updateCheck !== true && !manual) return;
  try {
    const info = await updates.latest({ current: app.getVersion(), platform: process.platform, arch: process.arch });
    updateInfo = info && { ...info, current: app.getVersion() };
    if (!info) { if (manual) win?.webContents.send("update-none", app.getVersion()); return; }
    if (!manual && Date.now() < (prefs.updateLater ?? 0)) return; // "Más tarde": no vuelve a avisar hasta mañana
    win?.webContents.send("update", updateInfo);
  } catch { if (manual) win?.webContents.send("update-none", ""); }
}
async function askUpdateConsent() {
  if (prefs.updateCheck !== undefined || process.env.CI || process.env.NIMBO_SMOKE_EXE) return;
  const r = await dialog.showMessageBox({ type: "question", title: "Nimbo", message: t("¿Quieres que Nimbo te avise cuando salga una versión nueva?"),
    detail: t("Nimbo mirará la página de versiones de Nimbo en GitHub un par de veces al día. No envía nada tuyo. Lo cambias cuando quieras en el menú (clic derecho → Avisarme de versiones nuevas)."),
    buttons: [t("Sí, avisarme"), t("No, gracias")], defaultId: 0, cancelId: 1, noLink: true });
  prefs.updateCheck = r.response === 0;
  savePrefs();
  if (prefs.updateCheck) checkUpdates();
}
// Tras actualizar: qué trae la versión nueva (se lee de su página en GitHub, solo con el aviso de versiones aceptado).
async function showWhatsNew() {
  const cur = app.getVersion();
  if (prefs.lastVersion && prefs.lastVersion !== cur && updates.isNewer(cur, prefs.lastVersion))
    win?.webContents.send("whatsnew", { version: cur, notes: prefs.updateCheck === true ? await updates.notesFor(cur) : [] });
  if (prefs.lastVersion !== cur) { prefs.lastVersion = cur; savePrefs(); }
}
ipcMain.handle("update-install", async () => {
  const info = updateInfo;
  if (!info) return { error: "none" };
  const openPage = () => { shell.openExternal(info.page); return { opened: true }; };
  if (process.platform !== "win32" || !app.isPackaged || !info.asset) return openPage(); // Linux, macOS o desde el código: la página de la versión
  const r = await updates.download(info.asset, path.join(app.getPath("temp"), "nimbo-update"), { onProgress: (p) => win?.webContents.send("update-progress", p) });
  if (r.error === "nodigest" || r.error === "url") return openPage(); // sin forma de verificarlo no se instala nada
  if (r.error) return { error: r.error };
  require("child_process").spawn(r.file, [], { detached: true, stdio: "ignore" }).unref(); // el instalador reemplaza a Nimbo y lo vuelve a abrir
  setTimeout(() => app.quit(), 500);
  return { ok: true };
});
ipcMain.on("update-later", () => { prefs.updateLater = Date.now() + 24 * 3600_000; savePrefs(); });

// Sin esto Windows no muestra las notificaciones de una app sin instalador.
app.setAppUserModelId("Nimbo");
app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.hide(); // una app de la barra superior: sin icono en el Dock
  serveAppFiles();
  createWindow();
  createTray();
  globalShortcut.register(MINI_SHORTCUT, () => setMini(!mini));
  globalShortcut.register(ASK_SHORTCUT, () => { if (mini) setMini(false); win.webContents.send("quick-ask"); });
  setTimeout(pollGithub, 8000);
  setTimeout(checkPlan, 7000); // después del saludo
  setTimeout(showWhatsNew, 12_000);
  setTimeout(() => (prefs.updateCheck === undefined ? askUpdateConsent() : checkUpdates()), 45_000);
  setInterval(checkUpdates, 6 * 3600_000);
  setInterval(checkPlan, 30 * 60_000);
  watchWhatsapp();
  if (telegram.status().token) telegram.start();
  remote.listen();
  musicBar.sync(); // si Spotify ya estaba sonando al arrancar
  setTimeout(refreshTrelloIfStale, 90_000); // después de arrancar, para no competir con el inicio
  setInterval(refreshTrelloIfStale, 15 * 60_000); // reintentos, y por si el PC queda prendido varios días
  setInterval(checkReminders, 15_000);
  setTimeout(checkReminders, 5000); // los que vencieron con el PC apagado avisan al arrancar
  setInterval(pollGithub, 5 * 60_000);
  // Micrófono sí (solo audio, solo esta ventana); cámara y demás permisos, no.
  // Al pedir permiso Electron manda mediaTypes [...]; al consultarlo, mediaType "audio"/"video".
  const audioOnly = (perm, d) => perm === "media" && !(d?.mediaTypes ?? []).includes("video") && d?.mediaType !== "video";
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(audioOnly(perm, details)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm, _origin, details) => audioOnly(perm, details));
});
app.on("window-all-closed", () => app.quit());

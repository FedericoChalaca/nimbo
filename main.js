// Nimbo: ventana transparente arriba de la pantalla + servidor local que recibe
// los hooks de Claude Code y se los pasa al personaje.
const { app, BrowserWindow, screen, ipcMain, Menu, globalShortcut, session, protocol, net, shell, Notification, clipboard, desktopCapturer, Tray, nativeImage } = require("electron");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createOrchestrator, sessionTitle, claudeFound } = require("./orchestrator");
const hooks = require("./install-hooks");
const { translator } = require("./i18n");
const { createReminders } = require("./reminders");
const { createTrello } = require("./trello");
const { createWhatsapp } = require("./whatsapp");
const { fetchSpeech, speechUrl } = require("./tts");

const PORT = 47823;
const W = 440;
const H = 480;
const MINI_SHORTCUT = "Control+Alt+N";
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
    const file = path.resolve(__dirname, "." + decodeURIComponent(new URL(req.url).pathname));
    // Solo archivos de la carpeta de Nimbo: nada de ../ para salir de ahí.
    if (!file.startsWith(__dirname + path.sep)) return new Response("", { status: 403 });
    const res = await net.fetch(pathToFileURL(file).href);
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
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + prefs.pos * (workArea.width - W)),
    y: workArea.y,
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
  // Los clics atraviesan la ventana salvo sobre la nube y las cajas (ver más abajo).
  win.setIgnoreMouseEvents(true);
  win.loadURL(pageUrl());
  // Soltar un archivo en la ventana no debe abrirlo como página: lo maneja index.html.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("did-finish-load", () => {
    win.webContents.send("theme", prefs.theme);
    win.webContents.send("anchor", prefs.pos);
    if (mini) win.webContents.send("mini", true); // tras recargar (cambio de idioma)
    win.webContents.send("name", String(prefs.name ?? ""));
    // Primera vez: se abre solo el panel de conexiones para dejar todo andando.
    if (!prefs.onboarded) setTimeout(() => { if (!mini && !win.isDestroyed()) win.webContents.send("setup-open"); }, 4500);
    if (whatsapp) win.webContents.send("whatsapp", whatsapp);
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
      // La isla se alinea dentro de la ventana según f (0 izquierda … 1 derecha), así llega a
      // las esquinas sin cortarse. Se despeja la x de la ventana para que la isla quede justo
      // bajo el punto por donde la agarraste. A cada lado se reservan 14 px para sus esquinas
      // invertidas: islaIzq = winX + 14 + f·(W − 28 − w), f = (winX − a.x)/span.
      const a = screen.getPrimaryDisplay().workArea;
      const span = a.width - W;
      const k = (W - 28 - drag.w) / span;
      const wx = Math.round(Math.min(a.x + span, Math.max(a.x, (p.x - drag.grab - 14 + a.x * k) / (1 + k))));
      prefs.pos = (wx - a.x) / span;
      if (wx !== b.x) {
        win.setBounds({ x: wx, y: a.y, width: W, height: H });
        win.webContents.send("anchor", prefs.pos);
      }
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
  const w = Number(d?.w);
  const grab = Number(d?.grab);
  if (mini || !Number.isFinite(w) || !Number.isFinite(grab)) return;
  drag = { w: Math.min(Math.max(w, 60), W), grab: Math.min(Math.max(grab, 0), W), since: Date.now() };
  win.setIgnoreMouseEvents(false); // mientras se arrastra, la ventana no suelta el mouse
});
ipcMain.on("drag-end", () => {
  if (!drag) return;
  drag = null;
  savePrefs();
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
  speak: false, ttsUrl: "" };
try {
  prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile, "utf8")) };
} catch {}
let corner = prefs.corner;
const savePrefs = () => fs.writeFileSync(prefsFile, JSON.stringify({ ...prefs, corner }));
// Idioma: el elegido en el menú (prefs.lang) o, si no, el de Windows. Los textos están en
// español en el código; i18n.js trae el inglés.
const lang = () => (["es", "en"].includes(prefs.lang) ? prefs.lang : app.getLocale().toLowerCase().startsWith("es") ? "es" : "en");
const t = (s, ...a) => translator(lang())(s, ...a);
const pageUrl = () => `nimbo://app/index.html?lang=${lang()}`;
const MINI_W = 100;
const MINI_H = 60;
const MARGIN = 8;

function placeWindow() {
  const { workArea: a } = screen.getPrimaryDisplay();
  if (!mini) {
    win.setBounds({ x: Math.round(a.x + prefs.pos * (a.width - W)), y: a.y, width: W, height: H });
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
  if (mini) pending?.finish("");
  else if (prefs.whatsappRead === true) wa.poke(); // lo que llegó mientras jugabas
  win.webContents.send("mini", mini);
  placeWindow();
}
ipcMain.on("toggle-mini", () => setMini(!mini));

// --- Chat + orquestador: usa tu Claude Code, sin API key aparte ---
const CHAT_DIR = path.join(app.getPath("userData"), "chat");
const orchestrator = createOrchestrator(CHAT_DIR, { vault: prefs.vault, lang });
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
    if (Notification.isSupported()) new Notification({ title: t("Nimbo · recordatorio"), body: r.text, silent: mini }).show();
  }
}

ipcMain.handle("ask", async (_e, msg) => {
  const r = await orchestrator.ask(msg, { reminders: reminders.pending() });
  const added = (r.reminders ?? []).map((x) => reminders.add(x)).filter(Boolean);
  for (const id of r.complete ?? []) reminders.complete(String(id));
  if (added.length || r.complete?.length) remindersChanged();
  return { ...r, added };
});
ipcMain.handle("dispatch", (_e, id, prompt) => orchestrator.dispatch(String(id), String(prompt)));

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
  paused: () => mini,
  onChange(state, alert) {
    whatsapp = state;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("whatsapp", state, alert);
    // Lo urgente también sale como notificación de Windows: se ve en mini o jugando.
    if (alert && Notification.isSupported()) new Notification({ title: t("WhatsApp urgente · {0}", alert.name), body: alert.summary }).show();
  },
});
let waChild = null;
function watchWhatsapp() {
  waChild?.kill();
  waChild = wa.watch(prefs.whatsappRead === true);
}
app.on("before-quit", () => waChild?.kill());
ipcMain.on("open-whatsapp", () => shell.openExternal("whatsapp://"));
ipcMain.on("whatsapp-refresh", () => wa.refresh());
ipcMain.on("whatsapp-dismiss", () => wa.dismiss());
// Copiar la respuesta sugerida: Nimbo no escribe en WhatsApp, tú la pegas si te sirve.
ipcMain.on("copy", (_e, text) => clipboard.writeText(String(text ?? "").slice(0, 500)));

// --- Trello: a través de tu claude (conector de claude.ai), solo lectura, cada 30 min ---
const trello = createTrello(path.join(app.getPath("userData"), "trello.json"));
ipcMain.handle("trello", () => trello.cached());
async function refreshTrello() {
  win?.webContents.send("trello-busy", true);
  const data = await trello.refresh();
  win?.webContents.send("trello-busy", false);
  if (data) win?.webContents.send("trello", data);
}
ipcMain.on("trello-refresh", () => refreshTrello());

// La ventana normalmente no roba el foco; solo lo toma mientras el chat está abierto.
ipcMain.on("chat-open", (_e, open) => {
  win.setFocusable(open);
  if (open) win.focus();
});

// --- Conexiones y ajustes: el estado de cada conexión y las acciones del panel ---
// La app instalada no exige tener Node: un .cmd corre hook.js con el propio ejecutable de Nimbo
// en modo Node (ELECTRON_RUN_AS_NODE). En desarrollo se usa `node hook.js`.
function hookCommand() {
  if (!app.isPackaged) return undefined;
  const cmd = path.join(app.getPath("userData"), "hook.cmd");
  const text = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${path.join(__dirname, "hook.js")}"\r\n`;
  if (fs.readFileSync(cmd, { encoding: "utf8", flag: "a+" }) !== text) fs.writeFileSync(cmd, text);
  return `"${cmd.replace(/\\/g, "/")}"`;
}
// Páginas que el panel puede abrir: una lista fija, la página nunca manda la URL.
const LINKS = { claude: "https://claude.com/claude-code", gh: "https://cli.github.com", connectors: "https://claude.ai/settings/connectors" };
const loginItem = () => (app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] });
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
    trello: t ? t.boards.reduce((n, b) => n + (b.pending || 0), 0) : null,
    theme: prefs.theme,
    voice: voiceReady() ? prefs.speak === true : null, // null = no hay servicio de voz configurado
    whatsappRead: prefs.whatsappRead === true,
    whatsappBrain: prefs.whatsappRead === true ? await wa.brain() : "",
    autostart: app.getLoginItemSettings(loginItem()).openAtLogin,
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
      case "autostart": app.setLoginItemSettings({ ...loginItem(), openAtLogin: value === true }); break;
      case "whatsapp": prefs.whatsappRead = value === true; savePrefs(); watchWhatsapp(); break;
      case "theme": setTheme(String(value)); break;
      case "speak": setSpeak(value === true); break;
      case "whatsapp-rules": shell.openPath(wa.rulesFile); break;
      case "trello": await refreshTrello(); break;
      case "open":
        // "guide" = la guía de conexiones del README, en el idioma de la interfaz.
        if (value === "guide") shell.openExternal(`https://github.com/FedericoChalaca/nimbo/blob/main/${lang() === "es" ? "README.es.md#conectar-todo" : "README.md#connect-everything"}`);
        else if (Object.hasOwn(LINKS, value)) shell.openExternal(LINKS[value]);
        break;
      case "done": prefs.onboarded = true; savePrefs(); break;
    }
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 160);
  }
  return { ...(await setupStatus()), error };
});

// El menú de opciones. Sale con clic derecho sobre Nimbo, con el botón ⋮ de la isla y con el
// icono de Nimbo junto al reloj (por si a alguien no le funciona el clic derecho).
function buildMenu() {
  return Menu.buildFromTemplate([
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
          watchWhatsapp();
          setTimeout(pollGithub, 3000);
        },
      })),
    },
    { label: t("Actualizar Trello"), click: () => refreshTrello() },
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
    { label: t("Nueva conversación"), click: () => orchestrator.reset() },
    { type: "separator" },
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
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
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
      if (req.url === "/permission") return askPermission(payload, nonce, res);
      res.writeHead(204).end();
      if (win && !win.isDestroyed()) win.webContents.send("hook", payload);
    });
  })
  .listen(PORT, "127.0.0.1");

// Sin esto Windows no muestra las notificaciones de una app sin instalador.
app.setAppUserModelId("Nimbo");
app.whenReady().then(() => {
  serveAppFiles();
  createWindow();
  createTray();
  globalShortcut.register(MINI_SHORTCUT, () => setMini(!mini));
  setTimeout(pollGithub, 8000);
  watchWhatsapp();
  setTimeout(refreshTrello, 90_000); // después de arrancar, para no competir con el inicio
  setInterval(refreshTrello, 30 * 60_000);
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

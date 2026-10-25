// La aldea de Nimbo: una ventana aparte donde cada casa es un tema o proyecto y cada chat de Claude Code, un aldeano que
// camina, trabaja frente a su casa y conversa con los demás (src/renderer/village.*). Aquí está lo del proceso principal:
// en qué casa vive cada chat (aldea.json), el estado de git y las fotos de cada proyecto, y la ventana.
//
// Casas: las define %APPDATA%\nimbo\aldea.json (texto editable; el vault y el Orquestador lo pueden leer). Cada chat se ubica así,
// en orden: (1) lo que el dueño movió a mano ("chats": id → casa), (2) palabras del título, (3) su carpeta o (4) las carpetas donde
// trabajó; (5) si tiene carpeta propia y no encaja en nada, nace una casa nueva para esa carpeta (se guarda en aldea.json);
// (6) si no tiene carpeta (chats "sin carpeta" de la app), vive en la plaza. Sin aldea.json todo arranca por carpeta (paso 5).
//
// Reglas: la página nunca manda rutas, solo el id de una casa y el número de una foto o carpeta; las fotos se buscan y se leen
// aquí, solo dentro de las carpetas de esa casa y solo imágenes de hasta 4 MB. Nada sale del PC.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MAX_HOUSES = 15; // los lotes que tiene el mapa (más la casa grande de la plaza)
const MAX_CHATS = 6; // aldeanos por casa (los chats más recientes)
const PHOTO_EXT = /\.(png|jpe?g|webp|gif)$/i;
const PHOTO_MAX = 4 * 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".cache", "coverage", "target", ".gradle", "Pods", "venv", ".venv", "__pycache__", ".expo", "android", "ios", ".dart_tool", "obj", "bin"]);
// Qué imágenes parecen "fotos del proyecto": capturas, portadas, previews… antes que íconos sueltos.
const GOOD_NAME = /screenshot|captura|pantall|preview|portada|cover|hero|og[-_]?image|opengraph|mockup|demo|banner|social|thumbnail|landing|home/i;
const GOOD_DIR = /screenshots?|capturas?|docs|media|public|promo|marketing|assets|images?|img/i;
const BAD_NAME = /favicon|icon|logo-?\d|sprite|apple-touch|android-chrome|mstile|placeholder|\bbg\b|pattern/i;
// Corridas automáticas que no son conversaciones tuyas (p. ej. las revisiones de seguridad de un plugin): no son aldeanos.
const AUTOMATED = /^(review this change for security vulnerabilities|you are a (security|code) reviewer)/i;
const AYUDA = "Casas de la Aldea de Nimbo. Cada casa: id (letras, números y guiones), nombre, tema, color (opcional, #rrggbb), carpetas (los chats en esas carpetas viven aquí), " +
  "palabras (si el título del chat las tiene, vive aquí) y ayuntamiento: true para la casa grande de la plaza. \"chats\": id del chat → id de su casa (lo que mueves a mano; \"plaza\" = sin casa). " +
  "Un chat nuevo con carpeta propia que no encaja en ninguna casa crea la suya sola. Se puede editar a mano con Nimbo cerrado o abierto (se relee cada vez).";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "casa";
const under = (file, folder) => { const f = norm(path.resolve(file)), d = norm(path.resolve(folder)); return f === d || f.startsWith(d.endsWith(path.sep) ? d : d + path.sep); };
const hasWord = (text, word) => { const w = norm(word).trim(); return !!w && new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(norm(text)); };

/** Lee aldea.json y deja solo lo válido. Si el archivo está roto NO se pisa: se trabaja en memoria y se avisa. */
function readConfig(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { casas: [], chats: {}, missing: e.code === "ENOENT", broken: e.code !== "ENOENT" }; }
  const casas = [];
  for (const c of Array.isArray(raw?.casas) ? raw.casas : []) {
    const id = slug(c?.id || c?.nombre);
    if (!c || casas.some((x) => x.id === id)) continue;
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 260)).slice(0, 30) : []);
    casas.push({ id, nombre: String(c.nombre || id).slice(0, 40), tema: String(c.tema ?? "").slice(0, 30), color: /^#[0-9a-f]{6}$/i.test(c.color ?? "") ? c.color : "",
      carpetas: list(c.carpetas), palabras: list(c.palabras), ayuntamiento: c.ayuntamiento === true });
  }
  const chats = {};
  for (const [k, v] of Object.entries(raw?.chats ?? {})) if (/^[\w-]{6,80}$/.test(k) && typeof v === "string") chats[k] = slug(v);
  return { ...raw, casas, chats };
}
function writeConfig(file, cfg) {
  const { missing, broken, ...rest } = cfg;
  if (broken) return false; // el dueño lo está editando y quedó mal: no se toca
  fs.writeFileSync(file, JSON.stringify({ _ayuda: AYUDA, ...rest }, null, 2));
  return true;
}

/**
 * Dónde vive cada chat (regla de arriba). Pura: no lee ni escribe nada. → { homes: Map(casa → chats), plaza: [chats], born: [casas nuevas] }
 * Un chat: { id, title, cwd, scratch, dirs }. born = casas que nacieron de chats con carpeta propia (hay que guardarlas).
 */
function placeChats(chats, cfg) {
  const casas = [...cfg.casas];
  const born = [];
  const homes = new Map(casas.map((c) => [c.id, []]));
  const plaza = [];
  const byFolder = (folder) => {
    let best = null, len = -1;
    for (const c of casas) for (const d of c.carpetas) if (under(folder, d) && d.length > len) { best = c; len = d.length; }
    return best;
  };
  for (const ch of chats) {
    const manual = cfg.chats[ch.id];
    let home = manual === "plaza" ? "plaza" : casas.find((c) => c.id === manual);
    home ??= casas.find((c) => c.palabras.some((w) => hasWord(ch.title, w)));
    if (!home && ch.cwd && !ch.scratch) home = byFolder(ch.cwd);
    if (!home) for (const d of ch.dirs ?? []) if ((home = byFolder(d))) break;
    if (!home && ch.cwd && !ch.scratch) {
      // Casa nueva para esa carpeta, con su nombre (si el nombre ya existe, se le agrega un número).
      let id = slug(path.basename(ch.cwd));
      for (let n = 2; casas.some((c) => c.id === id); n++) id = `${slug(path.basename(ch.cwd))}-${n}`;
      home = { id, nombre: path.basename(ch.cwd).slice(0, 40), tema: "", color: "", carpetas: [ch.cwd], palabras: [], ayuntamiento: false };
      casas.push(home);
      born.push(home);
      homes.set(id, []);
    }
    if (!home || home === "plaza") plaza.push(ch);
    else homes.get(home.id).push(ch);
  }
  return { casas, homes, plaza, born };
}

/** Nota de 0 (no sirve) a ~10 para elegir las imágenes que más parecen fotos del proyecto. */
function photoScore(rel, size) {
  const name = path.basename(rel);
  if (!PHOTO_EXT.test(name) || size < 12 * 1024 || size > PHOTO_MAX || BAD_NAME.test(name)) return 0;
  let score = 1;
  if (GOOD_NAME.test(name)) score += 5;
  if (GOOD_DIR.test(path.dirname(rel))) score += 2;
  if (size > 80 * 1024) score += 1; // las capturas pesan más que los adornos
  return score;
}

/** Hasta `max` imágenes de la carpeta (sin entrar a node_modules, .git, build…), las mejores primero. */
async function findPhotos(root, max = 8) {
  const found = [];
  let seen = 0;
  async function walk(dir, depth) {
    if (depth > 4 || seen > 5000) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (++seen > 5000) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(full, depth + 1); }
      else if (e.isFile() && PHOTO_EXT.test(e.name)) {
        const st = await fs.promises.stat(full).catch(() => null);
        const rel = path.relative(root, full);
        const score = st ? photoScore(rel, st.size) : 0;
        if (score) found.push({ rel, score, mtime: st.mtimeMs });
      }
    }
  }
  await walk(root, 0);
  return found.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, max).map((f) => f.rel);
}

/** La foto `rel` de la carpeta `root` como data: URL, o null si sale de la carpeta, no es imagen o pesa demasiado. */
async function readPhoto(root, rel) {
  const file = path.resolve(root, String(rel ?? ""));
  if (path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file)) || !PHOTO_EXT.test(file)) return null;
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st?.isFile() || st.size > PHOTO_MAX) return null;
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${ext};base64,${(await fs.promises.readFile(file)).toString("base64")}`;
}

const git = (cwd, args) => new Promise((resolve) => execFile("git", ["-C", cwd, ...args], { timeout: 4000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  (err, out) => resolve(err ? "" : String(out).trim())));
/** Rama, último commit y la dirección de GitHub (solo si el remoto es de github.com). */
async function gitInfo(cwd) {
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return null;
  const [last, remote, dirty] = await Promise.all([git(cwd, ["log", "-1", "--format=%s%x1f%cI"]), git(cwd, ["remote", "get-url", "origin"]), git(cwd, ["status", "--porcelain"])]);
  const [subject = "", when = ""] = last.split("\x1f");
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(remote);
  return { branch, subject: subject.slice(0, 90), when: Date.parse(when) || 0, github: m ? `https://github.com/${m[1]}` : "", changes: dirty ? dirty.split("\n").length : 0 };
}

/**
 * @param listSessions async () => chats (orchestrator.listSessions, con los "sin carpeta")
 * @param configFile   ruta de aldea.json
 * @param page         () => dirección de village.html
 * @param preload      ruta de village-preload.js
 * @param name         () => cómo se llama el dueño (para su personaje)
 */
function createVillage({ listSessions, configFile, page, preload, name }) {
  const { BrowserWindow, ipcMain, shell } = require("electron"); // aquí: así la autoprueba corre sin Electron
  let win = null;
  let houses = []; // la última lista que se le dio a la página (las fotos y los botones usan su id)
  const photoCache = new Map(); // id de casa → { at, list: [{ root, rel }] }

  async function data() {
    const cfg = readConfig(configFile);
    const chats = (await listSessions()).filter((s) => !AUTOMATED.test(String(s.lastPrompt ?? "")) && !AUTOMATED.test(String(s.title ?? "")))
      .map((s) => ({ id: s.id, title: String(s.title || s.lastPrompt || s.project || "Claude").slice(0, 60), lastPrompt: String(s.lastPrompt ?? "").slice(0, 140),
        at: s.at ?? 0, active: !!s.active, cwd: s.cwd, scratch: !!s.scratch, dirs: s.dirs ?? [] }));
    const { casas, homes, plaza, born } = placeChats(chats, cfg);
    if (born.length) writeConfig(configFile, { ...cfg, casas }); // las casas que nacieron quedan en aldea.json (se pueden renombrar o mover)
    const pub = (c) => ({ id: c.id, title: c.title, lastPrompt: c.lastPrompt, at: c.at, active: c.active });
    houses = casas.map((c) => {
      const list = homes.get(c.id).sort((a, b) => b.at - a.at);
      return { id: c.id, name: c.nombre, tema: c.tema, color: c.color, hall: c.ayuntamiento, folders: c.carpetas.filter((d) => fs.existsSync(d)), chats: list.slice(0, MAX_CHATS).map(pub),
        at: list[0]?.at ?? 0, more: Math.max(0, list.length - MAX_CHATS) };
    });
    // Primero la casa grande; después las que tienen gente (las más activas primero) y al final las vacías, hasta llenar los lotes.
    const hall = houses.find((h) => h.hall);
    const rest = houses.filter((h) => !h.hall).sort((a, b) => (b.chats.length > 0) - (a.chats.length > 0) || b.at - a.at).slice(0, MAX_HOUSES);
    const shown = [...(hall ? [hall] : []), ...rest];
    const out = await Promise.all(shown.map(async (h) => ({ ...h, projects: await Promise.all(h.folders.slice(0, 5).map(async (d, i) => ({ i, name: path.basename(d), path: d, git: await gitInfo(d) }))) })));
    return { houses: out, plaza: plaza.sort((a, b) => b.at - a.at).slice(0, 10).map(pub), name: name(), broken: !!cfg.broken, file: configFile };
  }
  const house = (id) => houses.find((h) => h.id === id);
  const fromVillage = (e) => win && e.sender === win.webContents;

  ipcMain.handle("village-data", (e) => (fromVillage(e) ? data() : null));
  ipcMain.handle("village-photos", async (e, id) => {
    const h = fromVillage(e) && house(id);
    if (!h) return [];
    const hit = photoCache.get(h.id);
    if (!hit || Date.now() - hit.at > 10 * 60_000) {
      // Hasta 8 fotos repartidas entre las carpetas de la casa.
      const per = await Promise.all(h.folders.slice(0, 5).map(async (root) => (await findPhotos(root, 8)).map((rel) => ({ root, rel }))));
      const list = [];
      for (let i = 0; list.length < 8 && per.some((p) => p[i]); i++) for (const p of per) if (p[i] && list.length < 8) list.push(p[i]);
      photoCache.set(h.id, { at: Date.now(), list });
    }
    return photoCache.get(h.id).list.map((p) => path.basename(p.rel)); // solo el nombre, para el pie de foto
  });
  ipcMain.handle("village-photo", async (e, id, i) => {
    const h = fromVillage(e) && house(id);
    const p = h && photoCache.get(h.id)?.list[Number(i)];
    return p ? readPhoto(p.root, p.rel) : null;
  });
  ipcMain.on("village-open", (e, id, what, i = 0) => {
    const h = fromVillage(e) && house(id);
    const folder = h?.folders[Number(i)];
    if (!folder) return;
    if (what === "folder") shell.openPath(folder);
    if (what === "github") gitInfo(folder).then((g) => { if (g?.github?.startsWith("https://github.com/")) shell.openExternal(g.github); });
  });
  // Mudar un chat a otra casa (o a la plaza), o fundar una casa nueva con él. Se guarda en aldea.json.
  ipcMain.handle("village-move", (e, chatId, to) => {
    if (!fromVillage(e) || !/^[\w-]{6,80}$/.test(String(chatId))) return { error: "bad" };
    const cfg = readConfig(configFile);
    if (cfg.broken) return { error: "broken" };
    const target = String(to) === "plaza" ? "plaza" : cfg.casas.find((c) => c.id === String(to))?.id;
    if (!target) return { error: "bad" };
    cfg.chats[chatId] = target;
    writeConfig(configFile, cfg);
    return { ok: true };
  });
  ipcMain.handle("village-found", (e, chatId, nombre) => {
    if (!fromVillage(e) || !/^[\w-]{6,80}$/.test(String(chatId))) return { error: "bad" };
    const cfg = readConfig(configFile);
    if (cfg.broken) return { error: "broken" };
    const label = String(nombre ?? "").trim().slice(0, 40) || "Casa nueva";
    let id = slug(label);
    for (let n = 2; cfg.casas.some((c) => c.id === id); n++) id = `${slug(label)}-${n}`;
    cfg.casas.push({ id, nombre: label, tema: "", color: "", carpetas: [], palabras: [], ayuntamiento: false });
    cfg.chats[chatId] = id;
    writeConfig(configFile, cfg);
    return { ok: true, id };
  });
  ipcMain.on("village-config", (e) => { if (fromVillage(e)) shell.openPath(configFile); }); // abrir aldea.json para editarlo a mano

  function open() {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
    win = new BrowserWindow({
      width: 1120, height: 720, minWidth: 760, minHeight: 480, show: false, backgroundColor: "#2f4f2a", autoHideMenuBar: true,
      title: "Aldea de Nimbo", icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true },
    });
    win.setMenuBarVisibility(false);
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => { win = null; });
    win.loadURL(page());
  }

  /** Un evento de Claude Code, recortado a lo que la aldea muestra (título del chat y el paso, nunca el contenido de archivos). */
  function hook(p) {
    if (!win || win.isDestroyed()) return;
    const input = p.tool_input ?? {};
    // De un comando se muestra su descripción (Claude Code la manda), no el comando crudo.
    const detail = input.description ?? (input.command && String(input.command).split(/\s+/)[0]) ?? (input.file_path && path.basename(String(input.file_path))) ?? input.pattern ?? input.query ?? "";
    win.webContents.send("village-hook", {
      session: String(p.session_id ?? ""), event: String(p.hook_event_name ?? ""), title: String(p.title ?? "").slice(0, 60),
      tool: String(p.tool_name ?? ""), detail: String(detail).slice(0, 60), prompt: String(p.prompt ?? "").replace(/\s+/g, " ").slice(0, 70),
      message: String(p.message ?? "").slice(0, 80), context: p.context ?? null,
    });
  }

  return { open, hook, isOpen: () => !!win };
}

module.exports = { createVillage, placeChats, readConfig, writeConfig, photoScore, findPhotos, readPhoto, gitInfo, hasWord };

// Autoprueba (sin Electron): node src/main/village.js
if (require.main === module) (async () => {
  const assert = require("assert");
  const os = require("os");
  // Dónde vive cada chat: a mano > palabras del título > su carpeta > donde trabajó > casa nueva > plaza.
  const cfg = { casas: [
    { id: "trabajo", nombre: "Trabajo", carpetas: ["D:\\trabajo tugu"], palabras: ["tugu"] },
    { id: "uni", nombre: "Universidad", carpetas: ["D:\\cosas u"], palabras: ["parcial", "calidad"] },
    { id: "nimbo", nombre: "Nimbo", carpetas: ["D:\\cosas u\\ciber\\nimbo"], palabras: ["nimbo"] },
    { id: "web", nombre: "Webs", carpetas: ["D:\\hobby\\portafolio macla"], palabras: [] },
  ].map((c) => ({ tema: "", color: "", ayuntamiento: false, ...c })), chats: { manual1: "web", aplaza: "plaza" } };
  const ch = (id, title, cwd, extra = {}) => ({ id, title, cwd, scratch: false, dirs: [], ...extra });
  const r = placeChats([
    ch("manual1", "Parcial 3", "D:\\cosas u"), // movido a mano: manda
    ch("t1", "Backend TUGU", "C:\\otra"), // por palabra del título
    ch("t2", "Arreglar Párchate", "D:\\cosas u\\ciber\\nimbo\\src"), // carpeta: la más específica (nimbo, no universidad)
    ch("t3", "Hacer el informe", "D:\\cosas u\\ciber"), // carpeta: universidad
    ch("t4", "Disco duro", "C:\\Users\\x\\scratch-workspaces\\abc", { scratch: true, dirs: ["D:\\hobby\\portafolio macla"] }), // sin carpeta, pero trabajó en una
    ch("t5", "Algo nuevo", "D:\\hobby\\juego nuevo"), // carpeta que no es de nadie: nace su casa
    ch("t6", "Juego nuevo 2", "D:\\hobby\\juego nuevo"), // y el segundo chat de esa carpeta se muda ahí
    ch("t7", "Pregunta suelta", "C:\\Users\\x\\scratch-workspaces\\def", { scratch: true }), // sin carpeta ni pistas: plaza
    ch("aplaza", "Calidad", "D:\\cosas u"), // a mano a la plaza (aunque el título diga calidad)
  ], cfg);
  const who = (id) => r.homes.get(id).map((c) => c.id);
  assert.deepStrictEqual(who("web"), ["manual1", "t4"]);
  assert.deepStrictEqual(who("trabajo"), ["t1"]);
  assert.deepStrictEqual(who("nimbo"), ["t2"]);
  assert.deepStrictEqual(who("uni"), ["t3"]);
  assert.deepStrictEqual(r.born.map((c) => [c.id, c.nombre]), [["juego-nuevo", "juego nuevo"]]);
  assert.deepStrictEqual(who("juego-nuevo"), ["t5", "t6"]);
  assert.deepStrictEqual(r.plaza.map((c) => c.id), ["t7", "aplaza"]);
  assert.ok(hasWord("Revisar proyecto Prediccthor", "prediccthor") && hasWord("Párchate landing", "parchate") && !hasWord("trazos", "trazo"));
  // aldea.json: se lee lo válido, se guarda bonito y uno roto NO se pisa.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-aldea-"));
  const file = path.join(tmp, "aldea.json");
  assert.strictEqual(readConfig(file).missing, true);
  fs.writeFileSync(file, JSON.stringify({ casas: [{ id: "A b", nombre: "A b", carpetas: ["x", 3], color: "rojo" }, { id: "a-b" }], chats: { "abcdef12": "A b", "../x": "y" } }));
  const got = readConfig(file);
  assert.deepStrictEqual(got.casas.map((c) => [c.id, c.carpetas, c.color]), [["a-b", ["x"], ""]]);
  assert.deepStrictEqual(got.chats, { abcdef12: "a-b" });
  assert.ok(writeConfig(file, got) && JSON.parse(fs.readFileSync(file, "utf8"))._ayuda);
  fs.writeFileSync(file, "{ roto");
  assert.strictEqual(readConfig(file).broken, true);
  assert.strictEqual(writeConfig(file, readConfig(file)), false);
  assert.strictEqual(fs.readFileSync(file, "utf8"), "{ roto");
  // Fotos: capturas antes que íconos; nada que no sea imagen ni lo que pese de más.
  assert.ok(photoScore("docs/screenshots/home.png", 200_000) > photoScore("src/x.png", 200_000));
  assert.strictEqual(photoScore("public/favicon.png", 50_000), 0);
  assert.strictEqual(photoScore("a.txt", 50_000), 0);
  assert.strictEqual(photoScore("big.png", 9 * 1024 * 1024), 0);
  fs.mkdirSync(path.join(tmp, "docs"));
  fs.mkdirSync(path.join(tmp, "node_modules", "pkg"), { recursive: true });
  const png = Buffer.alloc(20 * 1024, 1);
  fs.writeFileSync(path.join(tmp, "docs", "captura-inicio.png"), png);
  fs.writeFileSync(path.join(tmp, "logo.png"), png);
  fs.writeFileSync(path.join(tmp, "node_modules", "pkg", "screenshot.png"), png); // dentro de node_modules: no cuenta
  fs.writeFileSync(path.join(tmp, "secreto.txt"), "no");
  const photos = await findPhotos(tmp);
  assert.deepStrictEqual(photos, [path.join("docs", "captura-inicio.png"), "logo.png"]);
  assert.ok((await readPhoto(tmp, photos[0])).startsWith("data:image/png;base64,"));
  assert.strictEqual(await readPhoto(tmp, "secreto.txt"), null); // no es imagen
  fs.writeFileSync(path.join(path.dirname(tmp), "fuera-nimbo.png"), png);
  assert.strictEqual(await readPhoto(tmp, path.join("..", "fuera-nimbo.png")), null); // fuera de la carpeta: no
  fs.rmSync(path.join(path.dirname(tmp), "fuera-nimbo.png"));
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(await gitInfo(os.tmpdir()), null); // una carpeta que no es repo: null (sin colgarse)
  console.log("village.js ok");
})();

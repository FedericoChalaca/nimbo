// La aldea de Nimbo: una ventana aparte donde cada carpeta con chats de Claude Code es una casita y cada chat, un aldeano
// que camina, trabaja frente a su casa y conversa con los demás (src/renderer/village.*). Aquí está lo del proceso
// principal: qué casas y aldeanos hay, el estado de git y las fotos de cada proyecto, y la ventana.
//
// Reglas: la página nunca manda rutas, solo el id de una casa y el número de una foto; las fotos se buscan y se leen
// aquí, solo dentro de la carpeta de esa casa y solo imágenes de hasta 4 MB. Nada sale del PC.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MAX_HOUSES = 12; // los lotes que tiene el mapa
const MAX_CHATS = 4; // aldeanos por casa (los chats más recientes)
const PHOTO_EXT = /\.(png|jpe?g|webp|gif)$/i;
const PHOTO_MAX = 4 * 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".vercel", ".cache", "coverage", "target", ".gradle", "Pods", "venv", ".venv", "__pycache__", ".expo", "android", "ios", ".dart_tool", "obj", "bin"]);
// Qué imágenes parecen "fotos del proyecto": capturas, portadas, previews… antes que íconos sueltos.
const GOOD_NAME = /screenshot|captura|pantall|preview|portada|cover|hero|og[-_]?image|opengraph|mockup|demo|banner|social|thumbnail|landing|home/i;
const GOOD_DIR = /screenshots?|capturas?|docs|media|public|promo|marketing|assets|images?|img/i;
const BAD_NAME = /favicon|icon|logo-?\d|sprite|apple-touch|android-chrome|mstile|placeholder|\bbg\b|pattern/i;

const houseId = (cwd) => require("crypto").createHash("sha1").update(cwd.toLowerCase()).digest("hex").slice(0, 10);

/** Chats (de listSessions) → casas ordenadas por actividad, con hasta MAX_CHATS aldeanos cada una. */
// Corridas automáticas que no son conversaciones tuyas (p. ej. las revisiones de seguridad de un plugin): no son aldeanos.
const AUTOMATED = /^(review this change for security vulnerabilities|you are a (security|code) reviewer)/i;
function groupHouses(sessions) {
  const byCwd = new Map();
  for (const s of sessions) {
    if (!s?.cwd || AUTOMATED.test(String(s.lastPrompt ?? "")) || AUTOMATED.test(String(s.title ?? ""))) continue;
    const key = path.resolve(s.cwd).toLowerCase();
    if (!byCwd.has(key)) byCwd.set(key, { id: houseId(path.resolve(s.cwd)), name: path.basename(s.cwd) || s.cwd, cwd: path.resolve(s.cwd), chats: [] });
    byCwd.get(key).chats.push({ id: s.id, title: String(s.title || s.lastPrompt || s.project || "Claude").slice(0, 60), lastPrompt: String(s.lastPrompt ?? "").slice(0, 140), at: s.at ?? 0, active: !!s.active });
  }
  const houses = [...byCwd.values()];
  for (const h of houses) { h.chats.sort((a, b) => b.at - a.at); h.chats = h.chats.slice(0, MAX_CHATS); h.at = h.chats[0]?.at ?? 0; }
  return houses.sort((a, b) => b.at - a.at).slice(0, MAX_HOUSES);
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
 * @param listSessions async () => chats (orchestrator.listSessions)
 * @param page         () => dirección de village.html
 * @param preload      ruta de village-preload.js
 * @param name         () => cómo se llama el dueño (para su personaje)
 */
function createVillage({ listSessions, page, preload, name }) {
  const { BrowserWindow, ipcMain, shell } = require("electron"); // aquí: así la autoprueba corre sin Electron
  let win = null;
  let houses = []; // la última lista que se le dio a la página (las fotos y los botones usan su id)
  const photoCache = new Map(); // cwd → { at, list }

  async function data() {
    houses = groupHouses(await listSessions());
    const withGit = await Promise.all(houses.map(async (h) => ({ ...h, git: await gitInfo(h.cwd), cwd: undefined, folder: h.cwd })));
    return { houses: withGit, name: name() };
  }
  const house = (id) => houses.find((h) => h.id === id);
  const fromVillage = (e) => win && e.sender === win.webContents;

  ipcMain.handle("village-data", (e) => (fromVillage(e) ? data() : null));
  ipcMain.handle("village-photos", async (e, id) => {
    const h = fromVillage(e) && house(id);
    if (!h) return [];
    const hit = photoCache.get(h.cwd);
    if (!hit || Date.now() - hit.at > 10 * 60_000) photoCache.set(h.cwd, { at: Date.now(), list: await findPhotos(h.cwd) });
    return photoCache.get(h.cwd).list.map((rel) => path.basename(rel)); // solo el nombre, para el pie de foto
  });
  ipcMain.handle("village-photo", async (e, id, i) => {
    const h = fromVillage(e) && house(id);
    const rel = h && photoCache.get(h.cwd)?.list[Number(i)];
    return rel ? readPhoto(h.cwd, rel) : null;
  });
  ipcMain.on("village-open", (e, id, what) => {
    const h = fromVillage(e) && house(id);
    if (!h) return;
    if (what === "folder") shell.openPath(h.cwd);
    if (what === "github") gitInfo(h.cwd).then((g) => { if (g?.github?.startsWith("https://github.com/")) shell.openExternal(g.github); });
  });

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
    const detail = input.description ?? (input.command && String(input.command).split(/\s+/)[0]) ?? (input.file_path && path.basename(String(input.file_path))) ?? input.pattern ?? input.query ?? input.description ?? "";
    win.webContents.send("village-hook", {
      session: String(p.session_id ?? ""), event: String(p.hook_event_name ?? ""), title: String(p.title ?? "").slice(0, 60),
      tool: String(p.tool_name ?? ""), detail: String(detail).slice(0, 60), prompt: String(p.prompt ?? "").replace(/\s+/g, " ").slice(0, 70),
      message: String(p.message ?? "").slice(0, 80), context: p.context ?? null,
    });
  }

  return { open, hook, isOpen: () => !!win };
}

module.exports = { createVillage, groupHouses, photoScore, findPhotos, readPhoto, gitInfo };

// Autoprueba (sin Electron): node src/main/village.js
if (require.main === module) (async () => {
  const assert = require("assert");
  const os = require("os");
  // Casas: agrupadas por carpeta (sin importar mayúsculas), la más activa primero, máximo 4 aldeanos.
  const s = (id, cwd, at, title = "") => ({ id, cwd, at, title, project: path.basename(cwd), lastPrompt: "hola" });
  const hs = groupHouses([s("a", "C:\\p\\uno", 5), s("b", "c:\\P\\UNO", 9, "segundo"), s("c", "C:\\p\\dos", 7), ...[1, 2, 3, 4, 5].map((i) => s("x" + i, "C:\\p\\dos", i))]);
  assert.deepStrictEqual(hs.map((h) => h.name), ["uno", "dos"]);
  assert.deepStrictEqual(hs[0].chats.map((c) => c.id), ["b", "a"]);
  assert.strictEqual(hs[1].chats.length, 4);
  assert.strictEqual(hs[0].chats[1].title, "hola"); // sin título: el último pedido
  assert.strictEqual(groupHouses([{ id: "z", cwd: "C:\p\tres", lastPrompt: "Review this change for security vulnerabilities. Changed files…" }]).length, 0); // automáticas fuera
  // Fotos: capturas antes que íconos; nada que no sea imagen ni lo que pese de más.
  assert.ok(photoScore("docs/screenshots/home.png", 200_000) > photoScore("src/x.png", 200_000));
  assert.strictEqual(photoScore("public/favicon.png", 50_000), 0);
  assert.strictEqual(photoScore("a.txt", 50_000), 0);
  assert.strictEqual(photoScore("big.png", 9 * 1024 * 1024), 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-aldea-"));
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
  assert.strictEqual(await readPhoto(tmp, path.join("..", path.basename(tmp), "logo.png")), await readPhoto(tmp, "logo.png")); // sigue adentro: vale
  fs.writeFileSync(path.join(path.dirname(tmp), "fuera-nimbo.png"), png);
  assert.strictEqual(await readPhoto(tmp, path.join("..", "fuera-nimbo.png")), null); // fuera de la carpeta: no
  fs.rmSync(path.join(path.dirname(tmp), "fuera-nimbo.png"));
  fs.rmSync(tmp, { recursive: true, force: true });
  // git: una carpeta que no es repo da null (sin colgarse).
  assert.strictEqual(await gitInfo(os.tmpdir()), null);
  console.log("village.js ok");
})();

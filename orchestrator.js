// Orquestador: Nimbo conoce tus chats de Claude Code, decide a cuál le toca cada
// pedido y le redacta un prompt. Nunca envía nada sin que confirmes en la tarjeta.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// El .exe real que hay detrás de claude.cmd. Se llama directo, sin shell: los
// argumentos (que llevan títulos de tus chats) no pueden inyectar comandos.
// Se busca donde lo dejan npm y el instalador nativo; NIMBO_CLAUDE permite indicar otra ruta.
const CLAUDE_EXE = [
  process.env.NIMBO_CLAUDE,
  path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  path.join(os.homedir(), ".local", "bin", "claude.exe"),
].find((p) => p && fs.existsSync(p)) ?? "";
const PROJECTS = path.join(os.homedir(), ".claude", "projects");
// Opcional (prefs.json → "vault"): tu carpeta de notas. El orquestador la puede leer y su
// chat siempre está en la lista. Vacío = sin vault.
let VAULT = "";
// Idioma de las respuestas y de los avisos: lo pasa main.js (prefs.lang o el de Windows).
let LANG = () => "es";
const t = (s, ...a) => require("./i18n").translator(LANG())(s, ...a);
// Así nombra Claude Code la carpeta de transcripciones de un cwd (D:\notas → D--notas).
const projectDirName = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const ACTIVE_MS = 2 * 60_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Ejecuta `claude` y devuelve la línea final "result" de su salida. */
function runClaude(args, { cwd, input, env }) {
  return new Promise((resolve) => {
    if (!CLAUDE_EXE) return resolve({ error: t("No encontré claude.exe. Instala Claude Code o define NIMBO_CLAUDE con su ruta.") });
    const child = spawn(CLAUDE_EXE, args, { cwd, windowsHide: true, env: env ? { ...process.env, ...env } : process.env });
    let out = "";
    let err = "";
    const killer = setTimeout(() => child.kill(), 10 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ error: e.message }));
    child.on("close", () => {
      clearTimeout(killer);
      const result = out
        .split("\n")
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .findLast((o) => o?.type === "result");
      resolve(result ?? { error: (err || t("No pude hablar con Claude.")).trim().slice(0, 600) });
    });
    child.stdin.end(input);
  });
}

const lastMatch = (text, re) => {
  let m, found = null;
  while ((m = re.exec(text))) found = m[1];
  return found && JSON.parse(`"${found}"`);
};
const STR = '"((?:[^"\\\\]|\\\\.)*)"';

/**
 * Carpetas fuera del cwd donde el chat ha editado o leído archivos varias veces
 * (p. ej. un chat abierto en D:\varios que en realidad trabaja en D:\proyectos\web).
 * Al reanudarlo se le dan con --add-dir. Nunca carpetas del sistema ni tu carpeta de usuario.
 */
function workDirs(text, cwd) {
  const home = os.homedir().toLowerCase();
  const counts = new Map();
  const re = new RegExp(`"file_path":${STR}`, "g");
  let m;
  while ((m = re.exec(text))) {
    const file = path.resolve(JSON.parse(`"${m[1]}"`));
    if (file.toLowerCase().startsWith(cwd.toLowerCase() + path.sep)) continue;
    // Raíz del proyecto = unidad + dos carpetas (D:\proyectos\web).
    const root = file.split(path.sep).slice(0, 3).join(path.sep);
    if (/^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/i.test(root)) continue;
    if (root.toLowerCase() === home || root.toLowerCase().startsWith(home + path.sep)) continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return [...counts]
    .filter(([dir, n]) => n >= 3 && fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dir]) => dir);
}

/**
 * Título de un chat a partir de su transcripción (el que se ve en la barra lateral de la
 * app). Solo lee archivos dentro de ~/.claude/projects. Caché de 1 min por archivo: los
 * hooks llegan muchas veces por segundo y las transcripciones pesan varios MB.
 */
const titleCache = new Map(); // archivo → { title, at }
function sessionTitle(transcriptPath) {
  if (typeof transcriptPath !== "string") return "";
  const file = path.resolve(transcriptPath);
  if (!file.toLowerCase().startsWith(PROJECTS.toLowerCase() + path.sep) || !file.endsWith(".jsonl")) return "";
  const hit = titleCache.get(file);
  if (hit && Date.now() - hit.at < 60_000) return hit.title;
  let title = "";
  try {
    const text = fs.readFileSync(file, "utf8");
    title = lastMatch(text, new RegExp(`"customTitle":${STR}`, "g")) ?? lastMatch(text, new RegExp(`"agentName":${STR}`, "g")) ?? "";
  } catch {}
  titleCache.set(file, { title, at: Date.now() });
  return title;
}

/** Tus chats más recientes que tienen carpeta de proyecto. */
function listSessions(excludeCwd) {
  const files = [];
  for (const dir of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(PROJECTS, dir.name))) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(PROJECTS, dir.name, f);
      files.push({ full, dir: dir.name, mtime: fs.statSync(full).mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  // El chat más reciente del vault entra siempre, aunque no esté entre los más nuevos.
  const vaultFile = VAULT ? files.find((f) => f.dir === projectDirName(VAULT)) : null;
  const candidates = [vaultFile, ...files.slice(0, 30).filter((f) => f !== vaultFile)].filter(Boolean);

  const sessions = [];
  for (const { full, mtime } of candidates) {
    const text = fs.readFileSync(full, "utf8");
    const cwdMatch = text.match(new RegExp(`"cwd":${STR}`));
    const cwd = cwdMatch && JSON.parse(`"${cwdMatch[1]}"`);
    // Fuera: chats "sin carpeta" de la app (scratch-workspaces) y corridas sueltas de
    // `claude -p` (entrypoint sdk-cli), que no son conversaciones tuyas.
    if (!cwd || cwd === excludeCwd || cwd.includes("scratch-workspaces") || !fs.existsSync(cwd)) continue;
    if (text.match(new RegExp(`"entrypoint":${STR}`))?.[1] === "sdk-cli") continue;
    sessions.push({
      id: path.basename(full, ".jsonl"),
      cwd,
      dirs: workDirs(text, cwd),
      project: path.basename(cwd),
      title: lastMatch(text, new RegExp(`"customTitle":${STR}`, "g")) ?? lastMatch(text, new RegExp(`"agentName":${STR}`, "g")) ?? "",
      lastPrompt: (lastMatch(text, new RegExp(`"lastPrompt":${STR}`, "g")) ?? "").slice(0, 140),
      active: Date.now() - mtime < ACTIVE_MS,
    });
    if (sessions.length === 16) break; // el del vault + los 15 más nuevos
  }
  return sessions;
}

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reply: { type: "string" },
    dispatch: {
      type: "array",
      items: {
        type: "object",
        properties: { session: { type: "string" }, prompt: { type: "string" } },
        required: ["session", "prompt"],
      },
    },
    // Recordatorios: due en ISO 8601 con zona, o vacío si no tiene fecha.
    reminders: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, due: { type: "string" } }, required: ["text"] },
    },
    complete: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "dispatch"],
});

function systemPrompt(sessions, pending = []) {
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const tz = `${off >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const nowText = now.toLocaleString("es-CO", { dateStyle: "full", timeStyle: "short" });
  const todo = pending.map((r) => `- id: ${r.id} | ${r.text} | ${r.due ? new Date(r.due).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : t("sin fecha")}`).join("\n");
  const list = sessions
    .map((s) => `- id: ${s.id} | proyecto: ${s.project} | carpeta: ${s.cwd}${s.dirs.length ? ` | también trabaja en: ${s.dirs.join(", ")}` : ""} | título: ${s.title || "(sin título)"} | último pedido: ${s.lastPrompt || "-"}`)
    .join("\n");
  return `Eres Nimbo, el orquestador personal del usuario. Respondes en ${LANG() === "en" ? "inglés" : "español"}, salvo que el usuario te escriba en otro idioma. Tus respuestas en "reply" son de máximo 2 frases cortas, sin listas largas ni código. Excepción: si el mensaje trae una captura de la pantalla del usuario y te pide ayuda con lo que se ve, mira la imagen y responde con lo que necesita; si hay que explicar un procedimiento, hasta 5 pasos cortos numerados, nombrando los botones o textos tal como aparecen en la captura.

Ahora es ${nowText} (zona UTC${tz}).

RECORDATORIOS Y PENDIENTES: si el usuario te pide que le recuerdes algo o anota un pendiente, agrégalo en "reminders" con "text" corto (cómo se lo dirías al avisarle) y "due" en ISO 8601 con zona (por ejemplo 2026-10-03T09:00:00${tz}); si no dio fecha ni hora, deja "due" vacío. Si no dio hora pero sí día, usa las 9:00. Si dice que ya hizo un pendiente, pon su id en "complete". Confírmalo en "reply" con la fecha en palabras ("te aviso mañana a las 9"). Para "¿qué tengo pendiente?" responde con esta lista. Pendientes actuales:
${todo || "(ninguno)"}

Tu propio código (la app Nimbo) está en ${__dirname}. Si el usuario pide cambios a Nimbo, mándalos al chat cuya carpeta contenga esa ruta.

${VAULT ? `El vault de notas del usuario está en ${VAULT} y tú puedes leerlo (Read, Glob, Grep).
- PREGUNTAS sobre sus proyectos, notas o personas ("¿qué proyectos tengo pausados?"): respóndelas TÚ leyendo el vault (si existe, empieza por su nota de inicio). No las delegues.
- CREAR o CAMBIAR algo (notas, proyectos, personas, el second brain): eso va por "dispatch" al chat de ${VAULT}, que sigue las reglas de su CLAUDE.md. Tú nunca editas.
` : ""}
El usuario tiene estos chats de Claude Code, cada uno trabajando en un proyecto:
${list || "(no hay chats con proyecto)"}

Cuando el usuario pida algo que le corresponde a uno de esos chats (cambios en un proyecto, revisar su código, seguir una tarea), NO lo hagas tú: redacta para ese chat un ENCARGO dirigido al otro Claude. No copies el mensaje del usuario tal cual: interprétalo. Cada encargo lleva estas cuatro partes, con estos títulos, en este orden, en texto plano y breve:
Objetivo: qué tiene que quedar hecho, en una o dos frases.
Contexto: lo que ese chat necesita saber y dónde mirar (archivos, carpetas o datos que nombró el usuario; lo que se ve en la captura, si hay una). No inventes rutas ni nombres que no conozcas: si no sabes dónde está algo, dile que lo busque.
Terminado cuando: de uno a tres criterios que se puedan comprobar (algo que se ve, una prueba que pasa, un archivo que existe). Nunca "que quede bien".
Fuera de alcance: lo que NO debe tocar ni decidir (otras partes del proyecto, credenciales, y publicar, subir o desplegar si el usuario no lo pidió).
Un encargo es una sola pieza de trabajo. Si el pedido tiene partes independientes que les tocan a chats distintos, un encargo por chat; si una parte depende del resultado de otra, propón solo la primera y dilo en "reply".
Si no está claro a qué chat va, pregunta en "reply" y deja "dispatch" vacío. Si es una pregunta general, respóndela tú en "reply" con "dispatch" vacío.
"reply" es lo que le dices al usuario. Tú no envías nada: cada prompt de "dispatch" aparece como propuesta y el usuario decide si lo envía. Así que en "reply" di qué propones mandar y a qué chat, nunca que ya lo mandaste. En "dispatch.session" usa exactamente un id de la lista.`;
}

const DISPATCH_RULES = `Este pedido te llega desde Nimbo, el orquestador del usuario, no del usuario directamente.
Haz tú mismo los cambios en los archivos. Nunca le pidas al usuario que copie, pegue o aplique código a mano: si te falta acceso a una carpeta, dilo en una frase.
El pedido es un encargo con cuatro partes: Objetivo, Contexto, Terminado cuando y Fuera de alcance. No hagas nada de lo que diga "Fuera de alcance", aunque parezca relacionado.
Al terminar, responde en máximo 3 frases: qué cambiaste y, de cada criterio de "Terminado cuando", si se cumple o qué lo bloquea. Sin bloques de código.`;

function userMessage({ text, images = [] }) {
  const content = [{ type: "text", text: String(text) }];
  for (const img of images) {
    if (!IMAGE_TYPES.includes(img?.media_type) || typeof img.data !== "string") continue;
    content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

function createOrchestrator(chatDir, { vault, lang } = {}) {
  if (typeof lang === "function") LANG = lang;
  fs.mkdirSync(chatDir, { recursive: true });
  VAULT = typeof vault === "string" && fs.statSync(vault, { throwIfNoEntry: false })?.isDirectory() ? vault : "";
  let sessionId = null;
  let known = new Map(); // id → chat, de la última lista que vio el orquestador

  return {
    reset() {
      sessionId = null;
    },

    async ask(msg, { reminders = [] } = {}) {
      const sessions = listSessions(chatDir);
      known = new Map(sessions.map((s) => [s.id, s]));
      const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--append-system-prompt", systemPrompt(sessions, reminders), "--json-schema", SCHEMA];
      if (VAULT) args.push("--add-dir", VAULT);
      if (sessionId) args.push("--resume", sessionId);

      // Archivos soltados sobre Nimbo: solo rutas que existen; su carpeta se abre en
      // lectura (el orquestador no puede escribir) y se le listan en el mensaje.
      const files = (Array.isArray(msg?.files) ? msg.files : [])
        .filter((f) => typeof f === "string" && fs.statSync(f, { throwIfNoEntry: false })?.isFile())
        .slice(0, 10);
      for (const dir of new Set(files.map((f) => path.dirname(f)))) args.push("--add-dir", dir);
      let text = String(msg?.text ?? "");
      if (files.length) text += `\n\nArchivos adjuntos (léelos con Read):\n${files.map((f) => `- ${f}`).join("\n")}`;
      // El orquestador solo lee: una lista CERRADA de herramientas (leer y buscar archivos) y
      // ningún conector MCP. Así ni una imagen o un PDF con instrucciones escondidas puede
      // hacerle escribir, ejecutar, navegar ni usar tus conectores; los cambios van por "dispatch".
      args.push("--tools", "Read,Glob,Grep", "--strict-mcp-config");
      const r = await runClaude(args, { cwd: chatDir, input: userMessage({ text, images: msg?.images }) });
      if (r.error) return { text: r.error, dispatch: [] };
      if (/^[0-9a-f-]{36}$/i.test(r.session_id ?? "")) sessionId = r.session_id;

      let plan = r.structured_output;
      if (!plan) { try { plan = JSON.parse(r.result); } catch { plan = { reply: r.result, dispatch: [] }; } }
      // Solo se proponen chats que de verdad están en la lista.
      const dispatch = (plan.dispatch ?? [])
        .filter((d) => known.has(d.session) && typeof d.prompt === "string" && d.prompt.trim())
        .map((d) => {
          const s = known.get(d.session);
          return { session: s.id, prompt: d.prompt, project: s.project, title: s.title, active: s.active };
        });
      const pendingIds = new Set(reminders.map((x) => x.id));
      return {
        text: plan.reply || r.result || t("(sin respuesta)"),
        dispatch,
        reminders: Array.isArray(plan.reminders) ? plan.reminders.slice(0, 10) : [],
        complete: (Array.isArray(plan.complete) ? plan.complete : []).filter((id) => pendingIds.has(id)),
      };
    },

    // Manda el prompt al chat elegido, en su carpeta y con acceso a las carpetas
    // donde de verdad trabaja. Modo "auto": edita y ejecuta lo que el clasificador
    // de Claude Code considera seguro; lo riesgoso lo sigue bloqueando.
    async dispatch(id, prompt) {
      const s = known.get(id);
      if (!s) return { text: t("Ese chat ya no está en la lista.") };
      const args = ["-p", "--resume", s.id, "--permission-mode", "auto", "--output-format", "json",
        "--append-system-prompt", DISPATCH_RULES];
      for (const dir of s.dirs) args.push("--add-dir", dir);
      const r = await runClaude(args, { cwd: s.cwd, input: String(prompt) });
      return { text: r.error ?? (r.result || t("(sin respuesta)")), project: s.project };
    },
  };
}

module.exports = { createOrchestrator, listSessions, sessionTitle, runClaude, claudeFound: () => CLAUDE_EXE !== "" };

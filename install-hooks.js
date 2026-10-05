// Agrega o quita los hooks de Nimbo en ~/.claude/settings.json.
// Siempre hace un backup con fecha antes de escribir y no toca hooks ajenos.
// - Terminal: `npm run install-hooks` / `npm run uninstall-hooks`.
// - Desde la app: main.js usa install(), uninstall() y status() (panel "Conexiones").
const fs = require("fs");
const os = require("os");
const path = require("path");

const EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "PermissionRequest",
];
// PermissionRequest espera a que decidas (60 s en Nimbo + margen).
const TIMEOUTS = { PermissionRequest: 75 };
const hookPath = path.join(__dirname, "hook.js").replace(/\\/g, "/");
// Con Node instalado. La app instalada pasa otro comando (un .cmd que usa su propio ejecutable).
const NODE_COMMAND = `node "${hookPath}"`;
const settingsPath = path.join(os.homedir(), ".claude", "settings.json");

// Nuestros = los que apuntan a ESTE hook.js (la carpeta puede llamarse nimbo-main u otra cosa),
// al hook.cmd de la app instalada, o a una instalación vieja en una carpeta "nimbo".
const isOurs = (group) => (group.hooks ?? []).some((h) => {
  const c = String(h.command ?? "").replace(/\\/g, "/");
  return c.includes(hookPath) || /nimbo\/hook\.(js|cmd)/i.test(c);
});

function read() {
  const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : "{}";
  return JSON.parse(raw.replace(/^﻿/, "")); // si el JSON está roto, falla aquí y no se escribe nada
}

/** "on" = los 10 eventos apuntan a `command` · "stale" = hay hooks de Nimbo con otra ruta o incompletos · "off". */
function status(command = NODE_COMMAND) {
  const hooks = read().hooks ?? {};
  const ours = EVENTS.map((ev) => (hooks[ev] ?? []).filter(isOurs).flatMap((g) => g.hooks.map((h) => h.command)));
  if (ours.every((list) => !list.length)) return "off";
  return ours.every((list) => list.length === 1 && list[0] === command) ? "on" : "stale";
}

function apply(uninstall, command = NODE_COMMAND) {
  const settings = read();
  settings.hooks ??= {};
  for (const event of EVENTS) {
    const groups = (settings.hooks[event] ?? []).filter((g) => !isOurs(g));
    if (!uninstall) groups.push({ hooks: [{ type: "command", command, timeout: TIMEOUTS[event] ?? 5 }] });
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;

  let backup = null;
  if (fs.existsSync(settingsPath)) {
    backup = `${settingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(settingsPath, backup);
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  // Se escribe a un temporal y se renombra: si algo falla a medias, settings.json queda intacto.
  fs.writeFileSync(settingsPath + ".tmp", JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(settingsPath + ".tmp", settingsPath);
  return backup;
}

module.exports = { status, install: (command) => apply(false, command), uninstall: () => apply(true), EVENTS };

if (require.main === module) {
  const uninstall = process.argv.includes("--uninstall");
  const backup = apply(uninstall);
  if (backup) console.log(`Backup: ${backup}`);
  console.log(uninstall ? "Hooks de Nimbo quitados." : `Hooks de Nimbo instalados (${EVENTS.length} eventos).`);
}

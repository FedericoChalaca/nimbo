// Lo que cambia según el sistema (Windows, macOS, Linux). Sin Electron: hook.js también lo usa y corre solo con Node.
const fs = require("fs");
const os = require("os");
const path = require("path");

/** La carpeta de datos de Nimbo: la MISMA que `app.getPath("userData")` de Electron para la app "nimbo". */
function userDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "nimbo");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "nimbo");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "nimbo");
}

/** El primer archivo ejecutable que exista con alguno de esos nombres en el PATH (o en carpetas extra). */
function findInPath(names, { env = process.env, extra = [] } = {}) {
  const dirs = [...String(env.PATH ?? env.Path ?? "").split(path.delimiter), ...extra].filter(Boolean);
  for (const dir of dirs) for (const name of names) {
    const file = path.join(dir, name);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return "";
}

/**
 * Las apps gráficas de macOS y Linux arrancan con un PATH mínimo (sin Homebrew, ni ~/.local/bin, ni donde npm
 * deja `claude`, `gh`, `ollama`, `playerctl`): se le agregan esas carpetas para encontrarlos como en una terminal.
 */
function extraBinDirs(home = os.homedir()) {
  return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".claude", "local")];
}

/** Dónde buscar `claude`: lo que defina NIMBO_CLAUDE, los sitios habituales de cada sistema y el PATH. */
function claudeCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const common = [env.NIMBO_CLAUDE];
  if (platform === "win32") {
    return [...common, path.join(env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"), path.join(home, ".local", "bin", "claude.exe")];
  }
  return [...common, ...extraBinDirs(home).map((d) => path.join(d, "claude")), path.join(home, ".claude", "local", "claude")];
}

/** El .exe de Ollama (Windows) o la app/ejecutable de cada sistema: { installed, open } donde open() lo enciende. */
function ollamaLocations({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") return { kind: "file", path: path.join(env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama app.exe") };
  if (platform === "darwin") return { kind: "app", path: "/Applications/Ollama.app" };
  return { kind: "cli", path: findInPath(["ollama"], { env, extra: extraBinDirs(home) }) };
}

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
module.exports = { userDataDir, findInPath, extraBinDirs, claudeCandidates, ollamaLocations, isWin, isMac };

// Autoprueba: `node src/main/platform.js`
if (require.main === module) {
  const assert = require("assert");
  const h = "/home/ana";
  assert.strictEqual(userDataDir({ platform: "win32", env: { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, home: "C:\\Users\\ana" }), path.join("C:\\Users\\ana\\AppData\\Roaming", "nimbo"));
  assert.strictEqual(userDataDir({ platform: "darwin", env: {}, home: h }), path.join(h, "Library", "Application Support", "nimbo"));
  assert.strictEqual(userDataDir({ platform: "linux", env: {}, home: h }), path.join(h, ".config", "nimbo"));
  assert.strictEqual(userDataDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/x/cfg" }, home: h }), path.join("/x/cfg", "nimbo"));
  assert.strictEqual(userDataDir({ platform: "win32", env: {}, home: "C:\\Users\\ana" }), path.join("C:\\Users\\ana", "AppData", "Roaming", "nimbo")); // sin APPDATA
  const c = claudeCandidates({ platform: "darwin", env: { NIMBO_CLAUDE: "/mi/claude" }, home: h });
  assert.deepStrictEqual([c[0], c.includes(path.join("/opt/homebrew/bin", "claude")), c.includes(path.join(h, ".local", "bin", "claude"))], ["/mi/claude", true, true]);
  assert.ok(claudeCandidates({ platform: "win32", env: { APPDATA: "A" }, home: "H" }).some((p) => String(p).endsWith("claude.exe")));
  assert.ok(!claudeCandidates({ platform: "linux", env: {}, home: h }).some((p) => String(p).endsWith(".exe")));
  assert.deepStrictEqual([ollamaLocations({ platform: "darwin" }).path, ollamaLocations({ platform: "win32", env: { LOCALAPPDATA: "L" } }).path.endsWith("ollama app.exe"), ollamaLocations({ platform: "linux", env: { PATH: "" }, home: "/nada" }).kind], ["/Applications/Ollama.app", true, "cli"]);
  // findInPath: encuentra el archivo en una carpeta del PATH y no confunde carpetas con archivos.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-plat-"));
  fs.writeFileSync(path.join(tmp, "herramienta"), "x");
  fs.mkdirSync(path.join(tmp, "carpeta"));
  assert.strictEqual(findInPath(["herramienta"], { env: { PATH: tmp } }), path.join(tmp, "herramienta"));
  assert.strictEqual(findInPath(["carpeta"], { env: { PATH: tmp } }), "");
  assert.strictEqual(findInPath(["herramienta"], { env: { PATH: "/no/existe" }, extra: [tmp] }), path.join(tmp, "herramienta"));
  assert.strictEqual(findInPath(["nada"], { env: { PATH: tmp } }), "");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("platform.js ok");
}

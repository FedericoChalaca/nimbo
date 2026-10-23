// "Silencio si estoy mirando": saber qué programa tiene el foco para no hacer ruido cuando un trabajo termina y ya estás frente a la terminal o al chat
// de Claude (idea de Coucou, "quiet when you're watching", MIT). Solo se consulta cuando termina un trabajo; nunca se guarda ni se envía el resultado.
// Sin Electron, para poder probarlo (`node src/main/foreground.js`).
const { execFile } = require("child_process");

// Programas donde se trabaja con Claude Code (nombre del proceso, en minúsculas y sin .exe).
const WATCHING = new Set([
  "windowsterminal", "wt", "cmd", "powershell", "pwsh", "conhost", "openconsole", "mintty", "wsl", "ubuntu", "alacritty", "wezterm-gui", "kitty", "hyper", "tabby", "warp",
  "code", "cursor", "windsurf", "devenv", "idea64", "pycharm64", "webstorm64", "rider64", "studio64",
  "claude", // la app de escritorio de Claude (pestaña Code y chats)
  "terminal", "iterm2", "gnome-terminal", "konsole", "xterm", "xfce4-terminal", "tilix",
]);

const norm = (n) => String(n ?? "").trim().toLowerCase().replace(/\.exe$/, "");
/** ¿el programa que tiene el foco es uno donde estás viendo trabajar a Claude? Nimbo mismo no cuenta. */
const isWatching = (name) => WATCHING.has(norm(name));

const WIN_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class NimboFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }
"@
$p = 0; [void][NimboFg]::GetWindowThreadProcessId([NimboFg]::GetForegroundWindow(), [ref]$p)
if ($p -gt 0) { (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName }`;

/** El nombre del programa con el foco, o null si no se puede saber (sin escritorio, sin la herramienta, error o 8 s sin respuesta). */
function foreground(platform = process.platform) {
  return new Promise((resolve) => {
    let file, args;
    if (platform === "win32") {
      // Ruta completa a PowerShell (nunca uno que alguien haya dejado en la carpeta actual) y el script en -EncodedCommand.
      file = require("path").join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WIN_SCRIPT, "utf16le").toString("base64")];
    } else if (platform === "darwin") {
      file = "osascript";
      args = ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'];
    } else {
      file = "xdotool";
      args = ["getactivewindow", "getwindowclassname"];
    }
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? null : String(out).trim().split(/\r?\n/)[0] || null));
  });
}

module.exports = { isWatching, foreground, WATCHING };

// Autoprueba: `node src/main/foreground.js`
if (require.main === module) (async () => {
  const assert = require("assert");
  for (const yes of ["WindowsTerminal.exe", "pwsh", "Code.exe", "Cursor", "claude.exe", "iTerm2", "Terminal", "gnome-terminal"]) assert.ok(isWatching(yes), yes);
  for (const no of ["chrome.exe", "brave", "Nimbo.exe", "electron.exe", "Spotify.exe", "explorer", "", null, undefined, "WhatsApp.exe"]) assert.ok(!isWatching(no), String(no));
  // La consulta real: devuelve un nombre o null (en un servidor sin escritorio), nunca se cuelga ni lanza.
  const t = Date.now();
  const name = await foreground();
  assert.ok(name === null || (typeof name === "string" && name.length > 0), String(name));
  assert.ok(Date.now() - t < 9000);
  assert.strictEqual(await foreground("freebsd"), null); // sin xdotool o sin escritorio: null
  console.log("foreground.js ok" + (name ? ` (ahora tiene el foco: ${name})` : " (sin saber quién tiene el foco)"));
})();

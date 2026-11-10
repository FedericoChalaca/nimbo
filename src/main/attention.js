// Ventanas que piden atención (el botón que Windows pone a parpadear en naranja en su barra, que con Nimbo está escondida). En la barra de
// Nimbo se pintan en naranja siempre; además, ESTE archivo decide cuándo vale la pena avisar con la isla y una notificación:
//   · de seguridad (Control de cuentas, «Seguridad de Windows», iniciar sesión, un permiso): casi de una (1,5 s, por si ya la estabas mirando);
//   · cualquier otra: si a los 2 min sigue esperando y no la has mirado;
//   · programas de chat (WhatsApp, Discord, Telegram…): nunca, ya avisan solos y parpadean con cada mensaje.
// Dueño, 2026-11-09: un permiso de seguridad esperó largo rato detrás de otra ventana y, sin la barra de Windows, no lo vio.
const SECURITY_EXE = /\\(consent|CredentialUIBroker|SecurityHealthHost|UserAccountBroker|Microsoft\.AAD\.BrokerPlugin)\.exe$/i;
const SECURITY_TITLE = /seguridad de windows|windows security|control de cuentas|user account control|iniciar sesi[oó]n|inicio de sesi[oó]n|sign[ -]?in|permis|permission|autoriza|authoriz|verifica|verify|contraseña|password|passkey|clave de acceso/i;
// ponytail: lista fija de chats; si otro programa avisa de más, se agrega aquí (o un ajuste en Opciones si llegan a ser muchos)
const CHATTY = /\\(whatsapp|discord|telegram|slack|ms-teams|teams|signal|messenger|zoom)[^\\]*\.exe$/i;

const isSecurity = (path, title) => SECURITY_EXE.test(String(path ?? "")) || SECURITY_TITLE.test(String(title ?? ""));

/**
 * @param tell (app, window, security) => void — avisar ahora (la ventana sigue pidiendo atención)
 */
function createAttention({ tell, later = setTimeout, cancel = clearTimeout, waitOther = 120_000, waitSecurity = 1500 }) {
  const pending = new Map(); // id de ventana → temporizador (o null: un chat, solo naranja)
  return {
    /** Cada lista nueva de programas (windows.js → groupApps). */
    update(apps) {
      const now = new Set();
      for (const a of apps ?? []) for (const w of a.windows ?? []) {
        if (!w.attn) continue;
        now.add(w.h);
        if (pending.has(w.h)) continue;
        const security = isSecurity(a.path, w.title);
        if (!security && CHATTY.test(String(a.path ?? ""))) { pending.set(w.h, null); continue; }
        pending.set(w.h, later(() => tell(a, w, security), security ? waitSecurity : waitOther));
      }
      // La miraste o se cerró: no se avisa
      for (const [h, timer] of pending) if (!now.has(h)) { if (timer) cancel(timer); pending.delete(h); }
    },
  };
}

module.exports = { createAttention, isSecurity };

// Autoprueba: `node src/main/attention.js` (con un reloj de mentira)
if (require.main === module) {
  const assert = require("assert");
  let timers = [];
  const said = [];
  const at = createAttention({ tell: (a, w, s) => said.push([a.name, s]), later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, cancel: (t) => { timers = timers.filter((x) => x !== t); } });
  const app = (name, path, h, attn, title = "x") => ({ name, path, windows: [{ h, attn, title }] });
  const fire = () => { const t = timers; timers = []; t.forEach((x) => x.fn()); };
  assert.ok(isSecurity("C:\\Windows\\System32\\consent.exe", "") && isSecurity("", "Seguridad de Windows") && isSecurity("brave.exe", "Iniciar sesión: cuentas de Google"));
  assert.ok(!isSecurity("C:\\x\\code.exe", "nimbo - Visual Studio Code"));
  // Un permiso de seguridad: aviso casi de una
  at.update([app("Control de cuentas", "C:\\Windows\\System32\\consent.exe", "1", true)]);
  assert.deepStrictEqual(timers.map((t) => t.ms), [1500]);
  fire();
  assert.deepStrictEqual(said, [["Control de cuentas", true]]);
  // Sigue esperando: no se repite
  at.update([app("Control de cuentas", "C:\\Windows\\System32\\consent.exe", "1", true)]);
  assert.strictEqual(timers.length, 0);
  // Otro programa: a los 2 min; si lo miras antes, nada
  at.update([app("Steam", "C:\\Steam\\steam.exe", "2", true)]);
  assert.deepStrictEqual(timers.map((t) => t.ms), [120_000]);
  at.update([app("Steam", "C:\\Steam\\steam.exe", "2", false)]);
  assert.strictEqual(timers.length, 0);
  // WhatsApp parpadea con cada mensaje: solo naranja, sin aviso
  at.update([app("WhatsApp", "C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.0\\WhatsApp.exe", "3", true)]);
  assert.strictEqual(timers.length, 0);
  // …salvo que sea una ventana de seguridad aunque venga de ahí
  at.update([app("WhatsApp", "C:\\x\\WhatsApp.exe", "4", true, "Verifica tu número")]);
  fire();
  assert.deepStrictEqual(said.at(-1), ["WhatsApp", true]);
  console.log("attention.js ok");
}

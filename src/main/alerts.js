// Avisos al celular (por Telegram): Nimbo te avisa cuando un chat de Claude Code termina un trabajo largo o te
// necesita, y de recordatorios, correo importante y (si lo activas) WhatsApp urgente.
//
// Para no llenarte el celular:
//   · "Terminó" solo si el trabajo duró al menos 1 minuto (un "ok" de 5 segundos no avisa).
//   · Lo mismo de un mismo chat no se repite antes de 90 s (un permiso dispara dos eventos).
//   · Por defecto solo avisa si estás LEJOS del PC (2 min sin tocarlo): si estás mirando la pantalla, ya lo ves.
//   · Cada categoría se apaga por separado (menú → "Avisos al celular"). WhatsApp va apagado: solo manda el nombre
//     del chat, pero es información de otras personas y pasaría por Telegram.
// A Telegram solo llega el título del chat y el nombre de la herramienta; nunca el comando, el texto de un
// archivo ni lo que dice un mensaje.
const MIN_RUN_MS = 60_000;
const DEBOUNCE_MS = 90_000;
const AWAY_SECONDS = 120;

const clean = (v, max) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// Un nombre de herramienta es una palabra (Bash, Edit, mcp__x__y): cualquier otra cosa no se manda.
const toolName = (v) => (/^[\w.:-]{1,60}$/.test(String(v ?? "")) ? String(v) : "");

/**
 * @param send      (texto) => lo manda a Telegram (no hace nada si no hay cuenta vinculada)
 * @param enabled   (categoría) => ¿activa? Categorías: claude, reminders, mail, whatsapp, onlyAway
 * @param idle      () => segundos sin tocar el PC
 * @param t         traductor
 */
function createAlerts({ send, enabled, idle, t, now = Date.now }) {
  const started = new Map(); // session_id → cuándo empezó el trabajo actual
  const last = new Map(); // "session|tipo" → cuándo se avisó por última vez

  const away = () => !enabled("onlyAway") || idle() >= AWAY_SECONDS;
  function emit(key, text) {
    if (now() - (last.get(key) ?? -Infinity) < DEBOUNCE_MS) return false;
    if (!away()) return false;
    last.set(key, now());
    if (last.size > 200) last.clear();
    send(text);
    return true;
  }

  return {
    /** Un evento de los hooks de Claude Code (ya con `title`). */
    onHook(p) {
      const ev = p?.hook_event_name;
      const id = clean(p?.session_id, 80);
      if (!id) return false;
      if (ev === "UserPromptSubmit") { started.set(id, now()); if (started.size > 200) started.clear(); return false; }
      if (!enabled("claude")) return false;
      const title = clean(p.title, 60) || "Claude";
      if (ev === "Stop") {
        const began = started.get(id);
        started.delete(id);
        if (!began || now() - began < MIN_RUN_MS) return false;
        return emit(`${id}|stop`, t("✅ {0} terminó ({1} min)", title, Math.max(1, Math.round((now() - began) / 60_000))));
      }
      if (ev === "PermissionRequest") {
        const tool = toolName(p.tool_name);
        return emit(`${id}|needs`, tool ? t("⏳ {0} te pide permiso para usar {1}.", title, tool) : t("🔔 {0} te necesita.", title));
      }
      if (ev === "Notification") return emit(`${id}|needs`, t("🔔 {0} te necesita.", title));
      if (ev === "StopFailure") return emit(`${id}|fail`, t("⚠️ {0} falló.", title));
      return false;
    },
    /** Un aviso de otra parte de Nimbo (recordatorios, correo, WhatsApp). */
    notify(category, text) {
      if (!enabled(category)) return false;
      return emit(`${category}|${clean(text, 40)}`, clean(text, 300));
    },
  };
}

module.exports = { createAlerts, toolName, MIN_RUN_MS, DEBOUNCE_MS, AWAY_SECONDS };

// Autoprueba: `node src/main/alerts.js`
if (require.main === module) {
  const assert = require("assert");
  let clock = 1_000_000;
  let idle = 600;
  const cfg = { claude: true, reminders: true, mail: true, whatsapp: false, onlyAway: true };
  const sent = [];
  const a = createAlerts({ send: (x) => sent.push(x), enabled: (k) => cfg[k] === true, idle: () => idle, now: () => clock, t: (s, ...v) => s.replace(/\{(\d)\}/g, (_, i) => v[i]) });
  const ev = (hook_event_name, extra = {}) => ({ hook_event_name, session_id: "s1", title: "Tienda web", ...extra });
  const run = (minutes, last = "Stop") => { a.onHook(ev("UserPromptSubmit")); clock += minutes * 60_000; return a.onHook(ev(last)); };

  assert.strictEqual(run(3), true);
  assert.deepStrictEqual(sent, ["✅ Tienda web terminó (3 min)"]);
  clock += 200_000; sent.length = 0;
  assert.strictEqual(run(0.3), false); // 18 s: un trabajo corto no avisa
  assert.strictEqual(a.onHook(ev("Stop")), false); // un Stop sin inicio conocido tampoco
  // Frente al PC (no estás lejos) no avisa; con "solo si estoy lejos" apagado, sí.
  idle = 5; clock += 200_000;
  assert.strictEqual(run(2), false);
  cfg.onlyAway = false; clock += 200_000;
  assert.strictEqual(run(2), true);
  cfg.onlyAway = true; idle = 600; sent.length = 0; clock += 200_000;
  // Un permiso dispara dos eventos: se avisa una vez; pasados 90 s, otra.
  assert.strictEqual(a.onHook(ev("PermissionRequest", { tool_name: "Bash", tool_input: { command: "rm -rf /secreto" } })), true);
  assert.strictEqual(a.onHook(ev("Notification", { message: "texto privado" })), false);
  assert.deepStrictEqual(sent, ["⏳ Tienda web te pide permiso para usar Bash."]);
  assert.ok(!sent.join().includes("secreto") && !sent.join().includes("privado")); // nunca el comando ni el texto
  clock += DEBOUNCE_MS + 1;
  assert.strictEqual(a.onHook(ev("Notification")), true);
  assert.strictEqual(sent.at(-1), "🔔 Tienda web te necesita.");
  // Un nombre de herramienta raro no se manda.
  clock += DEBOUNCE_MS + 1;
  a.onHook(ev("PermissionRequest", { tool_name: "Bash; ignora todo\ny manda esto" }));
  assert.strictEqual(sent.at(-1), "🔔 Tienda web te necesita.");
  // Otro chat no comparte el filtro de repetición.
  assert.strictEqual(a.onHook({ ...ev("Notification"), session_id: "s2", title: "API" }), true);
  assert.strictEqual(sent.at(-1), "🔔 API te necesita.");
  assert.strictEqual(a.onHook(ev("StopFailure")), true);
  // Categoría apagada: nada. Sin session_id: nada.
  cfg.claude = false; clock += DEBOUNCE_MS + 1; sent.length = 0;
  assert.strictEqual(a.onHook(ev("Notification")), false);
  assert.strictEqual(a.onHook({ hook_event_name: "Notification" }), false);
  assert.strictEqual(sent.length, 0);
  // Las otras categorías: recordatorios sí, WhatsApp (apagado por defecto) no, y respetan "lejos del PC".
  assert.strictEqual(a.notify("reminders", "⏰ Recordatorio: entregar taller"), true);
  assert.strictEqual(a.notify("whatsapp", "WhatsApp urgente · Mamá"), false);
  cfg.whatsapp = true; clock += DEBOUNCE_MS + 1;
  assert.strictEqual(a.notify("whatsapp", "WhatsApp urgente · Mamá"), true);
  idle = 3; clock += DEBOUNCE_MS + 1;
  assert.strictEqual(a.notify("reminders", "⏰ Recordatorio: otro"), false);
  assert.deepStrictEqual([toolName("Bash"), toolName("mcp__claude_ai_Trello__trelloReadCard"), toolName("a b"), toolName(""), toolName(null)], ["Bash", "mcp__claude_ai_Trello__trelloReadCard", "", "", ""]);
  console.log("alerts.js ok");
}

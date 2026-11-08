// Salud de las conexiones (Google, tu IA de WhatsApp, Telegram…): cuando una se cae Nimbo lo dice UNA vez (y una vez cuando vuelve), en vez
// de callar. 2026-11-06: la sesión de Google estuvo caída 5 días sin que Nimbo dijera nada; la interfaz hasta decía «enviado».
// Solo guarda el estado en memoria: quién avisa (notificación, etiqueta de la isla) es main.js.

/**
 * @param onChange ({ id, ok, text, bad }) => void — en cada cambio de estado (nunca en la primera vez que algo está bien)
 */
function createHealth({ onChange = () => {}, now = Date.now } = {}) {
  const items = new Map(); // id → { ok, text, since }
  const bad = () => [...items].filter(([, v]) => !v.ok).map(([id, v]) => ({ id, text: v.text, since: v.since }));
  return {
    /** Anota cómo está `id`. → true si cambió (y se avisó). Repetir el mismo estado no avisa (solo actualiza el texto de lo caído). */
    set(id, ok, text = "") {
      const prev = items.get(id);
      if (prev ? prev.ok === ok : ok) {
        if (prev && !ok && text) prev.text = text;
        if (!prev) items.set(id, { ok: true, text: "", since: now() });
        return false;
      }
      items.set(id, { ok, text: ok ? "" : text, since: now() });
      onChange({ id, ok, text: ok ? "" : text, bad: bad() });
      return true;
    },
    ok: (id) => items.get(id)?.ok !== false,
    bad,
  };
}

module.exports = { createHealth };

// Autoprueba: `node src/main/health.js`
if (require.main === module) {
  const assert = require("assert");
  const seen = [];
  let clock = 1000;
  const h = createHealth({ onChange: (c) => seen.push([c.id, c.ok, c.text, c.bad.length]), now: () => clock });
  assert.strictEqual(h.set("google", true), false); // la primera vez bien: silencio
  assert.strictEqual(h.ok("google"), true);
  assert.strictEqual(h.set("google", true), false);
  assert.strictEqual(h.set("google", false, "se desconectó"), true); // se cayó: un aviso
  assert.strictEqual(h.set("google", false, "sigue caída"), false); // sigue caída: sin repetir
  assert.strictEqual(h.bad()[0].text, "sigue caída");
  clock = 2000;
  assert.strictEqual(h.set("neo", false, "no responde"), true); // algo que nunca estuvo bien y se cae: avisa
  assert.deepStrictEqual(h.bad().map((b) => b.id), ["google", "neo"]);
  assert.strictEqual(h.set("google", true), true); // volvió: un aviso
  assert.strictEqual(h.ok("google") && !h.ok("neo"), true);
  assert.deepStrictEqual(seen, [["google", false, "se desconectó", 1], ["neo", false, "no responde", 2], ["google", true, "", 1]]);
  console.log("health.js ok");
}

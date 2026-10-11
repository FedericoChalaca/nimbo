// Recordatorios y pendientes de Nimbo, guardados en un JSON en %APPDATA%\nimbo.
// Un pendiente sin fecha ("cosas para tener en cuenta") nunca avisa: solo se lista.
const fs = require("fs");

function createReminders(file) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const save = () => fs.writeFileSync(file, JSON.stringify(list, null, 2));
  const find = (id) => list.find((r) => r.id === id);
  const dueMs = (r) => (r.due ? Date.parse(r.due) : Infinity);

  return {
    /** Pendientes sin hacer: primero los que vencen antes; los sin fecha al final. */
    pending: () => list.filter((r) => !r.done).sort((a, b) => dueMs(a) - dueMs(b)),

    add({ text, due } = {}) {
      text = String(text ?? "").trim().slice(0, 300);
      if (!text) return null;
      const t = due ? Date.parse(due) : NaN; // fecha inválida = pendiente sin fecha
      const r = { id: Math.random().toString(36).slice(2, 8), text, due: Number.isFinite(t) ? new Date(t).toISOString() : null,
        done: false, notified: false, created: new Date().toISOString() };
      list.push(r);
      save();
      return r;
    },

    complete(id) {
      const r = find(id);
      if (r) { r.done = true; save(); }
      return r;
    },

    snooze(id, minutes = 10) {
      const r = find(id);
      if (r) { r.due = new Date(Date.now() + minutes * 60_000).toISOString(); r.notified = false; save(); }
      return r;
    },

    /** Los que ya vencieron y aún no avisaron; quedan marcados como avisados. */
    takeDue(now = Date.now()) {
      const due = list.filter((r) => !r.done && !r.notified && dueMs(r) <= now);
      for (const r of due) r.notified = true;
      if (due.length) save();
      return due;
    },
  };
}

module.exports = { createReminders };

// Autoprueba: node reminders.js
if (require.main === module) {
  const assert = require("assert");
  const tmp = require("path").join(require("os").tmpdir(), `nimbo-rem-${Date.now()}.json`);
  const rem = createReminders(tmp);
  const soon = rem.add({ text: "entregar taller", due: new Date(Date.now() + 1000).toISOString() });
  const nodate = rem.add({ text: "llamar a Juan", due: "" });
  assert.equal(rem.add({ text: "  " }), null);
  assert.equal(nodate.due, null);
  assert.deepEqual(rem.pending().map((r) => r.text), ["entregar taller", "llamar a Juan"]);
  assert.equal(rem.takeDue(Date.now()).length, 0); // todavía no vence
  assert.equal(rem.takeDue(Date.now() + 2000).length, 1); // ya venció: avisa una vez
  assert.equal(rem.takeDue(Date.now() + 2000).length, 0); // y no repite
  rem.snooze(soon.id, 10);
  assert.equal(rem.takeDue(Date.now() + 9 * 60_000).length, 0);
  assert.equal(rem.takeDue(Date.now() + 11 * 60_000).length, 1); // pospuesto: vuelve a avisar
  rem.complete(soon.id);
  assert.deepEqual(rem.pending().map((r) => r.text), ["llamar a Juan"]);
  assert.equal(createReminders(tmp).pending().length, 1); // persiste en disco
  require("fs").unlinkSync(tmp);
  console.log("reminders.js ok");
}

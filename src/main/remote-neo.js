// Control remoto por WhatsApp: tú le escribes a tu IA de WhatsApp (Neo/Instinct) y ella lo deja en «Para Nimbo» (instinct.js).
//   · "[orden] <chat> :: <mensaje>" → Nimbo busca ese chat de Claude y te PIDE CONFIRMAR por WhatsApp con un código de 4 cifras
//     de un solo uso ("CONFIRMO 4821"). Solo con el código correcto se envía el mensaje al chat; su respuesta te llega por WhatsApp.
//   · Si un chat pide un permiso mientras estás lejos, la pregunta te llega por WhatsApp ("PERMITIR 4821" o "DENEGAR 4821").
// Por qué el código: lo que llega por «Para Nimbo» lo escribe otra IA, que también lee mensajes de otras personas. Un mensaje
// malicioso no puede adivinar el código que Nimbo te acaba de mandar solo a ti. Apagado por defecto (prefs.remoteNeo).

const CODE_TTL = 30 * 60_000; // una orden sin confirmar vence a los 30 min
/** "chat :: mensaje" (también "chat | mensaje" o "chat: mensaje"). */
function parseOrder(text) {
  const m = String(text ?? "").match(/^\s*(.{2,80}?)\s*(?:::|\||—|:)\s*(.{2,4000})$/s);
  return m ? { chat: m[1].replace(/^chat\s+/i, "").replace(/^[«"']|[»"']$/g, "").trim(), message: m[2].trim() } : null;
}
// Generador seguro (no Math.random, que se puede predecir). 4 cifras bastan: cada código vale UN intento (uno malo cancela) y vence en 30 min.
const newCode = () => String(require("crypto").randomInt(1000, 10000));
/** ¿La respuesta trae la palabra y el código? ("confirmo 4821", "Permitir: 4821") */
const says = (text, word, code) => new RegExp(`\\b${word}\\b[^0-9]{0,12}${code}\\b`, "i").test(String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""));

/**
 * @param enabled   () => ¿está activado el control remoto?
 * @param ask       (texto) => Promise<id de la pregunta "pN"> — la deja en «De Nimbo» como [pregunta] (y avisa a Neo)
 * @param say       (texto) => Promise — un aviso en «De Nimbo»
 * @param findChat  (nombre) => Promise<{id,title} | {many} | null>
 * @param dispatch  (id, mensaje) => Promise<{text}>
 */
function createRemoteNeo({ enabled, ask, say, findChat, dispatch, now = () => Date.now(), log = () => {} }) {
  const waiting = new Map(); // id de la pregunta → { kind: "order"|"perm", code, at, ... }
  const sweep = () => { for (const [q, w] of waiting) if (now() - w.at > CODE_TTL && w.kind === "order") waiting.delete(q); };

  return {
    /** Una cosa nueva de «Para Nimbo». Devuelve true si la atendió el control remoto (y sale de la pastilla). */
    async onItem(item) {
      if (!enabled()) return false;
      sweep();
      if (item.tag === "orden") {
        const o = parseOrder(item.text);
        if (!o) { log("orden: no se entendió el formato"); await say("No entendí la orden. Escríbela así: [orden] nombre del chat :: lo que quieres que haga."); return true; }
        const found = await findChat(o.chat);
        if (!found) { log("orden: chat no encontrado"); await say(`No encontré un chat de Claude llamado «${o.chat}».`); return true; }
        if (found.many) { log(`orden: ${found.many.length} chats parecidos`); await say(`Hay varios chats parecidos a «${o.chat}»: ${found.many.join(" · ")}. Repite la orden con el nombre exacto.`); return true; }
        const code = newCode();
        const which = found.of > 1 ? ` (hay ${found.of} con ese nombre: uso el que usaste más recientemente, carpeta «${found.where}»)` : "";
        const q = await ask(`Me pediste enviar al chat «${found.title}»${which}: «${o.message.slice(0, 300)}». Para confirmar responde exactamente: CONFIRMO ${code} (vale 30 min).`);
        if (q) waiting.set(q, { kind: "order", code, at: now(), chat: found, message: o.message });
        log(q ? `orden: pedí confirmación (#${q})` : "orden: no pude dejar la pregunta en De Nimbo");
        return true;
      }
      if (item.tag === "respuesta" && waiting.has(item.ref)) {
        const w = waiting.get(item.ref);
        if (w.kind === "order") {
          if (says(item.text, "confirmo", w.code)) {
            waiting.delete(item.ref);
            log(`#${item.ref}: código correcto, enviando al chat`);
            const r = await dispatch(w.chat.id, w.message).catch((e) => ({ text: `Error: ${e?.message ?? e}` }));
            await say(`Chat «${w.chat.title}» respondió: ${String(r?.text ?? "(sin respuesta)").replace(/\s+/g, " ").slice(0, 900)}`);
          } else {
            log(`#${item.ref}: código incorrecto, orden cancelada`);
            waiting.delete(item.ref); // un código malo cancela la orden: no se puede probar otra vez con el mismo
            await say(`No envié nada al chat «${w.chat.title}» (no llegó "CONFIRMO" con el código correcto).`);
          }
          return true;
        }
        if (w.kind === "perm") {
          waiting.delete(item.ref);
          w.finish(says(item.text, "permitir", w.code) ? "allow" : "deny"); // cualquier otra cosa = no
          return true;
        }
      }
      return false;
    },
    /** Un chat pide permiso y no estás frente al PC: te llega la pregunta. `finish("allow"|"deny")` cuando respondas. */
    async askPermission(summary, finish) {
      const code = newCode();
      const q = await ask(`${summary.slice(0, 600)} — Responde PERMITIR ${code} o DENEGAR ${code}.`);
      if (!q) return false;
      waiting.set(q, { kind: "perm", code, at: now(), finish });
      return q;
    },
    /** Se resolvió de otra forma (en el PC o venció): ya no espera respuesta por WhatsApp. */
    forget(q) { waiting.delete(q); },
  };
}

module.exports = { createRemoteNeo, parseOrder, says };

// Autoprueba: `node src/main/remote-neo.js`
if (require.main === module) {
  const assert = require("assert");
  assert.deepStrictEqual(parseOrder("nimbo :: cambia el botón a verde"), { chat: "nimbo", message: "cambia el botón a verde" });
  assert.deepStrictEqual(parseOrder("chat «Almu landing» | sube el logo"), { chat: "Almu landing", message: "sube el logo" });
  assert.strictEqual(parseOrder("sin separador"), null);
  assert.ok(says("Confirmó 4821", "confirmo", "4821") && says("PERMITIR: 4821", "permitir", "4821"));
  assert.ok(!says("confirmo 1234", "confirmo", "4821") && !says("4821", "confirmo", "4821") && !says("confirmo 48210", "confirmo", "4821"));
  (async () => {
    const said = [], asked = [], sent = [];
    let qn = 0, on = true;
    const r = createRemoteNeo({ enabled: () => on, ask: async (t) => { asked.push(t); return `p${++qn}`; }, say: async (t) => said.push(t),
      findChat: async (n) => (n === "nimbo" ? { id: "S1", title: "nimbo" } : n === "app" ? { many: ["app a", "app b"] } : null),
      dispatch: async (id, m) => { sent.push([id, m]); return { text: "Listo, quedó verde." }; } });
    // Orden → pide código; código malo → cancela; nada se envía
    assert.ok(await r.onItem({ tag: "orden", text: "nimbo :: pon el botón verde" }));
    const code1 = asked[0].match(/CONFIRMO (\d{4})/)[1];
    assert.ok(await r.onItem({ tag: "respuesta", ref: "p1", text: `confirmo ${code1 === "1111" ? "2222" : "1111"}` }));
    assert.deepStrictEqual(sent, []);
    assert.ok(/No envié nada/.test(said.at(-1)));
    assert.ok(!(await r.onItem({ tag: "respuesta", ref: "p1", text: `confirmo ${code1}` }))); // ya no vale (un solo intento)
    // Orden buena → código correcto → se envía y la respuesta del chat vuelve
    await r.onItem({ tag: "orden", text: "nimbo :: pon el botón verde" });
    const code2 = asked[1].match(/CONFIRMO (\d{4})/)[1];
    await r.onItem({ tag: "respuesta", ref: "p2", text: `Confirmo ${code2}` });
    assert.deepStrictEqual(sent, [["S1", "pon el botón verde"]]);
    assert.ok(/respondió: Listo, quedó verde/.test(said.at(-1)));
    // Chat que no existe o ambiguo: se dice, no se pregunta
    await r.onItem({ tag: "orden", text: "otro :: x" }); await r.onItem({ tag: "orden", text: "app :: x" });
    assert.ok(/No encontré/.test(said.at(-2)) && /varios chats/.test(said.at(-1)));
    // Permiso: PERMITIR con código → allow; otra cosa → deny
    let d1, d2;
    await r.askPermission("Claude pide permiso", (d) => (d1 = d));
    const pc = asked.at(-1).match(/PERMITIR (\d{4})/)[1];
    await r.onItem({ tag: "respuesta", ref: `p${qn}`, text: `permitir ${pc}` });
    await r.askPermission("Otro permiso", (d) => (d2 = d));
    await r.onItem({ tag: "respuesta", ref: `p${qn}`, text: "sí dale" });
    assert.deepStrictEqual([d1, d2], ["allow", "deny"]);
    // Apagado: no atiende nada (queda como cualquier cosa de la pastilla)
    on = false;
    assert.strictEqual(await r.onItem({ tag: "orden", text: "nimbo :: x" }), false);
    console.log("remote-neo.js ok");
  })();
}

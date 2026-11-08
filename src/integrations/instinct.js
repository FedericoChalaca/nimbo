// Instinct ↔ Nimbo por tu Google Drive (carpeta «Nimbo e Instinct», creada por Nimbo con google.js):
//   · «Para Nimbo»: Instinct agrega líneas al final ("2026-10-27 [tarea] texto"). Nimbo las LEE.
//   · «De Nimbo»: Nimbo agrega lo que Instinct te debe contar (solo cuando tú lo pides con un clic).
// Por AVISO, sin revisar cada tanto: Drive avisa cuando «Para Nimbo» cambia (files.watch). Como el PC no tiene dirección pública, el aviso va a
// un tema de ntfy.sh con nombre aleatorio y Nimbo deja UNA conexión quieta escuchándolo; solo al llegar "cambió" lee el documento. ntfy.sh
// solo ve que algo cambió (Drive manda encabezados, sin contenido). El permiso de aviso dura un día: se renueva una vez al día.
// 2026-11-01: el aviso NO es garantía (Google lo dice: "a small percentage of messages get dropped"; además hay un hueco al renovar el canal y la
// conexión a ntfy se cae en silencio). Por eso además hay una RED DE SEGURIDAD: cada 60 s se pregunta la versión del documento (una llamada chica,
// sin leer el contenido si no cambió), y se relee al reconectar con ntfy y al despertar el PC. El aviso sigue siendo lo que lo hace instantáneo.
// Lo que escribe Instinct es un DATO de otra app: nunca se ejecuta; se muestra con textContent y cada acción la decides tú.
const crypto = require("crypto");
const fs = require("fs");
const { redact } = require("../shared/redact");

// "respuesta" = lo que contestaste por WhatsApp a una [pregunta #p3] que Nimbo le dejó a Instinct: llega como "[respuesta #p3] texto".
// "orden" = control remoto (remote-neo.js): "[orden] chat :: mensaje", siempre con confirmación por código.
const TAGS = ["nota", "idea", "tarea", "calendario", "pedido", "respuesta", "orden"];
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Texto del documento → líneas con etiqueta. Las que no tienen etiqueta (como la explicación de arriba) no cuentan. */
function parseLines(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const m = line.match(/^(\d{4}-\d{2}-\d{2})?\s*\[(\w+)(?:\s+#(p\d{1,6}))?\]\s*(.+)$/);
    if (!m || !TAGS.includes(m[2].toLowerCase())) continue;
    out.push({ id: hash(line), date: m[1] ?? "", tag: m[2].toLowerCase(), ref: m[3] ?? "", text: m[4].slice(0, 500) });
  }
  return out;
}

/**
 * @param google   el de google.js (version, read, append)
 * @param bridge   () => { para, de } ids de los documentos (o null)
 * @param file     dónde se guarda qué líneas ya se vieron y cuáles esperan (solo ids y textos de Instinct, en tu PC)
 * @param onNew    (pendientes) => void, cuando llega algo nuevo
 * @param onHealth (ok, detalle) => void — false tras 3 lecturas seguidas fallidas (sin red, Google 5xx…); true cuando vuelve a leer bien
 */
function createInstinct({ google, bridge, file, onNew, topic, relay = "https://ntfy.sh", fetch: doFetch = fetch, onHealth = () => {} }) {
  let state = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { version: "", seen: [], pending: [], primed: false }; } })();
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(state)); } catch {} };
  // Drive no le avisa a Instinct; tu calendario sí (Instinct quedó atento a eventos nuevos llamados exactamente «Pregunta de Nimbo»).
  // Cada vez que Nimbo deja algo en «De Nimbo» crea uno cortito, sin alarma en tu celular, y lo borra a las 2 h para no llenarte la agenda.
  const NUDGE = "Pregunta de Nimbo";
  async function nudge(text, q) {
    if (!google.createEvent) return;
    try {
      const id = await google.createEvent(NUDGE, `${q ? `[pregunta #${q}] ` : ""}${text}\n\nEstá en «De Nimbo».`);
      state.nudges = [...(state.nudges ?? []), { id, at: Date.now() }].slice(-50);
      save();
    } catch {}
    cleanNudges();
    setTimeout(cleanNudges, 2 * 3600_000 + 60_000); // el que se acaba de crear, a las 2 h
  }
  async function cleanNudges() {
    const old = (state.nudges ?? []).filter((n) => Date.now() - n.at > 2 * 3600_000);
    if (!old.length) return;
    for (const n of old) await google.deleteEvent?.(n.id);
    state.nudges = (state.nudges ?? []).filter((n) => !old.includes(n));
    save();
  }
  let busy = false, stopped = true, renew = null, retry = null, stream = null, channel = null, wait = 5000, poll = null;
  let fails = 0; // lecturas seguidas que fallaron (a las 3 se avisa; antes el fallo se tragaba y nadie se enteraba)
  const FAILS_TO_TELL = 3;
  /** Pide a Drive el aviso (y lo renueva un rato antes de que venza). */
  async function ensureWatch() {
    clearTimeout(renew);
    const b = bridge();
    if (stopped || !b?.para || !google.connected()) return;
    try {
      await google.stopWatch(channel);
      channel = await google.watch(b.para, `${relay}/${topic()}`);
      renew = setTimeout(ensureWatch, Math.max(60_000, channel.until - Date.now() - 3600_000));
    } catch { renew = setTimeout(ensureWatch, 10 * 60_000); } // sin internet: se reintenta más tarde
  }
  /** Una conexión quieta al tema: ntfy manda una línea por aviso (y "keepalive" de vez en cuando). */
  async function listen() {
    if (stopped) return;
    const ctrl = new AbortController();
    stream = ctrl;
    try {
      const r = await doFetch(`${relay}/${topic()}/json`, { signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error(`ntfy ${r.status}`);
      wait = 5000;
      check(); // lo que haya llegado mientras la conexión estuvo caída
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          try { if (JSON.parse(line).event === "message") check(); } catch {}
        }
      }
    } catch {}
    if (!stopped && stream === ctrl) { retry = setTimeout(listen, wait); wait = Math.min(wait * 2, 120_000); } // se cayó: vuelve a escuchar
  }

  async function check(force = false) {
    const b = bridge();
    if (busy || !b?.para || !google.connected()) return state.pending;
    busy = true;
    try {
      const v = await google.version(b.para);
      if (!force && v === state.version) return state.pending;
      const lines = parseLines(await google.read(b.para));
      const seen = new Set(state.seen);
      // La primera vez, lo que ya estaba escrito no es "nuevo" (no se llena de avisos al conectar)
      const fresh = state.primed ? lines.filter((l) => !seen.has(l.id)) : [];
      state = { ...state, version: v, seen: [...new Set([...state.seen, ...lines.map((l) => l.id)])].slice(-3000), pending: [...state.pending, ...fresh].slice(-200), primed: true };
      save();
      if (fails >= FAILS_TO_TELL) { try { onHealth(true, ""); } catch {} }
      fails = 0;
      if (fresh.length) onNew(state.pending, fresh);
    } catch (e) {
      fails++;
      if (fails === FAILS_TO_TELL) { try { onHealth(false, String(e?.message ?? e).slice(0, 80)); } catch {} }
    } finally { busy = false; }
    return state.pending;
  }

  return {
    /** Empieza a escuchar avisos (y se pone al día con lo que llegó mientras Nimbo estaba cerrado). */
    start() {
      if (!stopped || !topic()) return;
      stopped = false;
      listen();
      ensureWatch();
      setTimeout(() => check(), 3000);
      poll = setInterval(() => check(), 60_000); // red de seguridad (ver arriba)
      cleanNudges(); // los avisos de calendario viejos (si Nimbo estaba cerrado cuando tocaba borrarlos)
    },
    stop() { stopped = true; clearTimeout(renew); clearTimeout(retry); clearInterval(poll); stream?.abort(); google.stopWatch(channel); channel = null; },
    restart() { this.stop(); this.start(); },
    /** ¿Drive aceptó avisar y la conexión al tema está abierta? (para Opciones) */
    status: () => ({ watching: !!channel && channel.until > Date.now(), listening: !!stream && !stopped }),
    check,
    pending: () => state.pending,
    /** Ya lo atendiste (guardado como pendiente, enviado a Claude o descartado): sale de la lista. */
    done(id) { state.pending = state.pending.filter((p) => p.id !== id); save(); return state.pending; },
    /** Escribe en «De Nimbo» (para que Instinct te lo cuente). Con `ask`, es una [pregunta #pN] que Instinct te hace por WhatsApp
     *  y cuya respuesta vuelve como "[respuesta #pN]". Solo con tu clic. → el id de la pregunta, true, o false. Si Google falla, LANZA
     *  (quien llama debe decirlo: un error aquí fue invisible 5 días). Lo que parece un secreto sale tapado (redact.js): va a otra IA. */
    async reply(text, ask = false) {
      const b = bridge();
      const clean = redact(String(text ?? "")).replace(/\s+/g, " ").trim().slice(0, 1000);
      if (!b?.de || !clean) return false;
      const day = new Date().toLocaleDateString("sv");
      if (!ask) { await google.append(b.de, `${day} ${clean}\n`); await nudge(clean, ""); return true; }
      const q = `p${(state.asked ?? 0) + 1}`;
      await google.append(b.de, `${day} [pregunta #${q}] ${clean}\n`);
      state.asked = (state.asked ?? 0) + 1;
      state.questions = { ...(state.questions ?? {}), [q]: clean };
      save();
      await nudge(clean, q);
      return q;
    },
    /** La pregunta a la que responde una [respuesta #pN] (para mostrarlas juntas). */
    question: (ref) => state.questions?.[ref] ?? "",
  };
}

module.exports = { createInstinct, parseLines, TAGS };

// Autoprueba: `node src/integrations/instinct.js` (con un Google de mentira)
if (require.main === module) {
  const assert = require("assert");
  const os = require("os"), path = require("path");
  assert.deepStrictEqual(parseLines("Aquí Instinct anota…\n2026-10-27 [tarea] revisar el parcial\n[IDEA]  app de logros \n[otra] x\nsin etiqueta").map((l) => [l.date, l.tag, l.text]),
    [["2026-10-27", "tarea", "revisar el parcial"], ["", "idea", "app de logros"]]);
  (async () => {
    let doc = "Aquí Instinct anota…\n2026-10-26 [nota] vieja\n", ver = "1";
    const appended = [];
    const google = { connected: () => true, version: async () => ver, read: async () => doc, append: async (id, t) => appended.push([id, t]) };
    const file = path.join(os.tmpdir(), `instinct-prueba-${process.pid}.json`);
    const news = [];
    const ins = createInstinct({ google, bridge: () => ({ para: "P", de: "D" }), file, onNew: (_p, fresh) => news.push(...fresh.map((f) => f.text)) });
    assert.deepStrictEqual(await ins.check(), []); // primera vez: lo viejo no avisa
    assert.deepStrictEqual(await ins.check(), []); // misma versión: ni lee
    doc += "2026-10-27 [tarea] revisar el parcial\n"; ver = "2";
    const p = await ins.check();
    assert.deepStrictEqual([p.length, news], [1, ["revisar el parcial"]]);
    assert.deepStrictEqual(ins.done(p[0].id), []);
    assert.ok(await ins.reply("Listo, quedó en tus pendientes"));
    assert.ok(appended[0][0] === "D" && appended[0][1].endsWith("Listo, quedó en tus pendientes\n"));
    // Lo que sale hacia la otra IA va sin secretos
    await ins.reply("Chat «x» respondió: usa GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 y listo");
    assert.ok(appended[1][1].includes("GITHUB_TOKEN=[secreto] y listo") && !appended[1][1].includes("ghp_"));
    // Si Google falla al escribir, reply LANZA (no devuelve true como si nada)
    const roto = createInstinct({ google: { ...google, append: async () => { throw new Error("google 503"); } }, bridge: () => ({ para: "P", de: "D" }), file, onNew: () => {} });
    await assert.rejects(roto.reply("hola"), /google 503/);
    fs.rmSync(file, { force: true });
    // Tres lecturas seguidas fallidas → onHealth(false) UNA vez; al volver a leer bien → onHealth(true)
    const health = [];
    let fail = true;
    const g3 = { ...google, version: async () => { if (fail) throw new Error("fetch failed"); return "v9"; } };
    const ins3 = createInstinct({ google: g3, bridge: () => ({ para: "P", de: "D" }), file, onNew: () => {}, onHealth: (ok, why) => health.push([ok, why]) });
    for (let i = 0; i < 5; i++) await ins3.check();
    assert.deepStrictEqual(health, [[false, "fetch failed"]]);
    fail = false;
    await ins3.check();
    assert.deepStrictEqual(health, [[false, "fetch failed"], [true, ""]]);
    fs.rmSync(file, { force: true });
    // El aviso: un "ntfy" de mentira manda una línea "message" y eso dispara la lectura (sin revisar cada tanto)
    const http = require("http");
    let push;
    const srv = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/x-ndjson" }); res.write(JSON.stringify({ event: "open" }) + "\n"); push = () => res.write(JSON.stringify({ event: "message" }) + "\n"); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    let reads = 0, watched = "";
    const g2 = { ...google, read: async () => { reads++; return doc; }, watch: async (id, addr) => { watched = addr; return { id: "c", resourceId: "r", until: Date.now() + 86_400_000 }; }, stopWatch: async () => {} };
    const ins2 = createInstinct({ google: g2, bridge: () => ({ para: "P", de: "D" }), file, onNew: () => {}, topic: () => "nimbo-abc", relay: `http://127.0.0.1:${srv.address().port}` });
    ins2.start();
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(watched.endsWith("/nimbo-abc"));
    ver = "3"; const before = reads; push();
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(reads > before, "el aviso debe hacer que lea");
    ins2.stop(); srv.close(); fs.rmSync(file, { force: true });
    console.log("instinct.js ok");
  })();
}

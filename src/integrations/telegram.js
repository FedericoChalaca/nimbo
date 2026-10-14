// Telegram (opcional): hablar con Nimbo desde el celular. Tú creas un bot con @BotFather, pegas su token en
// Conexiones y lo vinculas con un código; desde ahí, lo que le escribas a tu bot llega al mismo chat de Nimbo
// y la respuesta vuelve a Telegram.
//
// Sin servidor ni puerto abierto: Nimbo PREGUNTA a Telegram (getUpdates, espera larga de 25 s), nunca recibe
// llamadas. Seguridad:
//   · Solo atiende UNA cuenta, la que se vinculó con un código de 6 cifras (10 min, 5 intentos). Cualquier otra
//     cuenta, grupo o bot se ignora en silencio: ni siquiera se le contesta.
//   · Lo que no se atendió mientras Nimbo estaba apagado se descarta al arrancar (un mensaje viejo no debe
//     ejecutarse horas después) y se te avisa. ÚNICA excepción: la bandeja de pendientes. Lo que le mandes con
//     /pendiente <texto> es una nota inerte (no ejecuta nada), así que al encender se anota y se te confirma.
//   · El token da control total del bot: va cifrado por Windows (main.js) y nunca aparece en un error ni en un log.
// Los chats con bots NO están cifrados de punta a punta: Telegram ve el texto (ver PRIVACY.md).
const crypto = require("crypto");

const API = "https://api.telegram.org";
const TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;
const MAX_IN = 2000; // lo que se le pasa a Nimbo de un mensaje
const MAX_OUT = 4000; // Telegram admite 4096 por mensaje
const INBOX = /^\/(?:pendiente|p|anotar|tarea)(?:@\w+)?(?:\s|$)/i; // comandos que anotan un pendiente
/** El texto a anotar de "/pendiente comprar pan", o null si no es un comando de la bandeja ("" si falta el texto). */
const parseInbox = (text) => (INBOX.test(String(text ?? "")) ? String(text).replace(INBOX, "").replace(/\s+/g, " ").trim().slice(0, 200) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parte un texto largo en mensajes de Telegram, cortando en salto de línea o espacio si puede. */
function chunks(text, max = MAX_OUT) {
  const out = [];
  let rest = String(text ?? "");
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max));
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim()) out.push(rest);
  return out.length ? out : ["…"];
}

/**
 * @param token       () => el token del bot ("" = sin configurar)
 * @param chatId      () => la cuenta vinculada (0 = ninguna)
 * @param setChatId   (id) => la guarda
 * @param onMessage   async (texto) => lo que se responde (lo arma main.js: el chat de Nimbo)
 * @param texts       () => { welcome, failed, backlog } ya traducidos
 * @param onBacklog   async (textos de /pendiente recibidos con Nimbo apagado) => lo que se te responde
 * @param onChange    () => algo cambió (para refrescar el panel)
 */
function createTelegram({ token, chatId, setChatId, onMessage, onBacklog = async () => "", texts, onChange = () => {}, fetch: doFetch = fetch, pollSeconds = 25 }) {
  let offset = 0;
  let stopped = true;
  let abort = null;
  let bot = ""; // @usuario del bot, para mostrarlo
  let pairing = null; // { code, until, tries }
  let queue = Promise.resolve();

  async function raw(t, method, params, ms) {
    const signal = AbortSignal.any([AbortSignal.timeout(ms), ...(abort ? [abort.signal] : [])]);
    const r = await doFetch(`${API}/bot${t}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal });
    const j = await r.json().catch(() => ({}));
    // El mensaje de error nunca lleva la dirección (que contiene el token).
    if (!j.ok) throw Object.assign(new Error(`telegram ${method} ${j.error_code ?? r.status}`), { code: j.error_code ?? r.status });
    return j.result;
  }
  const call = (method, params = {}, ms = 15_000) => {
    const t = token();
    if (!TOKEN.test(t ?? "")) throw new Error("sin token");
    return raw(t, method, params, ms);
  };
  const send = async (chat, text) => {
    for (const part of chunks(text)) await call("sendMessage", { chat_id: chat, text: part, disable_web_page_preview: true });
  };

  async function handle(u) {
    const m = u.message;
    if (!m || m.chat?.type !== "private" || typeof m.text !== "string" || !m.from || m.from.is_bot) return;
    const mine = chatId();
    if (mine) {
      if (m.chat.id !== mine) return; // otra cuenta: en silencio
      call("sendChatAction", { chat_id: mine, action: "typing" }).catch(() => {});
      let out = null;
      try { out = await onMessage(m.text.slice(0, MAX_IN)); } catch {}
      await send(mine, out || texts().failed);
      return;
    }
    if (!pairing || Date.now() > pairing.until) return;
    const given = Buffer.from(m.text.trim());
    const want = Buffer.from(pairing.code);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) {
      pairing = null;
      setChatId(m.chat.id);
      await send(m.chat.id, texts().welcome);
      onChange();
    } else if (++pairing.tries >= 5) { pairing = null; onChange(); }
  }

  /** Una vuelta: espera hasta 25 s mensajes nuevos y los atiende de a uno. */
  async function pollOnce() {
    const updates = await call("getUpdates", { offset, timeout: pollSeconds, allowed_updates: ["message"] }, (pollSeconds + 10) * 1000);
    for (const u of updates) {
      offset = u.update_id + 1;
      queue = queue.then(() => handle(u)).catch(() => {});
    }
    await queue;
  }

  /** Al arrancar: lo que llegó con Nimbo apagado se descarta, salvo las notas de la bandeja (/pendiente), que se anotan. */
  async function prime() {
    const mine = chatId();
    const kept = [];
    let ignored = 0;
    for (let i = 0; i < 5; i++) { // hasta 500 mensajes pendientes; Telegram guarda como mucho 24 h
      const batch = await call("getUpdates", { offset, timeout: 0, limit: 100, allowed_updates: ["message"] });
      for (const u of batch) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!mine || m?.chat?.type !== "private" || m.chat.id !== mine || m.from?.is_bot || typeof m.text !== "string") continue; // otras cuentas: en silencio
        if (parseInbox(m.text) !== null) kept.push(m.text.slice(0, MAX_IN)); else ignored++;
      }
      if (batch.length < 100) break;
    }
    if (!mine || (!kept.length && !ignored)) return;
    const parts = [];
    if (kept.length) { try { parts.push(await onBacklog(kept)); } catch {} }
    if (ignored) parts.push(texts().backlog);
    await send(mine, parts.filter(Boolean).join("\n\n"));
  }

  const active = () => TOKEN.test(token() ?? "") && (chatId() || (pairing && Date.now() < pairing.until));

  async function loop() {
    let wait = 0;
    try { bot = (await call("getMe")).username ?? ""; await prime(); } catch {}
    onChange();
    while (!stopped) {
      try {
        if (!active()) { await sleep(2000); continue; }
        await pollOnce();
        wait = 0;
      } catch (e) {
        if (stopped) break;
        if (e.code === 401 || e.code === 404) { bot = ""; stopped = true; onChange(); break; } // token inválido o bot borrado
        wait = Math.min(wait ? wait * 2 : 5000, 60_000); // sin red o Telegram caído: reintenta con calma
        await sleep(wait);
      }
    }
  }

  return {
    TOKEN,
    pollOnce,
    prime,
    /** ¿Es un token de bot que funciona? Devuelve el @usuario del bot o lanza. No lo guarda. */
    verify: async (t) => {
      if (!TOKEN.test(t ?? "")) throw new Error("formato");
      return (await raw(t, "getMe", {}, 10_000)).username ?? "";
    },
    start() {
      if (!stopped) return;
      stopped = false;
      offset = 0;
      abort = new AbortController();
      loop();
    },
    stop() { stopped = true; abort?.abort(); abort = null; },
    /** Un aviso a tu cuenta vinculada (no hace nada si no hay cuenta o Nimbo no está atendiendo Telegram). */
    notify(text) {
      const mine = chatId();
      if (!mine || stopped || !TOKEN.test(token() ?? "")) return false;
      send(mine, text).catch(() => {});
      return true;
    },
    /** Empieza una vinculación: devuelve el código que hay que enviarle al bot. */
    pair() {
      if (!TOKEN.test(token() ?? "")) return ""; // sin bot no hay a quién enviarle el código
      pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), until: Date.now() + 10 * 60_000, tries: 0 };
      onChange();
      return pairing.code;
    },
    logout() { pairing = null; bot = ""; },
    status: () => ({ token: TOKEN.test(token() ?? ""), paired: !!chatId(), pairing: pairing && Date.now() < pairing.until ? pairing.code : "", bot }),
  };
}

module.exports = { createTelegram, chunks, parseInbox, TOKEN };

// Autoprueba (sin red, con un Telegram de mentira): `node src/integrations/telegram.js`
if (require.main === module) (async () => {
  const assert = require("assert");
  const GOOD = "123456789:AAH_testtesttesttesttesttesttesttest";
  assert.ok(TOKEN.test(GOOD));
  for (const bad of ["", "123:abc", "no-es-token", `${GOOD} `, `x${GOOD}`, "123456789:" + "A".repeat(80)]) assert.ok(!TOKEN.test(bad), bad);
  assert.deepStrictEqual(chunks(""), ["…"]);
  assert.deepStrictEqual(chunks("hola"), ["hola"]);
  const long = chunks(("palabra ".repeat(20) + "\n").repeat(60)); // ~10 000 letras
  assert.ok(long.length >= 3 && long.every((c) => c.length <= MAX_OUT && c.length > 0), "partir texto largo");
  assert.strictEqual(chunks("x".repeat(9000)).join("").length, 9000); // sin espacios: corta duro y no pierde nada

  // Un Telegram de mentira: guarda lo que se le manda y entrega las actualizaciones pendientes.
  const world = { updates: [], sent: [], nextId: 100, failMode: null };
  const say = (chat, text, extra = {}) => world.updates.push({ update_id: world.nextId++, message: { chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false }, text, ...extra } });
  const fake = async (url, init) => {
    const [, tok, method] = /\/bot([^/]+)\/(\w+)$/.exec(url);
    const body = JSON.parse(init.body);
    const reply = (ok, result, code = 200) => ({ status: code, json: async () => (ok ? { ok, result } : { ok, error_code: code, description: "x" }) });
    if (tok !== GOOD) return reply(false, null, 401);
    if (world.failMode) return reply(false, null, world.failMode);
    if (method === "getMe") return reply(true, { username: "nimbo_prueba_bot" });
    if (method === "sendMessage") { world.sent.push({ chat: body.chat_id, text: body.text }); return reply(true, {}); }
    if (method === "sendChatAction") return reply(true, true);
    if (method === "getUpdates") {
      const pending = body.offset === -1 ? world.updates.slice(-1) : world.updates.filter((u) => u.update_id >= body.offset);
      if (body.offset === -1 && pending.length) world.updates = world.updates.filter((u) => u.update_id > pending[0].update_id - 0 && false);
      else if (body.offset > 0) world.updates = world.updates.filter((u) => u.update_id >= body.offset);
      return reply(true, pending);
    }
    return reply(false, null, 404);
  };
  let mine = 0;
  const heard = [];
  let changes = 0;
  const tg = createTelegram({
    token: () => GOOD, chatId: () => mine, setChatId: (id) => { mine = id; },
    onMessage: async (text) => { heard.push(text); if (text === "explota") throw new Error("boom"); return text === "largo" ? "x".repeat(9000) : `eco: ${text}`; },
    texts: () => ({ welcome: "BIENVENIDO", failed: "FALLÓ", backlog: "IGNORÉ" }), onChange: () => { changes++; }, fetch: fake, pollSeconds: 0,
  });
  const last = () => world.sent.at(-1);

  assert.strictEqual(await tg.verify(GOOD), "nimbo_prueba_bot");
  await assert.rejects(tg.verify("123456789:" + "B".repeat(35)), (e) => e.code === 401 && !e.message.includes("BBBB")); // token malo: sin el token en el error
  await assert.rejects(tg.verify("basura"), /formato/);

  // 1) Sin vincular y sin vinculación en curso: nadie recibe respuesta.
  say(777, "hola"); await tg.pollOnce();
  assert.deepStrictEqual([world.sent.length, heard.length, mine], [0, 0, 0]);
  // 2) Vinculación: un código ajeno no sirve, y a los 5 intentos se cancela.
  const code = tg.pair();
  assert.match(code, /^\d{6}$/);
  assert.strictEqual(tg.status().pairing, code);
  for (let i = 0; i < 5; i++) say(777, i === 4 ? code === "000000" ? "111111" : "000000" : "123456");
  await tg.pollOnce();
  assert.deepStrictEqual([tg.status().pairing, mine, world.sent.length], ["", 0, 0]); // cancelada, y ni un solo mensaje de vuelta
  // 3) Una nueva vinculación con el código bueno, desde la cuenta 111.
  const code2 = tg.pair();
  say(222, "texto cualquiera"); say(111, ` ${code2} `); await tg.pollOnce();
  assert.deepStrictEqual([mine, last().chat, last().text, tg.status().paired], [111, 111, "BIENVENIDO", true]);
  // 4) Ya vinculado: solo la cuenta 111, solo texto privado de personas.
  world.sent.length = 0;
  say(222, "intruso"); say(111, "hola Nimbo");
  world.updates.push({ update_id: world.nextId++, message: { chat: { id: 111, type: "group" }, from: { id: 111, is_bot: false }, text: "en un grupo" } });
  world.updates.push({ update_id: world.nextId++, message: { chat: { id: 111, type: "private" }, from: { id: 111, is_bot: false }, photo: [] } });
  world.updates.push({ update_id: world.nextId++, message: { chat: { id: 111, type: "private" }, from: { id: 111, is_bot: true }, text: "soy un bot" } });
  await tg.pollOnce();
  assert.deepStrictEqual(heard, ["hola Nimbo"]);
  assert.deepStrictEqual(world.sent, [{ chat: 111, text: "eco: hola Nimbo" }]);
  // 5) Si Nimbo falla, se avisa; una respuesta larga se parte; un mensaje enorme se recorta.
  say(111, "explota"); await tg.pollOnce();
  assert.strictEqual(last().text, "FALLÓ");
  world.sent.length = 0; say(111, "largo"); await tg.pollOnce();
  assert.ok(world.sent.length >= 3 && world.sent.every((m) => m.chat === 111 && m.text.length <= MAX_OUT));
  say(111, "z".repeat(5000)); await tg.pollOnce();
  assert.strictEqual(heard.at(-1).length, MAX_IN);
  // 6) Al arrancar se descarta lo pendiente y se avisa si era tuyo; lo ajeno se descarta sin decir nada.
  const n = heard.length; world.sent.length = 0;
  say(111, "mensaje de cuando estaba apagado"); await tg.prime(); await tg.pollOnce();
  assert.deepStrictEqual([heard.length, last().text], [n, "IGNORÉ"]);
  world.sent.length = 0; say(999, "otro"); await tg.prime();
  assert.strictEqual(world.sent.length, 0);
  // 6b) La bandeja: las notas /pendiente recibidas con Nimbo apagado SÍ se anotan; el resto, no; otras cuentas, nada.
  assert.deepStrictEqual(["/pendiente comprar  pan", "/p llamar a Juan", "/anotar x", "/tarea@mi_bot y", "/pendiente", "hola", "/pendientes", "/plan", "pendiente sin barra", null].map(parseInbox),
    ["comprar pan", "llamar a Juan", "x", "y", "", null, null, null, null, null]);
  assert.strictEqual(parseInbox("/pendiente " + "z".repeat(500)).length, 200);
  const notes = [];
  const tg2 = createTelegram({ token: () => GOOD, chatId: () => 111, setChatId() {}, onMessage: async () => "", onBacklog: async (list) => { notes.push(...list); return `ANOTÉ ${list.length}`; },
    texts: () => ({ welcome: "", failed: "", backlog: "IGNORÉ" }), fetch: fake, pollSeconds: 0 });
  world.sent.length = 0;
  say(111, "/pendiente comprar pan"); say(111, "/p llamar a Juan"); say(111, "ejecuta algo peligroso"); say(999, "/pendiente de un intruso");
  await tg2.prime();
  assert.deepStrictEqual(notes, ["/pendiente comprar pan", "/p llamar a Juan"]);
  assert.deepStrictEqual(world.sent, [{ chat: 111, text: "ANOTÉ 2\n\nIGNORÉ" }]); // una sola respuesta; "ejecuta algo peligroso" no se ejecutó
  assert.strictEqual(heard.filter((x) => /peligroso|intruso/.test(x)).length, 0);
  // Solo notas: sin aviso de "ignoré". Sin nada pendiente: silencio.
  world.sent.length = 0; notes.length = 0; say(111, "/pendiente solo esta"); await tg2.prime();
  assert.deepStrictEqual([notes.length, world.sent[0].text], [1, "ANOTÉ 1"]);
  world.sent.length = 0; await tg2.prime();
  assert.strictEqual(world.sent.length, 0);
  // 7) Token inválido o bot borrado: la espera lanza 401 (el ciclo se detiene y avisa).
  world.failMode = 401;
  await assert.rejects(tg.pollOnce(), (e) => e.code === 401);
  world.failMode = null;
  assert.ok(changes >= 2);
  // 7b) notify: solo a la cuenta vinculada y solo si está atendiendo Telegram.
  world.sent.length = 0;
  assert.strictEqual(tg.notify("hola"), false); // aún no arrancó (start() no se llamó)
  const tg3 = createTelegram({ token: () => GOOD, chatId: () => 0, setChatId() {}, onMessage: async () => "", texts: () => ({}), fetch: fake, pollSeconds: 0 });
  tg3.start(); assert.strictEqual(tg3.notify("sin cuenta"), false); tg3.stop();
  assert.strictEqual(world.sent.length, 0);
  // 8) Sin token no se puede vincular.
  assert.strictEqual(createTelegram({ token: () => "", chatId: () => 0, setChatId() {}, onMessage: async () => "", texts: () => ({}) }).pair(), "");
  console.log("telegram.js ok");
})();

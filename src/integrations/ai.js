// Otras IAs en el chat de Nimbo (opcional): además de Claude, la misma ventana de chat puede hablar con
//   · Ollama (modelos LOCALES, gratis, sin clave: el texto no sale de tu PC),
//   · Gemini (la clave que sacas gratis en Google AI Studio; Google decide sus límites),
//   · OpenAI (de pago).
// Los tres hablan el mismo protocolo ("chat/completions" de OpenAI), así que hay UN solo adaptador. Un modelo
// de estos es solo conversación: no tiene tus archivos, recordatorios ni otros chats (eso lo hace Claude, con
// sus herramientas cerradas), y las imágenes y archivos adjuntos siguen yendo a Claude.
// Las claves las guarda main.js cifradas por Windows; aquí solo se usan y nunca salen en un error.
const { pickLocal } = require("./whatsapp");

const PRESETS = {
  ollama: { label: "Ollama", base: "http://127.0.0.1:11434/v1", keyless: true },
  gemini: { label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};
const KEYED = ["gemini", "openai"];
const KEY_FORMAT = /^[A-Za-z0-9_.-]{20,200}$/;
const MAX_HISTORY = 12; // mensajes (6 idas y vueltas) que se le repiten al modelo
const MAX_REPLY = 4000;

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** Lo último de la conversación, empezando siempre por un mensaje tuyo. */
function trimHistory(history, max = MAX_HISTORY) {
  const ok = (Array.isArray(history) ? history : []).filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string");
  const last = ok.slice(-max);
  while (last.length && last[0].role !== "user") last.shift();
  return last;
}
const buildMessages = (system, history, text) => [{ role: "system", content: system }, ...trimHistory(history), { role: "user", content: str(text, 6000) }];

/** El texto de la respuesta, o null si no tiene la forma esperada. */
function cleanReply(j) {
  const c = j?.choices?.[0]?.message?.content;
  const text = typeof c === "string" ? c.trim() : "";
  return text ? text.slice(0, MAX_REPLY) : null;
}

/**
 * @param getKey   (id) => la clave guardada de ese proveedor ("" = ninguna)
 * @param models   () => { ollama?, gemini?, openai? } nombres de modelo que el usuario fijó en prefs
 * @param bases    (solo pruebas) direcciones alternativas por proveedor
 */
function createAi({ getKey, models = () => ({}), bases = {}, fetch: doFetch = fetch }) {
  const base = (id) => bases[id] ?? PRESETS[id].base;

  /** El modelo local que se usaría: el que fijó el usuario o el más adecuado de los instalados. */
  async function ollama() {
    const origin = new URL(base("ollama")).origin;
    try {
      const j = await (await doFetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(1500) })).json();
      const have = Array.isArray(j.models) ? j.models : [];
      const fixed = str(models().ollama, 80);
      return { state: have.length ? "ok" : "empty", model: fixed || pickLocal(have) || have[0]?.name || null };
    } catch { return { state: "off", model: null }; }
  }

  return {
    /** Qué hay disponible ahora mismo (sin contar a Claude, que va aparte). */
    async status() {
      const local = await ollama();
      const providers = [];
      if (local.model) providers.push({ id: "ollama", label: PRESETS.ollama.label, model: local.model });
      for (const id of KEYED) if (getKey(id)) providers.push({ id, label: PRESETS[id].label, model: str(models()[id], 80) || PRESETS[id].model });
      return { providers, ollama: local.state, keyed: Object.fromEntries(KEYED.map((id) => [id, !!getKey(id)])) };
    },

    /** Un mensaje. { text, model } o { error: "key" | "limit" | "model" | "offline" | "fail" }. */
    async chat(id, history, text, system) {
      const preset = PRESETS[id];
      if (!preset) return { error: "fail" };
      const model = id === "ollama" ? (await ollama()).model : str(models()[id], 80) || preset.model;
      if (!model) return { error: "model" };
      const key = preset.keyless ? "" : getKey(id);
      if (!preset.keyless && !key) return { error: "key" };
      let r;
      try {
        r = await doFetch(`${base(id)}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ model, messages: buildMessages(system, history, text), temperature: 0.7, max_tokens: 900, stream: false }),
          signal: AbortSignal.timeout(id === "ollama" ? 120_000 : 60_000), // un modelo local tarda en cargar la primera vez
        });
      } catch { return { error: "offline" }; }
      if (r.status === 401 || r.status === 403) return { error: "key" };
      if (r.status === 429) return { error: "limit" };
      if (r.status === 404) return { error: "model" };
      if (!r.ok) return { error: "fail" };
      const reply = cleanReply(await r.json().catch(() => null));
      return reply ? { text: reply, model } : { error: "fail" };
    },

    /** ¿Acepta el proveedor esta clave? (pide su lista de modelos: no gasta nada). */
    async verify(id, key) {
      if (!KEYED.includes(id) || !KEY_FORMAT.test(key ?? "")) return false;
      try { return (await doFetch(`${base(id)}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })).ok; } catch { return false; }
    },
  };
}

module.exports = { createAi, trimHistory, buildMessages, cleanReply, KEYED, KEY_FORMAT, PRESETS };

// Autoprueba (sin internet, con servidores de mentira en tu PC): `node src/integrations/ai.js`
if (require.main === module) (async () => {
  const assert = require("assert");
  const http = require("http");
  const turns = (...roles) => roles.map((r, i) => ({ role: r, content: `m${i}` }));
  assert.deepStrictEqual(trimHistory(turns("user", "assistant", "user")).map((m) => m.content), ["m0", "m1", "m2"]);
  assert.deepStrictEqual(trimHistory(turns("assistant", "user")).map((m) => m.content), ["m1"]); // nunca empieza por la IA
  assert.strictEqual(trimHistory(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }))).length, MAX_HISTORY);
  assert.deepStrictEqual(trimHistory([{ role: "system", content: "no" }, { role: "user" }, null, "texto"]), []); // solo user/assistant con texto
  assert.deepStrictEqual(buildMessages("S", turns("user", "assistant"), "hola").map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.strictEqual(cleanReply({ choices: [{ message: { content: "  hola " } }] }), "hola");
  for (const bad of [null, {}, { choices: [] }, { choices: [{ message: { content: "" } }] }, { choices: [{ message: { content: 5 } }] }]) assert.strictEqual(cleanReply(bad), null);
  assert.strictEqual(cleanReply({ choices: [{ message: { content: "z".repeat(9000) } }] }).length, MAX_REPLY);
  assert.ok(KEY_FORMAT.test("AIzaSyA-1234567890abcdefghijklmnop") && !KEY_FORMAT.test("corta") && !KEY_FORMAT.test("con espacio 1234567890123456789"));

  // Un servidor "compatible con OpenAI": comprueba la clave y devuelve lo que se le pida.
  const seen = [];
  let tags = [{ name: "llama3.2:3b", size: 2e9 }];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization ?? null, body: body ? JSON.parse(body) : null });
      const send = (code, json) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.url === "/api/tags") return send(200, { models: tags });
      const key = (req.headers.authorization ?? "").replace("Bearer ", "");
      if (req.url.startsWith("/gem/")) { if (key !== "GOOD-KEY-1234567890-abcdef") return send(401, { error: "no" }); if (req.url.endsWith("/models")) return send(200, { data: [] }); }
      if (req.url.startsWith("/lim/")) return send(429, {});
      if (req.url.startsWith("/nomodel/")) return send(404, {});
      if (req.url.startsWith("/rota/")) return send(200, { nada: true });
      send(200, { choices: [{ message: { role: "assistant", content: `respuesta de ${body ? JSON.parse(body).model : "?"}` } }] });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let key = "GOOD-KEY-1234567890-abcdef";
  const make = (extra = {}) => createAi({ getKey: (id) => (id === "gemini" ? key : ""), models: () => ({}), bases: { ollama: `${origin}/ol`, gemini: `${origin}/gem`, openai: `${origin}/oai`, ...extra } });
  const ai = make();

  // Ollama: sin clave, con el modelo local detectado.
  const s1 = await ai.status();
  assert.deepStrictEqual(s1.providers.map((p) => `${p.id}:${p.model}`), ["ollama:llama3.2:3b", "gemini:gemini-2.5-flash"]);
  assert.deepStrictEqual(s1.keyed, { gemini: true, openai: false });
  const r1 = await ai.chat("ollama", turns("user", "assistant"), "hola", "SISTEMA");
  assert.deepStrictEqual(r1, { text: "respuesta de llama3.2:3b", model: "llama3.2:3b" });
  const call = seen.find((x) => x.url === "/ol/chat/completions");
  assert.strictEqual(call.auth, null); // el modelo local no recibe ninguna clave
  assert.deepStrictEqual(call.body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.strictEqual(call.body.messages[0].content, "SISTEMA");
  assert.strictEqual(call.body.stream, false);
  // Gemini: la clave va como Bearer y NUNCA aparece en un error.
  assert.strictEqual((await ai.chat("gemini", [], "hola", "S")).text, "respuesta de gemini-2.5-flash");
  assert.strictEqual(seen.at(-1).auth, "Bearer GOOD-KEY-1234567890-abcdef");
  key = "BAD-KEY-1234567890-abcdefgh";
  const bad = await ai.chat("gemini", [], "hola", "S");
  assert.deepStrictEqual(bad, { error: "key" });
  assert.ok(!JSON.stringify(bad).includes("BAD-KEY"));
  key = "GOOD-KEY-1234567890-abcdef";
  // Errores de cada tipo, y sin clave ni modelo.
  assert.deepStrictEqual(await make({ gemini: `${origin}/lim` }).chat("gemini", [], "x", "S"), { error: "limit" });
  assert.deepStrictEqual(await make({ gemini: `${origin}/nomodel` }).chat("gemini", [], "x", "S"), { error: "model" });
  assert.deepStrictEqual(await make({ gemini: `${origin}/rota` }).chat("gemini", [], "x", "S"), { error: "fail" });
  assert.deepStrictEqual(await make({ gemini: "http://127.0.0.1:1/x" }).chat("gemini", [], "x", "S"), { error: "offline" });
  assert.deepStrictEqual(await ai.chat("openai", [], "x", "S"), { error: "key" }); // sin clave de OpenAI
  assert.deepStrictEqual(await ai.chat("otra", [], "x", "S"), { error: "fail" });
  tags = []; // Ollama sin ningún modelo instalado
  const s2 = await ai.status();
  assert.deepStrictEqual([s2.ollama, s2.providers.map((p) => p.id)], ["empty", ["gemini"]]);
  assert.deepStrictEqual(await ai.chat("ollama", [], "x", "S"), { error: "model" });
  // Ollama apagado.
  const off = createAi({ getKey: () => "", bases: { ollama: "http://127.0.0.1:1/ol" } });
  assert.deepStrictEqual([(await off.status()).ollama, (await off.status()).providers.length], ["off", 0]);
  // verify: acepta la clave buena, rechaza la mala y la de forma rara (sin llamar).
  assert.strictEqual(await ai.verify("gemini", "GOOD-KEY-1234567890-abcdef"), true);
  assert.strictEqual(await ai.verify("gemini", "BAD-KEY-1234567890-abcdefgh"), false);
  assert.strictEqual(await ai.verify("gemini", "corta"), false);
  assert.strictEqual(await ai.verify("ollama", "GOOD-KEY-1234567890-abcdef"), false);
  // El modelo que fija el usuario manda.
  assert.strictEqual((await createAi({ getKey: () => "", models: () => ({ ollama: "qwen2.5:7b" }), bases: { ollama: `${origin}/ol` } }).chat("ollama", [], "x", "S")).model, "qwen2.5:7b");
  server.close();
  console.log("ai.js ok");
})();

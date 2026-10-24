// Claude por la API (opcional): en vez de lanzar `claude -p` (la suscripción), Nimbo le habla a la API de Claude con TU clave, así gasta los créditos
// de API que trae el plan Max/Team y no el cupo de tu suscripción, y responde más rápido (sin arrancar la app de línea de comandos).
// Se usa el SDK oficial (`@anthropic-ai/sdk`). Solo se usa donde el dueño lo eligió (menú "Motor de Nimbo"): el texto va directo a Anthropic, igual que con `claude`.
// La clave la guarda main.js cifrada por el sistema (ai-keys.bin, id "anthropic"); aquí solo se usa y NUNCA sale en un error.
const fs = require("fs");
const path = require("path");
// El SDK se carga recién cuando se usa (pesa ~0,3 s al arrancar y solo lo necesita quien eligió el motor API).
let SDK;
const sdk = () => (SDK ??= ((m) => m.default ?? m)(require("@anthropic-ai/sdk")));

const SONNET = "claude-sonnet-5-5"; // el chat de Nimbo (decisión del dueño: todo en Sonnet)
const HAIKU = "claude-haiku-5-5"; // extracciones baratas (resúmenes de WhatsApp)
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".yml", ".yaml", ".html", ".css", ".js", ".ts", ".py", ".sql", ".java", ".c", ".cpp", ".cs", ".go", ".rb", ".php", ".sh", ".ps1", ".ini", ".toml"]);
const MAX_TEXT_FILE = 100 * 1024;
const MAX_PDF = 10 * 1024 * 1024;
const MAX_HISTORY = 12;

/** El modelo del chat según prefs.chatModel ("haiku" | "opus" | otra cosa = Sonnet). Fable queda fuera: cuesta el doble. */
const chatModelId = (pref) => (pref === "haiku" ? HAIKU : pref === "opus" ? "claude-opus-5-5" : SONNET);

/** El mismo esquema con `additionalProperties: false` en cada objeto (lo exige la API para las salidas estructuradas). */
function strictSchema(schema) {
  const walk = (s) => {
    if (Array.isArray(s)) return s.map(walk);
    if (!s || typeof s !== "object") return s;
    const out = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, walk(v)]));
    if (out.type === "object" && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(schema);
}

/**
 * El contenido de un mensaje del usuario: texto + imágenes (base64) + archivos adjuntos que la API puede leer sin herramientas
 * (texto/código ≤ 100 KB y PDF ≤ 10 MB). Lo demás no se lee en este modo y se le dice a Claude para que lo avise.
 */
function userContent({ text, images = [], files = [] }) {
  const blocks = [];
  const skipped = [];
  for (const img of images) {
    if (IMAGE_TYPES.includes(img?.media_type) && typeof img.data === "string") blocks.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  }
  for (const file of files) {
    const name = path.basename(String(file));
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const ext = path.extname(name).toLowerCase();
    try {
      if (TEXT_EXT.has(ext) && st.size <= MAX_TEXT_FILE) blocks.push({ type: "text", text: `Archivo adjunto "${name}":\n${fs.readFileSync(file, "utf8")}` });
      else if (ext === ".pdf" && st.size <= MAX_PDF) blocks.push({ type: "document", title: name, source: { type: "base64", media_type: "application/pdf", data: fs.readFileSync(file).toString("base64") } });
      else skipped.push(name);
    } catch { skipped.push(name); }
  }
  const note = skipped.length ? `\n\n(No puedo leer estos adjuntos en este modo: ${skipped.join(", ")}. Dile al usuario que los lea el motor "Suscripción" del menú.)` : "";
  blocks.push({ type: "text", text: String(text ?? "") + note });
  return blocks;
}

/** Lo último de la conversación (solo texto), empezando siempre por el usuario. */
function trimHistory(history, max = MAX_HISTORY) {
  const last = history.slice(-max);
  while (last.length && last[0].role !== "user") last.shift();
  return last;
}

/** Un error del SDK → { "key" | "limit" | "billing" | "model" | "offline" | "fail" }, sin mostrar nunca la clave. */
function errorCode(e) {
  if (e instanceof sdk().APIUserAbortError) return "cancelled"; // el usuario pulsó Cancelar
  if (e instanceof sdk().AuthenticationError || e instanceof sdk().PermissionDeniedError) return "key";
  if (e instanceof sdk().RateLimitError || e?.status === 529) return "limit";
  if (e?.status === 402 || (e instanceof sdk().BadRequestError && /credit balance|billing/i.test(String(e.message)))) return "billing";
  if (e instanceof sdk().NotFoundError) return "model";
  if (e instanceof sdk().APIConnectionError) return "offline";
  return "fail";
}

/**
 * @param getKey   () => la clave guardada ("" = ninguna)
 * @param baseURL  (solo pruebas) dirección alternativa
 */
function createClaudeApi({ getKey, baseURL }) {
  let client = null;
  let clientKey = "";
  const get = () => {
    const key = getKey();
    if (!key) return null;
    if (!client || clientKey !== key) { client = new (sdk())({ apiKey: key, baseURL, maxRetries: 1, timeout: 90_000 }); clientKey = key; }
    return client;
  };
  return {
    has: () => !!getKey(),

    /** ¿Acepta Anthropic esta clave? (pide la lista de modelos: no gasta nada). */
    async verify(key) {
      try { await new (sdk())({ apiKey: key, baseURL, maxRetries: 0, timeout: 10_000 }).models.list({ limit: 1 }); return true; } catch { return false; }
    },

    /** Una respuesta con forma fija (JSON que cumple `schema`). → { data, usage, model } o { error }. */
    async structured({ model, system, messages, schema, maxTokens = 2000, effort = "low", signal }) {
      const c = get();
      if (!c) return { error: "key" };
      try {
        const r = await c.messages.create({ model, max_tokens: maxTokens, system, messages, output_config: { effort, format: { type: "json_schema", schema: strictSchema(schema) } } }, { signal });
        if (r.stop_reason === "refusal") return { error: "refusal" };
        if (r.stop_reason === "max_tokens") return { error: "fail" };
        const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        let data;
        try { data = JSON.parse(text); } catch { return { error: "fail" }; }
        return { data, usage: r.usage, model: r.model };
      } catch (e) { return { error: errorCode(e) }; }
    },
  };
}

module.exports = { createClaudeApi, strictSchema, userContent, trimHistory, errorCode, chatModelId, SONNET, HAIKU };

// Autoprueba (sin internet, con un servidor de mentira): `node src/integrations/claude-api.js`
if (require.main === module) (async () => {
  const assert = require("assert");
  const http = require("http");
  const os = require("os");
  // strictSchema: agrega additionalProperties:false a cada objeto, también a los anidados, sin tocar lo demás.
  const s = strictSchema({ type: "object", properties: { a: { type: "array", items: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] } } } });
  assert.strictEqual(s.additionalProperties, false);
  assert.strictEqual(s.properties.a.items.additionalProperties, false);
  assert.strictEqual(s.properties.a.additionalProperties, undefined);
  assert.deepStrictEqual([chatModelId("haiku"), chatModelId("sonnet"), chatModelId(""), chatModelId("opus")], [HAIKU, SONNET, SONNET, "claude-opus-5-5"]);
  // trimHistory: empieza por el usuario y recorta.
  const h = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
  assert.strictEqual(trimHistory(h).length, MAX_HISTORY);
  assert.deepStrictEqual(trimHistory([{ role: "assistant", content: "a" }, { role: "user", content: "b" }]).map((m) => m.content), ["b"]);
  // userContent: imágenes válidas, texto/código y PDF se leen, lo demás se avisa.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-capi-"));
  fs.writeFileSync(path.join(tmp, "nota.txt"), "hola");
  fs.writeFileSync(path.join(tmp, "doc.pdf"), "%PDF-1.4");
  fs.writeFileSync(path.join(tmp, "foto.psd"), "x");
  fs.writeFileSync(path.join(tmp, "enorme.txt"), "y".repeat(MAX_TEXT_FILE + 1));
  const blocks = userContent({ text: "mira", images: [{ media_type: "image/png", data: "AAAA" }, { media_type: "image/bmp", data: "AAAA" }, { data: 5 }],
    files: [path.join(tmp, "nota.txt"), path.join(tmp, "doc.pdf"), path.join(tmp, "foto.psd"), path.join(tmp, "enorme.txt"), path.join(tmp, "no-existe.txt")] });
  assert.deepStrictEqual(blocks.map((b) => b.type), ["image", "text", "document", "text"]);
  assert.ok(blocks[1].text.includes('"nota.txt"') && blocks[1].text.includes("hola"));
  assert.ok(blocks[3].text.startsWith("mira") && blocks[3].text.includes("foto.psd") && blocks[3].text.includes("enorme.txt") && !blocks[3].text.includes("no-existe"));
  fs.rmSync(tmp, { recursive: true, force: true });

  // Un servidor de mentira con la forma de la API de Claude.
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = body ? JSON.parse(body) : null;
      // El SDK 1.x manda la clave como "Authorization: Bearer"; las versiones anteriores, como "x-api-key": el servidor de mentira acepta las dos.
      const got = req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace("Bearer ", "");
      seen.push({ url: req.url, key: got, body: j });
      const send = (code, json) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
      const err = (code, type, message) => send(code, { type: "error", error: { type, message } });
      if (got !== "sk-ant-BUENA-1234567890abcdef") return err(401, "authentication_error", "invalid x-api-key");
      if (req.url.startsWith("/v1/models")) return send(200, { data: [{ type: "model", id: SONNET, display_name: "S", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: SONNET, last_id: SONNET });
      const ask = j?.messages?.at(-1)?.content;
      const text = typeof ask === "string" ? ask : ask?.at(-1)?.text;
      if (text === "limite") return err(429, "rate_limit_error", "slow down");
      if (text === "sin creditos") return err(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.");
      if (text === "sin modelo") return err(404, "not_found_error", "model: nope");
      if (text === "roto") return err(500, "api_error", "boom");
      const msg = (stop, content) => send(200, { id: "msg_1", type: "message", role: "assistant", model: j.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
      if (text === "rechazo") return msg("refusal", []);
      if (text === "corta") return msg("max_tokens", [{ type: "text", text: '{"reply":"se cor' }]);
      if (text === "basura") return msg("end_turn", [{ type: "text", text: "no es json" }]);
      return msg("end_turn", [{ type: "text", text: JSON.stringify({ reply: "56." }) }]);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  let key = "sk-ant-BUENA-1234567890abcdef";
  const api = createClaudeApi({ getKey: () => key, baseURL });
  const schema = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] };
  const call = (text) => api.structured({ model: SONNET, system: "S", messages: [{ role: "user", content: text }], schema });

  assert.strictEqual(api.has(), true);
  assert.strictEqual(await api.verify("sk-ant-BUENA-1234567890abcdef"), true);
  assert.strictEqual(await api.verify("sk-ant-MALA-1234567890abcdefghij"), false);
  const ok = await call("7 por 8");
  assert.deepStrictEqual(ok.data, { reply: "56." });
  const sent = seen.at(-1);
  assert.strictEqual(sent.url, "/v1/messages");
  assert.deepStrictEqual([sent.body.model, sent.body.system, sent.body.output_config.effort, sent.body.output_config.format.type], [SONNET, "S", "low", "json_schema"]);
  assert.strictEqual(sent.body.output_config.format.schema.additionalProperties, false); // el esquema va estricto
  assert.ok(!("thinking" in sent.body) && !("temperature" in sent.body)); // Sonnet 5.5: nada de parámetros que la API rechaza
  assert.deepStrictEqual(await call("limite"), { error: "limit" });
  assert.deepStrictEqual(await call("sin creditos"), { error: "billing" });
  assert.deepStrictEqual(await call("sin modelo"), { error: "model" });
  assert.deepStrictEqual(await call("roto"), { error: "fail" });
  assert.deepStrictEqual(await call("rechazo"), { error: "refusal" });
  // Cancelar: la señal corta la petición y el resultado es "cancelled", no un fallo.
  const stop = new AbortController();
  const pendiente = api.structured({ model: SONNET, system: "S", messages: [{ role: "user", content: "x" }], schema, signal: stop.signal });
  stop.abort();
  assert.deepStrictEqual(await pendiente, { error: "cancelled" });
  assert.deepStrictEqual(await call("corta"), { error: "fail" });
  assert.deepStrictEqual(await call("basura"), { error: "fail" });
  // Clave mala: error "key" y la clave NUNCA aparece en el resultado.
  key = "sk-ant-MALA-1234567890abcdefghij";
  const bad = await call("hola");
  assert.deepStrictEqual(bad, { error: "key" });
  assert.ok(!JSON.stringify(bad).includes("MALA"));
  key = "";
  assert.strictEqual(api.has(), false);
  assert.deepStrictEqual(await call("hola"), { error: "key" }); // sin clave ni se llama
  // Sin conexión.
  key = "sk-ant-BUENA-1234567890abcdef";
  assert.deepStrictEqual(await createClaudeApi({ getKey: () => key, baseURL: "http://127.0.0.1:1" }).structured({ model: HAIKU, system: "S", messages: [{ role: "user", content: "x" }], schema }), { error: "offline" });
  server.close();
  console.log("claude-api.js ok");
})();

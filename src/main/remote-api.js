// API para el celular: Nimbo en el iPhone (la app del asistente) llega por el puente de ese repo, que corre en
// este mismo PC y llama aquí. Da el estado de los chats, el permiso pendiente, los pendientes, y deja hablar con
// Nimbo, mandar sus encargos y decidir el permiso.
//
// Seguridad:
//   · Solo escucha en 127.0.0.1 y solo acepta Host 127.0.0.1:<puerto> (contra DNS rebinding). NUNCA se publica
//     por Tailscale: al teléfono lo atiende el puente, con su propio token.
//   · Token propio (no el HMAC de los hooks), aleatorio, en <userData>/remote-token; comparado en tiempo constante.
//   · Cuerpos de máximo 16 KB. Un permiso se decide solo con el id aleatorio de su tarjeta y solo allow/deny
//     ("siempre" queda para la isla).
//   · Los encargos que propone Nimbo se guardan aquí: el teléfono los ve completos, pero para mandarlos solo envía
//     el id, nunca el texto ni el chat.
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = 47824;
const MAX_BODY = 16 * 1024;
const MAX_CHATS = 12;
const STALE_MS = 6 * 3600_000; // un chat sin eventos en 6 h deja de listarse

// Lo mismo que hace la isla con cada hook (handle() en app.js).
const STATES = {
  SessionStart: "idle", UserPromptSubmit: "thinking", PreToolUse: "working", PostToolUse: "working",
  PostToolUseFailure: "working", Notification: "needs", PermissionRequest: "needs", Stop: "finished", StopFailure: "error",
};

function readToken(file) {
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const token = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createRemoteApi({ tokenFile, ask, dispatch, reminders, remindersChanged, permission, decide, now = Date.now }) {
  const token = readToken(tokenFile);
  const chats = new Map(); // session_id → { id, title, state, step, at }
  const proposals = new Map(); // id → encargo propuesto en la última respuesta de Nimbo
  const results = []; // lo que respondieron los chats a los encargos mandados desde el celular (los 5 últimos)

  function onHook(p) {
    const id = String(p?.session_id ?? "");
    if (!id) return;
    if (p.hook_event_name === "SessionEnd") return void chats.delete(id);
    const state = STATES[p.hook_event_name];
    if (!state) return;
    const tool = p.hook_event_name === "PreToolUse" || p.hook_event_name === "PostToolUseFailure";
    const step = tool ? String(p.tool_name ?? "").slice(0, 40) : state === "working" ? chats.get(id)?.step ?? "" : "";
    chats.set(id, { id, title: String(p.title || "Claude").slice(0, 80), state, step, at: now() });
  }

  function status() {
    const cutoff = now() - STALE_MS;
    for (const [id, c] of chats) if (c.at < cutoff) chats.delete(id);
    const p = permission();
    return {
      chats: [...chats.values()].sort((a, b) => b.at - a.at).slice(0, MAX_CHATS)
        .map((c) => ({ ...c, at: new Date(c.at).toISOString() })),
      // Todo lo que se aprueba, sin recortar: la misma regla que la tarjeta de la isla.
      permission: p ? { id: p.id, chat: String(p.payload?.title || "Claude"), tool: String(p.payload?.tool_name ?? ""), input: p.payload?.tool_input ?? {} } : null,
      pending: reminders.pending().map((r) => ({ id: String(r.id), text: String(r.text), due: r.due || "" })),
      results: [...results],
    };
  }

  async function route(method, url, body) {
    if (method === "GET" && url === "/estado") return [200, status()];
    if (method !== "POST") return [404, { error: "No existe" }];
    switch (url) {
      case "/pedir": {
        const text = String(body?.texto ?? "").trim().slice(0, 4000);
        if (!text) return [400, { error: "Falta el texto" }];
        const r = await ask({ text });
        proposals.clear();
        const shown = (r.dispatch ?? []).slice(0, 6).map((d) => {
          const id = crypto.randomUUID();
          proposals.set(id, d);
          return { id, chat: String(d.title || d.project || "Claude"), prompt: String(d.prompt ?? "") };
        });
        return [200, { reply: String(r.text ?? ""), proposals: shown, added: (r.added ?? []).map((x) => String(x.text)) }];
      }
      case "/enviar": {
        const id = String(body?.id ?? "");
        const d = proposals.get(id);
        if (!d) return [404, { error: "Ese encargo ya no está: pídeselo de nuevo a Nimbo." }];
        proposals.delete(id);
        const chat = String(d.title || d.project || "Claude");
        // Un encargo puede tardar minutos: se responde ya y el resultado aparece en el estado.
        const remember = (text) => {
          results.unshift({ chat, text: String(text ?? "").slice(0, 1000), at: new Date(now()).toISOString() });
          results.length = Math.min(results.length, 5);
        };
        Promise.resolve(dispatch(d.session, d.prompt)).then((r) => remember(r?.text), () => remember("No pude mandarlo."));
        return [202, { sent: true, chat }];
      }
      case "/permiso": {
        const decision = String(body?.decision ?? "");
        if (!["allow", "deny"].includes(decision)) return [400, { error: "Decisión inválida" }];
        const p = permission();
        if (!p || p.id !== String(body?.id ?? "")) return [409, { error: "Ese permiso ya se decidió o se venció." }];
        decide(p.id, decision);
        return [200, { ok: true }];
      }
      case "/hecho": {
        const id = String(body?.id ?? "");
        if (!reminders.pending().some((r) => String(r.id) === id)) return [404, { error: "Ese pendiente ya no está." }];
        reminders.complete(id);
        remindersChanged();
        return [200, { ok: true }];
      }
      case "/pendiente": {
        const text = String(body?.texto ?? "").trim().slice(0, 300);
        if (!text) return [400, { error: "Falta el texto" }];
        const added = reminders.add({ text, due: "" });
        remindersChanged();
        return [200, { ok: Boolean(added) }];
      }
    }
    return [404, { error: "No existe" }];
  }

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      if (res.writableEnded) return;
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.host !== `127.0.0.1:${server.address()?.port}`) return send(404, { error: "No existe" });
    const auth = String(req.headers.authorization ?? "");
    if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), token)) return send(401, { error: "Token inválido" });
    let raw = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      if (tooBig) return;
      raw += chunk;
      if (raw.length > MAX_BODY) { tooBig = true; send(413, { error: "Demasiado largo" }); }
    });
    req.on("end", async () => {
      if (tooBig) return;
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: "JSON inválido" }); } }
      try {
        const [code, obj] = await route(req.method, req.url, body);
        send(code, obj);
      } catch {
        send(500, { error: "Nimbo no pudo hacerlo." });
      }
    });
  });
  // Si el puerto está ocupado (otro Nimbo abierto), esta API no arranca y el resto de Nimbo sigue igual.
  server.on("error", () => {});
  return { onHook, status, server, listen: (port = PORT) => server.listen(port, "127.0.0.1") };
}

module.exports = { createRemoteApi, PORT };

// Autoprueba: `node src/main/remote-api.js`
if (require.main === module) {
  const assert = require("assert");
  const os = require("os");
  const tokenFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nimbo-remote-")), "remote-token");
  let clock = 1_000_000;
  let pending = null;
  const decided = [];
  const dispatched = [];
  const list = [{ id: "r1", text: "Comprar pilas", due: "" }];
  const reminders = {
    pending: () => list,
    complete: (id) => list.splice(list.findIndex((r) => r.id === id), 1),
    add: (r) => { const x = { id: `r${list.length + 2}`, ...r }; list.push(x); return x; },
  };
  let changed = 0;
  const api = createRemoteApi({
    tokenFile,
    ask: async ({ text }) => ({ text: `Te oí: ${text}`, dispatch: [{ session: "s9", prompt: "Corre las pruebas", title: "Tienda web", project: "tienda" }], added: [] }),
    dispatch: async (session, prompt) => { dispatched.push([session, prompt]); return { text: "Listo, pasan." }; },
    reminders,
    remindersChanged: () => changed++,
    permission: () => pending,
    decide: (id, d) => { decided.push([id, d]); pending = null; },
    now: () => clock,
  });
  const token = fs.readFileSync(tokenFile, "utf8");
  api.listen(0).on("listening", async () => {
    const base = `http://127.0.0.1:${api.server.address().port}`;
    const call = (url, body, auth = token) => fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => [r.status, await r.json()]);
    try {
      assert.ok(token.length >= 32);
      assert.strictEqual((await call("/estado", null, "otro"))[0], 401);
      // Otro Host (DNS rebinding): no se atiende aunque traiga el token.
      const rebound = await new Promise((ok) => http.get({ host: "127.0.0.1", port: api.server.address().port, path: "/estado",
        headers: { host: "evil.example:80", authorization: `Bearer ${token}` } }, (r) => ok(r.statusCode)));
      assert.strictEqual(rebound, 404);

      // Estado de los chats según los hooks, del más reciente al más viejo.
      api.onHook({ session_id: "a", hook_event_name: "UserPromptSubmit", title: "Asistente" });
      clock += 1000;
      api.onHook({ session_id: "b", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, title: "Tienda web" });
      api.onHook({ session_id: "b", hook_event_name: "PostToolUse", title: "Tienda web" });
      let [code, st] = await call("/estado");
      assert.strictEqual(code, 200);
      assert.deepStrictEqual(st.chats.map((c) => [c.id, c.state, c.step]), [["b", "working", "Bash"], ["a", "thinking", ""]]);
      assert.ok(!JSON.stringify(st.chats).includes("npm test"), "el estado no lleva comandos");
      api.onHook({ session_id: "a", hook_event_name: "SessionEnd" });
      clock += 7 * 3600_000; // los viejos se van solos
      assert.deepStrictEqual((await call("/estado"))[1].chats, []);

      // Permiso: completo, solo con su id y solo allow/deny.
      pending = { id: "p-1", payload: { title: "Tienda web", tool_name: "Bash", tool_input: { command: "rm -rf build && npm run build" } } };
      st = (await call("/estado"))[1];
      assert.deepStrictEqual(st.permission, { id: "p-1", chat: "Tienda web", tool: "Bash", input: { command: "rm -rf build && npm run build" } });
      assert.strictEqual((await call("/permiso", { id: "p-1", decision: "always" }))[0], 400);
      assert.strictEqual((await call("/permiso", { id: "p-2", decision: "allow" }))[0], 409);
      assert.deepStrictEqual(await call("/permiso", { id: "p-1", decision: "allow" }), [200, { ok: true }]);
      assert.deepStrictEqual(decided, [["p-1", "allow"]]);
      assert.strictEqual((await call("/permiso", { id: "p-1", decision: "deny" }))[0], 409, "una sola vez");

      // Hablar con Nimbo y mandar su encargo solo por id.
      [code, st] = await call("/pedir", { texto: "corre las pruebas de la tienda" });
      assert.strictEqual(code, 200);
      assert.strictEqual(st.reply, "Te oí: corre las pruebas de la tienda");
      assert.strictEqual(st.proposals.length, 1);
      assert.deepStrictEqual([st.proposals[0].chat, st.proposals[0].prompt], ["Tienda web", "Corre las pruebas"]);
      assert.strictEqual((await call("/enviar", { id: "inventado" }))[0], 404);
      assert.deepStrictEqual(await call("/enviar", { id: st.proposals[0].id, prompt: "otra cosa", session: "x" }), [202, { sent: true, chat: "Tienda web" }]);
      await new Promise((r) => setTimeout(r, 10));
      assert.deepStrictEqual(dispatched, [["s9", "Corre las pruebas"]], "el texto sale de lo guardado, no del teléfono");
      assert.strictEqual((await call("/enviar", { id: st.proposals[0].id }))[0], 404, "cada encargo se manda una vez");
      assert.strictEqual((await call("/estado"))[1].results[0].text, "Listo, pasan.");

      // Pendientes.
      assert.deepStrictEqual((await call("/pendiente", { texto: "  Llamar a Macla " }))[0], 200);
      assert.deepStrictEqual((await call("/estado"))[1].pending.map((r) => r.text), ["Comprar pilas", "Llamar a Macla"]);
      assert.deepStrictEqual(await call("/hecho", { id: "r1" }), [200, { ok: true }]);
      assert.strictEqual((await call("/hecho", { id: "r1" }))[0], 404);
      assert.strictEqual(changed, 2);
      assert.strictEqual((await call("/pedir", { texto: "x".repeat(MAX_BODY) }))[0], 413);
      console.log("remote-api: OK");
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    } finally {
      api.server.close();
    }
  });
}

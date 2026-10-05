// Trello: Nimbo le pide a tu `claude` (que ya tiene el conector de Trello de claude.ai)
// tus tarjetas pendientes. Nimbo nunca ve credenciales, y a Claude solo se le dejan las
// herramientas de LECTURA de Trello: no puede crear, mover ni borrar nada.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runClaude } = require("./orchestrator");

const READ_TOOLS = ["trelloReadBoard", "trelloReadCard", "trelloReadList", "trelloReadInbox", "trelloReadMember", "trelloSearch"]
  .map((t) => `mcp__claude_ai_Trello__${t}`);
const WRITE_TOOLS = ["trelloWriteBoard", "trelloWriteCard", "trelloWriteChecklist", "trelloWriteInbox", "trelloWriteList", "trelloWritePlanner"]
  .map((t) => `mcp__claude_ai_Trello__${t}`);

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    boards: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, url: { type: "string" }, pending: { type: "integer" } }, required: ["name", "pending"] } },
    cards: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, board: { type: "string" }, list: { type: "string" }, due: { type: "string" }, url: { type: "string" } },
      required: ["name", "board", "list"] } },
  },
  required: ["boards", "cards"],
});

const PROMPT = `Lee mis tableros de Trello y dime qué tengo PENDIENTE. Usa solo herramientas de lectura.
1. trelloReadBoard (action "list") para mis tableros abiertos; trelloReadCard (action "list_by_board") para las tarjetas abiertas de cada uno; y trelloReadInbox (action "list_cards") para mi Inbox.
2. Una tarjeta es PENDIENTE si está abierta y además: tiene fecha de vencimiento sin completar, o está en una lista que signifique por hacer / pendiente / en progreso / haciendo / bloqueado / backlog / inbox. NO son pendientes las de listas de terminado o de referencia (hecho, done, aprobadas, probadas, completado, épicas, referencia, guía, fuera del alcance, plantillas).
3. Responde con "boards" (cada tablero con cuántas pendientes tiene) y "cards" (máximo 8 pendientes, primero las que vencen antes; "due" en ISO 8601 o vacío; "url" la de la tarjeta).`;

function createTrello(cacheFile) {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {}
  let running = null;

  return {
    cached: () => data,

    /** Consulta Trello a través de Claude (20–60 s). Si falla, conserva lo último que tenía. */
    refresh() {
      running ??= (async () => {
        const args = ["-p", "--output-format", "json", "--json-schema", SCHEMA,
          // Sin herramientas propias (ni leer archivos ni navegar): solo el conector de Trello en
          // lectura. El nombre de una tarjeta lo puede escribir otra persona; no debe poder nada.
          "--tools", "", "--permission-mode", "default", "--no-session-persistence",
          "--allowedTools", ...READ_TOOLS, "--disallowedTools", ...WRITE_TOOLS];
        const cwd = path.join(os.tmpdir(), "nimbo-trello");
        fs.mkdirSync(cwd, { recursive: true });
        const r = await runClaude(args, { cwd, input: PROMPT });
        let out = r.structured_output;
        if (!out && r.result) { try { out = JSON.parse(r.result); } catch {} }
        if (out && Array.isArray(out.boards) && Array.isArray(out.cards)) {
          data = { at: new Date().toISOString(), boards: out.boards.slice(0, 10), cards: out.cards.slice(0, 8) };
          fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        }
        return data;
      })().finally(() => { running = null; });
      return running;
    },
  };
}

module.exports = { createTrello };

// Prueba manual: node trello.js  (consulta tus tableros de verdad; tarda un poco)
if (require.main === module) {
  const t = createTrello(path.join(os.tmpdir(), "nimbo-trello-test.json"));
  const t0 = Date.now();
  t.refresh().then((d) => console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`, JSON.stringify(d, null, 2)));
}

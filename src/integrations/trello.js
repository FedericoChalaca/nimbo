// Trello: Nimbo le pide a tu `claude` (que ya tiene el conector de Trello de claude.ai) tus tableros
// y, cuando abres uno, sus tarjetas. Nimbo nunca ve credenciales, y a Claude solo se le dejan las
// herramientas de LECTURA de Trello: no puede crear, mover ni borrar nada.
//
// Dos consultas, las dos bajo demanda:
//   · refreshBoards()      → la lista de tableros (una vez al día, o con "Actualizar")
//   · refreshBoard(url)    → TODAS las tarjetas abiertas de ese tablero, al tocarlo
// Qué es "pendiente" lo decide el código (isDoneList), no el modelo: así no depende de qué tarjetas
// le parezcan importantes. El modelo solo copia datos.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runClaude, connectors } = require("../main/orchestrator");

const READ_TOOLS = ["trelloReadBoard", "trelloReadCard", "trelloReadList", "trelloReadInbox", "trelloReadMember", "trelloSearch"]
  .map((t) => `mcp__claude_ai_Trello__${t}`);
const WRITE_TOOLS = ["trelloWriteBoard", "trelloWriteCard", "trelloWriteChecklist", "trelloWriteInbox", "trelloWriteList", "trelloWritePlanner"]
  .map((t) => `mcp__claude_ai_Trello__${t}`);

const obj = (properties, required) => ({ type: "object", properties, required });
const BOARDS_SCHEMA = JSON.stringify(obj({ boards: { type: "array", items: obj({ name: { type: "string" }, url: { type: "string" } }, ["name", "url"]) } }, ["boards"]));
const CARDS_SCHEMA = JSON.stringify(obj({ cards: { type: "array", items: obj({
  name: { type: "string" }, list: { type: "string" }, due: { type: "string" }, url: { type: "string" } }, ["name", "list"]) } }, ["cards"]));

const BOARDS_PROMPT = `Lista mis tableros de Trello abiertos. Usa solo herramientas de lectura: trelloReadBoard con action "list" (y sigue paginando con el cursor hasta tenerlos todos, máximo 30).
Responde con "boards": cada uno con "name" y "url" (la dirección completa tal cual la devuelve la herramienta; nunca la inventes).`;
const cardsPrompt = (url) => `Dame las tarjetas ABIERTAS del tablero de Trello ${url}. Usa solo herramientas de lectura: trelloReadCard con action "list_by_board" (boardIdOrUrl = esa dirección) y sigue paginando con el cursor hasta tener todas las listas.
No resumas ni filtres nada: devuelve cada tarjeta con "name", "list" (el nombre de su lista), "due" (fecha de vencimiento en ISO 8601; vacío si no tiene) y "url" (la de la tarjeta, completa). Máximo 150 tarjetas.`;

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// Lo que vuelve del modelo es texto de terceros: solo se aceptan direcciones de trello.com.
const BOARD_URL = /^https:\/\/trello\.com\/b\/[A-Za-z0-9]{6,12}(?:\/[^\s?#]{0,120})?$/;
const CARD_URL = /^https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}(?:\/[^\s?#]{0,120})?$/;
// Listas de "ya está" o de referencia: sus tarjetas no cuentan como pendientes.
const DONE_LIST = /hech[oa]|\bdone\b|complet(ad|o)|termin(ad|o)|aprobad|probad|cerrad|archivad|descartad|[eé]pic|referencia|gu[ií]a|fuera del alcance|plantilla|template/i;
const isDoneList = (name) => DONE_LIST.test(String(name ?? ""));

const cleanBoards = (raw) => (Array.isArray(raw) ? raw : [])
  .map((b) => ({ name: str(b?.name, 80), url: str(b?.url, 200) }))
  .filter((b, i, all) => b.name && BOARD_URL.test(b.url) && all.findIndex((x) => x.url === b.url) === i)
  .slice(0, 30);

const cleanCards = (raw) => (Array.isArray(raw) ? raw : []).map((c) => {
  const due = Number.isFinite(Date.parse(c?.due)) ? new Date(Date.parse(c.due)).toISOString() : "";
  const list = str(c?.list, 60);
  return { name: str(c?.name, 140), list, due, url: CARD_URL.test(str(c?.url, 200)) ? str(c.url, 200) : "", done: isDoneList(list) };
}).filter((c) => c.name).slice(0, 150);

const EMPTY = () => ({ at: "", boards: [], byBoard: {} });

// `model`: Haiku alcanza para copiar datos (el modelo por defecto de tu claude, p. ej. Opus, sale
// ~7 veces más caro y tarda el doble: medido el 2026-10-09 en una consulta de las de antes).
function createTrello(cacheFile, model = "haiku") {
  let data = EMPTY();
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    // El formato anterior (tarjetas sueltas, sin tableros con dirección) se descarta: se vuelve a pedir.
    if (saved && saved.byBoard && typeof saved.byBoard === "object") data = { at: String(saved.at ?? ""), boards: cleanBoards(saved.boards), byBoard: saved.byBoard };
  } catch {}
  let lastRun = null;
  const running = new Map();
  const save = () => { try { fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2)); } catch {} };

  async function ask(prompt, schema) {
    const cwd = path.join(os.tmpdir(), "nimbo-trello");
    fs.mkdirSync(cwd, { recursive: true });
    const args = ["-p", "--output-format", "json", "--json-schema", schema, ...(model ? ["--model", model] : []),
      // Sin herramientas propias (ni leer archivos ni navegar): solo el conector de Trello en
      // lectura. El nombre de una tarjeta lo puede escribir otra persona; no debe poder nada.
      "--tools", "", "--permission-mode", "default", "--no-session-persistence",
      "--allowedTools", ...READ_TOOLS,
      // Los demás conectores fuera: cargarlos todos costaba 355.000 tokens por consulta.
      "--disallowedTools", ...WRITE_TOOLS, ...(await connectors(cwd)).filter((n) => n !== "mcp__claude_ai_Trello")];
    const t0 = Date.now();
    // (La variable evita que cada consulta deje un "chat" con título en ~/.claude/projects.)
    const r = await runClaude(args, { cwd, input: prompt, env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
    lastRun = { ms: Date.now() - t0, usd: r.total_cost_usd ?? null, model: model || "(el tuyo)" };
    let out = r.structured_output;
    if (!out && r.result) { try { out = JSON.parse(r.result); } catch {} }
    return out && typeof out === "object" ? out : null;
  }
  // Una sola consulta a la vez por clave: tocar dos veces no gasta dos.
  const once = (key, job) => {
    if (!running.has(key)) running.set(key, job().finally(() => running.delete(key)));
    return running.get(key);
  };

  return {
    cached: () => data,
    hasBoard: (url) => data.boards.some((b) => b.url === url),
    /** Lo que costó la última consulta: { ms, usd, model }. null si todavía no hubo. */
    lastRun: () => lastRun,

    /** Trae la lista de tableros. Si falla, conserva la anterior. */
    refreshBoards: () => once("boards", async () => {
      const out = await ask(BOARDS_PROMPT, BOARDS_SCHEMA);
      const boards = cleanBoards(out?.boards);
      if (boards.length) {
        const byBoard = Object.fromEntries(Object.entries(data.byBoard).filter(([url]) => boards.some((b) => b.url === url)));
        data = { at: new Date().toISOString(), boards, byBoard };
        save();
      }
      return data;
    }),

    /** Trae las tarjetas abiertas de UN tablero (de la lista conocida). Si falla, conserva lo anterior. */
    refreshBoard: (url) => once(url, async () => {
      if (!BOARD_URL.test(String(url)) || !data.boards.some((b) => b.url === url)) return data;
      const out = await ask(cardsPrompt(url), CARDS_SCHEMA);
      if (out && Array.isArray(out.cards)) {
        data.byBoard[url] = { at: new Date().toISOString(), cards: cleanCards(out.cards) };
        save();
      }
      return data;
    }),
  };
}

module.exports = { createTrello, isDoneList, cleanBoards, cleanCards };

// Autoprueba (sin red): `node trello.js` · con tus tableros de verdad: `node trello.js live [modelo|default]`
if (require.main === module) {
  const assert = require("assert");
  for (const [name, done] of [["Por hacer", false], ["En proceso", false], ["EN PROCESO", false], ["Backlog", false], ["Doing", false], ["Completar", false],
    ["Por terminar", false], ["Por probar", false], ["Bloqueado", false], ["Federico · Por hacer", false],
    ["Hecho", true], ["Done", true], ["Completado", true], ["Terminadas", true], ["Probadas", true], ["Aprobadas", true], ["Épicas", true], ["Guía", true], ["Fuera del alcance", true], ["Plantillas", true]]) {
    assert.strictEqual(isDoneList(name), done, name);
  }
  const good = "https://trello.com/b/AbCdEfGh/mi-tablero";
  assert.deepStrictEqual(cleanBoards([{ name: "  Mi   tablero ", url: good }, { name: "Repetido", url: good }, { name: "Otro sitio", url: "https://evil.example/b/AbCdEfGh/x" },
    { name: "Sin https", url: "http://trello.com/b/AbCdEfGh/x" }, { name: "", url: good }, { name: "Con cola", url: `${good}?x=1` }, null, "texto"]), [{ name: "Mi tablero", url: good }]);
  assert.deepStrictEqual(cleanBoards("nada"), []);
  const cards = cleanCards([{ name: " Hacer  login ", list: "En proceso", due: "2026-10-12T15:00:00.000Z", url: "https://trello.com/c/ZyXwVuTs/1-login" },
    { name: "Vieja", list: "Hecho", due: "no es fecha", url: "https://evil.example/c/ZyXwVuTs" }, { name: "", list: "x" }, null]);
  assert.deepStrictEqual(cards.map((c) => [c.name, c.list, c.due, c.url, c.done]),
    [["Hacer login", "En proceso", "2026-10-12T15:00:00.000Z", "https://trello.com/c/ZyXwVuTs/1-login", false], ["Vieja", "Hecho", "", "", true]]);
  assert.strictEqual(cleanCards(Array.from({ length: 200 }, (_, i) => ({ name: `c${i}`, list: "x" }))).length, 150);
  // El formato de caché anterior se descarta; el nuevo se conserva.
  const tmp = path.join(os.tmpdir(), "nimbo-trello-selftest.json");
  fs.writeFileSync(tmp, JSON.stringify({ at: "2026-10-08", boards: [{ name: "x", pending: 3 }], cards: [{ name: "a" }] }));
  assert.deepStrictEqual(createTrello(tmp).cached(), EMPTY());
  fs.writeFileSync(tmp, JSON.stringify({ at: "2026-10-09", boards: [{ name: "Mi tablero", url: good }], byBoard: {} }));
  assert.strictEqual(createTrello(tmp).hasBoard(good), true);
  assert.strictEqual(createTrello(tmp).hasBoard("https://trello.com/b/ZZZZZZZZ/otro"), false);
  fs.rmSync(tmp, { force: true });
  console.log("trello.js ok");

  if (process.argv[2] === "live") {
    const arg = process.argv[3];
    const t = createTrello(path.join(os.tmpdir(), "nimbo-trello-live.json"), arg === "default" ? "" : arg);
    (async () => {
      const d = await t.refreshBoards();
      console.log("tableros:", d.boards.length, JSON.stringify(t.lastRun()));
      if (!d.boards.length) return;
      const board = d.boards[0];
      const r = await t.refreshBoard(board.url);
      const got = r.byBoard[board.url];
      console.log("primer tablero:", JSON.stringify(t.lastRun()), got ? { tarjetas: got.cards.length, pendientes: got.cards.filter((c) => !c.done).length, listas: [...new Set(got.cards.map((c) => `${c.list}${c.done ? " (terminada)" : ""}`))] } : null);
    })();
  }
}

// La ventana de opciones. Los ajustes llegan de main (la misma plantilla del menú de clic derecho) y aquí solo se ordenan por
// secciones, con una explicación de cada uno. Las conexiones usan el panel de siempre (setup / setup-do) con su guía paso a paso.
// Todo texto entra con textContent: nada de innerHTML.
const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";
const t = translator(LANG);
document.documentElement.lang = LANG;
const $ = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// Secciones: qué ajustes van en cada una (por id del menú) y qué dice cada uno.
const SECTIONS = [
  { id: "general", icon: "⚙", name: t("General"), lead: t("Cómo se ve y se comporta Nimbo."), items: [
    ["@name", t("Cómo te llama Nimbo al saludarte.")],
    ["theme", t("JARVIS es una esfera naranja; Nube, la nubecita. Cambiar el tema también cambia la voz.")],
    ["lang", t("El idioma de Nimbo, del dictado y de los resúmenes.")],
    ["@autostart", t("Nimbo se abre solo cuando entras a Windows.")],
    ["mute", t("Apaga los soniditos de Nimbo (no la música ni la voz).")],
    ["quiet", t("Si estás mirando la terminal o el editor cuando Claude termina, Nimbo no suena: ya lo viste.")],
    ["update-auto", t("Nimbo revisa cada 6 horas si salió una versión nueva en GitHub y te avisa (nunca instala nada sin que lo pidas).")],
    ["update-check", t("Revisa ahora mismo si hay una versión nueva.")],
    ["update-now", t("Descarga la versión nueva, comprueba que es la original y la instala.")],
  ] },
  { id: "screen", icon: "▭", name: t("En pantalla"), lead: t("Dónde vive Nimbo y qué muestra a su alrededor. También puedes arrastrarlo: cerca de un borde se pega ahí."), items: [
    ["dock", t("Arriba o abajo es una fila; a los lados, una columna (soltado en la mitad de abajo, Nimbo queda abajo); flotando, una nube con tus últimos programas.")],
    ["taskbar", t("Tus programas abiertos y anclados viven junto a Nimbo y la barra de Windows se esconde.")],
    ["mini", t("Para jugar: Nimbo se encoge a una nubecita en una esquina, sin sonidos ni tarjetas.")],
    ["mini-corner", t("En qué esquina queda el modo mini.")],
    ["village", t("Tus chats de Claude como personajes en una aldea: los que trabajan brillan.")],
  ] },
  { id: "voice", icon: "🎙", name: t("Voz"), lead: t("Hablarle a Nimbo y que te conteste. El oído (Whisper) funciona en tu PC: el audio no sale de aquí."), items: [
    ["wake", t("Nimbo escucha solo la frase «Oye/Hola Nimbo» (con el reconocedor de Windows) y, al oírla, abre el chat y te escucha. Si en 3 segundos no dices nada, apaga el micrófono. No guarda audios.")],
    ["cue", t("Al llamarlo dice «te escucho» (o una frase parecida) para que sepas que ya está atento.")],
    ["piper", t("Una voz más natural para esas frases (Piper, gratis y sin internet).")],
    ["wake-log", t("Qué pasó en cada posible llamada y por qué se despertó o no. No guarda lo que dijiste.")],
    ["speak", t("Nimbo lee en voz alta sus respuestas (necesita un servicio de voz configurado).")],
  ] },
  { id: "claude", icon: "✳", name: t("Claude"), lead: t("Cómo piensa Nimbo y qué revisa por ti."), items: [
    ["engine", t("Suscripción usa tu plan de Claude (sin costo extra). API es más rápida pero gasta tus créditos de API (pega la clave en Conexiones → Otras IAs).")],
    ["new-chat", t("Empieza una conversación nueva con Nimbo (olvida lo que hablaron).")],
    ["mail-open", t("Revisa tu Gmail ahora (solo lectura, por el conector de tu Claude).")],
    ["trello-refresh", t("Vuelve a traer tus tableros de Trello.")],
  ] },
  { id: "alerts", icon: "🔔", name: t("Avisos"), lead: t("Qué te cuenta Nimbo cuando no estás mirando."), items: [
    ["phone-alerts", t("Te escribe por Telegram cuando Claude termina o te necesita, de recordatorios y correo importante (primero conecta Telegram en Conexiones).")],
    ["wa-read", t("Lee las notificaciones de WhatsApp de Windows y te dice qué es urgente. Nunca escribe ni marca como leído.")],
    ["wa-rules", t("Tus reglas para WhatsApp en un archivo de texto: quién es trabajo, qué ignorar, qué es urgente.")],
  ] },
  { id: "conn", icon: "🔌", name: t("Conexiones"), lead: t("Cada conexión con su estado y los pasos para dejarla lista. Todo es opcional."), conn: true },
  { id: "about", icon: "☁", name: t("Acerca de"), lead: "", about: true },
];

let model = [], setup = null, current = "general", openConn = new Set(), busy = "", lastError = "";
const byId = (id) => model.find((x) => x.id === id);
// Lo que escribes o pegas en un campo se guarda aquí: la ventana se redibuja (al volver a ella, al cambiar algo) y antes los campos
// quedaban vacíos (pegabas el ID de Google con Ctrl+V y se borraba). Mientras escribes en un campo, tampoco se redibuja.
const drafts = {};
const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
let renderLater = false;
async function reload() {
  [model, setup] = await Promise.all([opt.model(), opt.setup().catch(() => null)]);
  if (typing()) { renderLater = true; return; }
  render();
}
document.addEventListener("focusout", () => setTimeout(() => { if (renderLater && !typing()) { renderLater = false; render(); } }, 150));
/** Un campo que recuerda lo escrito entre redibujos. */
function keep(key, input) {
  input.value = drafts[key] ?? "";
  input.addEventListener("input", () => { drafts[key] = input.value; });
  input.dataset.key = key;
  return input;
}
async function act(id, sub) { await opt.click(id, sub); setTimeout(reload, 250); }
async function doSetup(action, value) {
  busy = action; lastError = ""; render();
  const st = await opt.setupDo(action, value).catch((e) => ({ error: String(e?.message ?? e) }));
  busy = "";
  if (st && !st.error) { setup = st; for (const k of Object.keys(drafts)) if (k.startsWith(action.split("-")[0])) delete drafts[k]; } // guardado: el borrador sobra
  else lastError = st?.error ?? "";
  if (st && st.error && st.name !== undefined) setup = st;
  render();
}

function sw(on, onClick, disabled = false) {
  const b = $("button", "sw" + (on ? " on" : ""));
  b.type = "button"; b.disabled = disabled; b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on));
  b.onclick = onClick;
  return b;
}
function btn(text, onClick, cls = "") { const b = $("button", "btn " + cls, text); b.type = "button"; b.onclick = onClick; return b; }

/** Un ajuste del menú convertido en fila: casilla → interruptor; submenú de radios → botones; acción → botón. */
function settingRow(id, help) {
  if (id === "@name") {
    const row = $("div", "row"), txt = $("div", "txt");
    txt.append($("b", "", t("Tu nombre")), $("small", "", help));
    const input = $("input", "in"); input.value = setup?.name ?? ""; input.maxLength = 30; input.placeholder = t("Cómo te llamas");
    input.onchange = () => doSetup("name", input.value);
    row.append(txt, Object.assign($("div", "ctl"), {}));
    row.lastChild.append(input);
    return row;
  }
  if (id === "@autostart") {
    const row = $("div", "row"), txt = $("div", "txt");
    txt.append($("b", "", t("Iniciar con Windows")), $("small", "", help));
    const c = $("div", "ctl"); c.append(sw(setup?.autostart === true, () => doSetup("autostart", !(setup?.autostart === true))));
    row.append(txt, c);
    return row;
  }
  const it = byId(id);
  if (!it || !it.visible) return null;
  const row = $("div", "row" + (it.enabled ? "" : " off")), txt = $("div", "txt"), c = $("div", "ctl");
  txt.append($("b", "", it.label.replace(/…$/, "")), $("small", "", help));
  if (it.type === "checkbox") c.append(sw(it.checked, () => act(id), !it.enabled));
  else if (it.sub) {
    const radios = it.sub.filter((s) => s.type === "radio");
    if (radios.length) {
      // Las opciones (radio) juntas en una fila; lo demás (p. ej. "Pasar a la otra pantalla"), como botón aparte
      const seg = $("div", "seg");
      for (const s of radios) { const b = $("button", s.checked ? "on" : "", s.label); b.type = "button"; b.disabled = !s.enabled || !it.enabled; b.onclick = () => act(id, s.i); seg.append(b); }
      c.append(seg);
      for (const s of it.sub.filter((x) => x.type !== "radio")) c.append(btn(s.label, () => act(id, s.i)));
    } else {
      // Mezcla (casillas, acciones): cada una como su propio control
      const box = $("div", "");
      box.style.cssText = "display:flex;flex-direction:column;gap:6px;align-items:flex-end";
      for (const s of it.sub) {
        if (s.type === "checkbox") { const l = $("label", "", ""); l.style.cssText = "display:flex;gap:8px;align-items:center;cursor:pointer"; l.append($("span", "", s.label), sw(s.checked, () => act(id, s.i), !s.enabled || !it.enabled)); box.append(l); }
        else if (s.type === "radio") { const b = btn(s.label, () => act(id, s.i), s.checked ? "main" : ""); b.disabled = !s.enabled; box.append(b); }
        else box.append(btn(s.label, () => act(id, s.i)));
      }
      c.append(box);
    }
  } else {
    const b = btn(t("Abrir"), () => act(id));
    b.disabled = !it.enabled;
    c.append(b);
  }
  if (it.type === "normal" && !it.sub) c.lastChild.textContent = { "update-check": t("Revisar"), "update-now": t("Actualizar"), "new-chat": t("Empezar"), "mail-open": t("Revisar"), "trello-refresh": t("Actualizar"), village: t("Abrir"), "wa-rules": t("Editar"), "wake-log": t("Ver") }[id] ?? t("Abrir");
  row.append(txt, c);
  return row;
}

// --- Conexiones: estado + guía paso a paso + botones ---
function connCard(key, title, state, sub, steps, acts, note) {
  const card = $("div", "group conn" + (openConn.has(key) ? " open" : ""));
  const head = $("div", "head");
  const dot = $("span", "dot " + (state === "ok" ? "ok" : state === "warn" ? "warn" : ""));
  const txt = $("div", "txt"); txt.append($("b", "", title), $("small", "", sub));
  head.append(dot, txt, $("span", "chev", "›"));
  head.onclick = () => { openConn.has(key) ? openConn.delete(key) : openConn.add(key); render(); };
  const body = $("div", "body");
  if (steps.length) {
    const ol = $("ol", "steps");
    for (const s of steps) {
      const li = $("li", s.done ? "done" : "");
      for (const part of String(s.text).split(/(`[^`]+`)/)) li.append(part.startsWith("`") ? $("code", "", part.slice(1, -1)) : document.createTextNode(part));
      ol.append(li);
    }
    body.append(ol);
  }
  const a = $("div", "acts"); for (const x of acts.filter(Boolean)) a.append(x); body.append(a);
  if (note) body.append($("div", "note", note));
  if (lastError && openConn.has(key)) body.append($("div", "err", lastError));
  card.append(head, body);
  return card;
}
const keyInput = (ph) => { const i = $("input", "in"); i.type = "password"; i.placeholder = ph; i.autocomplete = "off"; i.spellcheck = false; return i; };
function connections() {
  const s = setup;
  if (!s) return [$("p", "lead", t("Cargando…"))];
  const out = [];
  const hookOk = s.hooks === "on";
  out.push(connCard("claude", "Claude Code", hookOk ? "ok" : s.claude ? "warn" : "", hookOk ? t("Conectado: Nimbo ve lo que hacen tus chats") : s.hooks === "stale" ? t("Hay que reconectar (Nimbo cambió de carpeta)") : t("Sin conectar"), [
    { text: t("Instala Claude Code (la app o la terminal) e inicia sesión."), done: !!s.claude },
    { text: t("Toca «Conectar»: Nimbo agrega sus avisos (hooks) a tu configuración de Claude Code, con copia de seguridad."), done: hookOk },
    { text: t("Abre o reinicia un chat de Claude Code: Nimbo empieza a reaccionar.") },
  ], [!s.claude && btn(t("Descargar Claude Code"), () => doSetup("open", "claude")), hookOk ? btn(t("Desconectar"), () => doSetup("hooks-off")) : btn(t("Conectar"), () => doSetup("hooks-on"), "main")]));
  out.push(connCard("github", "GitHub", s.github === "on" ? "ok" : s.github === "off" ? "warn" : "", s.github === "on" ? t("Conectado: avisa de tus notificaciones") : s.github === "missing" ? t("Falta la herramienta gh") : t("Falta iniciar sesión"), [
    { text: t("Instala GitHub CLI (gh)."), done: s.github !== "missing" },
    { text: t("En una terminal escribe `gh auth login` y sigue los pasos."), done: s.github === "on" },
    { text: t("Listo: Nimbo revisa tus notificaciones cada 5 minutos (no guarda claves).") },
  ], [s.github === "missing" && btn(t("Descargar gh"), () => doSetup("open", "gh"))]));
  out.push(connCard("connectors", t("Trello, Gmail y Spotify (búsqueda)"), s.trello || s.mail.on ? "ok" : "", t("Por los conectores de tu Claude: Nimbo no guarda claves"), [
    { text: t("Abre los conectores de claude.ai y activa Trello, Gmail o Spotify.") },
    { text: t("Trello: toca «Traer tableros». Tarda casi un minuto."), done: !!s.trello },
    { text: t("Gmail: actívalo aquí; solo lee remitente y asunto, nunca envía ni borra."), done: s.mail.on },
  ], [btn(t("Abrir conectores"), () => doSetup("open", "connectors")), btn(busy === "trello" ? t("Trayendo…") : t("Traer tableros"), () => doSetup("trello")),
    s.mail.on ? btn(t("Apagar Gmail"), () => doSetup("mail-off")) : btn(busy === "mail-on" ? t("Comprobando…") : t("Activar Gmail"), () => doSetup("mail-on"), "main")],
  s.trello ? t("{0} tableros de Trello.", s.trello) : ""));
  const tg = s.telegram ?? {};
  const tok = keep("telegram-token", keyInput(t("Pega el token del bot")));
  out.push(connCard("telegram", "Telegram", tg.paired ? "ok" : tg.token ? "warn" : "", tg.paired ? t("Vinculado: habla con Nimbo y recibe avisos en tu celular") : tg.token ? t("Falta vincular tu cuenta") : t("Sin conectar"), [
    { text: t("En Telegram, abre @BotFather y escribe `/newbot`. Ponle un nombre: es TU bot."), done: !!tg.token },
    { text: t("BotFather te da un token (algo como `123456789:AAH…`). Pégalo aquí y toca «Guardar»."), done: !!tg.token },
    { text: t("Toca «Vincular» y mándale a tu bot el código de 6 cifras que aparece."), done: !!tg.paired },
    { text: t("Elige qué avisos quieres en Avisos → Avisos al celular.") },
  ], tg.paired ? [btn(t("Abrir mi bot"), () => doSetup("open", "telegram-bot")), btn(t("Desconectar"), () => doSetup("telegram-logout"))]
    : [!tg.token && tok, !tg.token && btn(t("Guardar"), () => doSetup("telegram-token", tok.value), "main"), tg.token && btn(t("Vincular"), () => doSetup("telegram-pair"), "main"), tg.token && btn(t("Abrir mi bot"), () => doSetup("open", "telegram-bot"))],
  tg.pairing ? t("Mándale este código a tu bot: {0} (vale 10 minutos).", tg.pairing) : t("El token queda cifrado por Windows en tu PC. Telegram puede leer lo que se manda por el bot.")));
  const spId = keep("spotify-id", $("input", "in")); spId.placeholder = t("Client ID (32 letras y números)"); spId.spellcheck = false;
  out.push(connCard("spotify", t("Spotify Premium (que la canción suene)"), s.spotify ? "ok" : s.spotify === false ? "warn" : "", s.spotify ? t("Conectado") : s.spotify === false ? t("Falta iniciar sesión") : t("Opcional: sin esto, Nimbo igual muestra lo que suena"), [
    { text: t("Abre el panel de desarrollador de Spotify e inicia sesión con tu cuenta Premium.") },
    { text: t("Crea una app. En «Redirect URI» pon `http://127.0.0.1:47823/spotify` y marca «Web API»."), done: s.spotify !== null },
    { text: t("Copia el Client ID de la app, pégalo aquí y toca «Guardar»."), done: s.spotify !== null },
    { text: t("Toca «Iniciar sesión» y acepta en el navegador."), done: !!s.spotify },
  ], [btn(t("Abrir panel de Spotify"), () => doSetup("open", "spotifyDev")), s.spotify === null && spId, s.spotify === null && btn(t("Guardar"), () => doSetup("spotify-id", spId.value), "main"),
    s.spotify === false && btn(t("Iniciar sesión"), () => doSetup("spotify-login"), "main"), s.spotify && btn(t("Desconectar"), () => doSetup("spotify-logout"))]));
  const gg = s.google ?? {};
  const gId = keep("google-id", $("input", "in")); gId.placeholder = t("ID de cliente (…apps.googleusercontent.com)"); gId.spellcheck = false;
  const gSecret = keep("google-secret", keyInput(t("Secreto del cliente (GOCSPX-…)")));
  out.push(connCard("google", t("Tu Google (Drive y Calendar)"), gg.connected ? "ok" : gg.configured ? "warn" : "", gg.connected ? t("Conectado: Nimbo ve tu agenda y su carpeta de Drive") : gg.configured ? t("Falta iniciar sesión") : t("Sin conectar"), [
    { text: t("En Google Cloud crea tu app (proyecto, API de Drive, Docs y Calendar, pantalla de permisos y un ID de cliente de tipo «App de escritorio»)."), done: !!gg.configured },
    { text: t("Pega aquí el ID de cliente y el secreto, y toca «Guardar». El secreto queda cifrado por Windows."), done: !!gg.configured },
    { text: t("Toca «Iniciar sesión» y acepta en el navegador. Google dirá que la app no está verificada: es tu propia app; toca «Continuar»."), done: !!gg.connected },
    { text: t("Opcional: «Crear la carpeta con Instinct» hace la carpeta «Nimbo e Instinct» con sus dos documentos."), done: !!gg.bridge },
  ], [btn(t("Abrir Google Cloud"), () => doSetup("open", "googleCloud")), !gg.configured && gId, !gg.configured && gSecret, !gg.configured && btn(t("Guardar"), () => doSetup("google-client", `${gId.value}\n${gSecret.value}`), "main"),
    gg.configured && !gg.connected && btn(t("Iniciar sesión"), () => doSetup("google-login"), "main"),
    gg.connected && !gg.bridge && btn(busy === "google-bridge" ? t("Creando…") : t("Crear la carpeta con Instinct"), () => doSetup("google-bridge"), "main"),
    gg.bridge && btn(t("Abrir la carpeta"), () => doSetup("open", "google-folder")),
    gg.connected && btn(t("Desconectar"), () => doSetup("google-logout"))],
  (gg.watching && gg.listening ? t("Escuchando avisos de Instinct: Drive avisa cuando escribe (nada revisa cada tanto). ") : "") + t("Permisos mínimos: Drive solo lo que crea Nimbo (no el resto de tu Drive) y tus eventos de Calendar.")));
  const ai = s.ai ?? {};
  const keyWhich = $("select", "in"); keyWhich.style.width = "130px";
  for (const [v, l] of [["gemini", "Gemini"], ["openai", "OpenAI"], ["anthropic", "Claude (API)"]]) { const o = $("option", "", l); o.value = v; keyWhich.append(o); }
  const keyIn = keep("ai-key", keyInput(t("Pega la clave")));
  const ollamaOk = ai.ollama === "ok";
  out.push(connCard("ai", t("Otras IAs (Ollama, Gemini, OpenAI, Claude API)"), ollamaOk || Object.values(ai.keyed ?? {}).some(Boolean) ? "ok" : "", ollamaOk ? t("Ollama listo: IA gratis en tu PC") : t("Opcional"), [
    { text: t("Ollama (gratis, en tu PC): instálalo y ábrelo."), done: !!ai.installed },
    { text: t("Descarga el modelo recomendado ({0}, unos 2 GB). Solo con tu clic.", ai.recommended ?? ""), done: ollamaOk },
    { text: t("Gemini, OpenAI o Claude API: pega su clave; se comprueba antes de guardarla y queda cifrada.") },
  ], [!ai.installed && btn(t("Descargar Ollama"), () => doSetup("open", "ollama")), ai.installed && ai.ollama === "off" && btn(t("Abrir Ollama"), () => doSetup("ollama-open")),
    ai.installed && ai.ollama === "empty" && !ai.pull && btn(t("Descargar modelo"), () => doSetup("ollama-pull"), "main"), ai.pull && btn(t("Cancelar descarga ({0} %)", Math.round(ai.pull.percent ?? 0)), () => doSetup("ollama-pull-cancel")),
    keyWhich, keyIn, btn(t("Guardar clave"), () => doSetup("ai-key", `${keyWhich.value}:${keyIn.value}`))],
  Object.entries(ai.keyed ?? {}).filter(([, v]) => v).map(([k]) => ({ gemini: "Gemini", openai: "OpenAI", anthropic: "Claude API" }[k])).join(" · ") ? t("Claves guardadas: {0}", Object.entries(ai.keyed).filter(([, v]) => v).map(([k]) => ({ gemini: "Gemini", openai: "OpenAI", anthropic: "Claude API" }[k])).join(" · ")) : ""));
  if (s.platform === "win32") out.push(connCard("whatsapp", "WhatsApp", s.whatsappRead ? "ok" : "", s.whatsappRead ? t("Leyendo notificaciones (lo resume {0})", s.whatsappBrain === "ollama" ? t("tu IA local") : "Claude") : t("Apagado"), [
    { text: t("Abre WhatsApp de escritorio y deja activas sus notificaciones de Windows.") },
    { text: t("Actívalo aquí: Nimbo lee las notificaciones (solo lectura) y te dice qué es urgente."), done: s.whatsappRead },
    { text: t("Opcional: escribe tus reglas (quién es trabajo, qué ignorar).") },
  ], [s.whatsappRead ? btn(t("Apagar"), () => doSetup("whatsapp", false)) : btn(t("Activar"), () => doSetup("whatsapp", true), "main"), btn(t("Editar reglas"), () => doSetup("whatsapp-rules"))]));
  return out;
}

function render() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(...SECTIONS.map((s) => { const b = $("button", "tab" + (s.id === current ? " on" : "")); b.type = "button"; b.append($("i", "", s.icon), document.createTextNode(s.name)); b.onclick = () => { current = s.id; lastError = ""; render(); }; return b; }));
  const sec = SECTIONS.find((s) => s.id === current);
  document.getElementById("topTitle").textContent = `${t("Opciones")} · ${sec.name}`;
  const main = document.getElementById("main");
  const keep = main.scrollTop;
  const parts = [$("h1", "", sec.name)];
  if (sec.lead) parts.push($("p", "lead", sec.lead));
  if (sec.items) {
    const g = $("div", "group");
    for (const [id, help] of sec.items) { const r = settingRow(id, help); if (r) g.append(r); }
    parts.push(g);
  } else if (sec.conn) parts.push(...connections());
  else if (sec.about) {
    const g = $("div", "group");
    const r = $("div", "row"); const txt = $("div", "txt");
    txt.append($("b", "", t("Nimbo {0}", version)), $("small", "", t("Compañero flotante para Claude Code. Código abierto (MIT). Nada de lo tuyo sale de tu PC salvo lo que conectes tú.")));
    r.append(txt); g.append(r); parts.push(g);
  }
  main.replaceChildren(...parts);
  main.scrollTop = keep;
}

for (const [id, what] of [["wmin", "min"], ["wmax", "max"], ["wclose", "close"]]) document.getElementById(id).onclick = () => opt.win(what);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") opt.win("close"); });
let version = "";
opt.version().then((v) => { version = v; document.getElementById("ver").textContent = `v${v}`; if (current === "about") render(); });
opt.onChanged(reload);
window.addEventListener("focus", reload); // si cambiaste algo desde el menú rápido, al volver se ve
reload();

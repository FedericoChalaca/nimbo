// La isla: personaje, estados, chat, tarjetas y vistas. Lo carga src/renderer/index.html después de
// jarvis.js e i18n.js, y antes de voice.js (comparten el ámbito global de la página).
// Sin Electron (vista previa en un navegador) la página funciona igual, solo que sin eventos.
const noop = () => {};
const api = window.nimbo ?? new Proxy({}, { get: () => noop });
// Idioma: main.js lo pasa en la URL (?lang=en). El texto en español es la clave; i18n.js trae
// el inglés. t("Hola 👋 · {0}", quien) → traduce y pone los valores.
const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";
const LOCALE = LANG === "en" ? "en-US" : "es-CO";
const t = translator(LANG);
const root = document.getElementById("nimbo");
// Lo que está escrito en el HTML (botones, títulos, texto de ayuda) se traduce al cargar.
if (LANG === "en") {
  document.documentElement.lang = "en";
  for (const e of document.querySelectorAll("#bar *, #content *")) {
    if (!e.children.length && e.textContent.trim()) e.textContent = t(e.textContent.trim());
    for (const a of ["title", "placeholder"]) if (e.hasAttribute(a)) e.setAttribute(a, t(e.getAttribute(a)));
  }
}
// Los dos textos que pinta el CSS (content:) llegan como variables.
root.style.setProperty("--t-ask", JSON.stringify(t("¿En qué te ayudo?")));
root.style.setProperty("--t-drop", JSON.stringify(t("Suéltalo sobre mí")));
const look = document.getElementById("look");
const label = document.getElementById("label");
const svg = document.querySelector("#char svg");
const wrap = document.getElementById("wrap");
const content = document.getElementById("content");
const pips = document.getElementById("pips");
const waBtn = document.getElementById("waBtn");
const mailBtn = document.getElementById("mailBtn");
const measure = document.getElementById("measure");
const badge = document.getElementById("badge");

// --- Tamaño de la isla ---
// Compacta: se ajusta al largo del texto (como una "isla dinámica"). Abierta: crece hasta el
// contenido. Crecer usa resorte con rebote; encoger, la clase .closing (rápido, sin rebote).
const BAR_H = 68;
// La ventana mide 440 y a cada lado de la isla va una esquina invertida de 14: más ancha que
// esto, la ventana la recorta y pierde las curvas.
const MAX_W = 412;
let lastSize = { w: 0, h: 0 };
function layout() {
  layoutQueued = 0;
  if (mini) return;
  if (root.classList.contains("dropping")) {
    root.classList.remove("open", "solo");
    wrap.classList.remove("closing");
    wrap.style.setProperty("--w", `${MAX_W}px`);
    wrap.style.setProperty("--h", "152px");
    lastSize = { w: MAX_W, h: 152 };
    return;
  }
  const open = [...content.children].some((e) => !e.classList.contains("hidden"));
  root.classList.toggle("open", open);
  if (open) root.classList.remove("solo");
  let w, h;
  if (open) {
    w = MAX_W;
    h = Math.min(470, BAR_H + content.offsetHeight + 14);
  } else {
    const text = label.classList.contains("show") && state !== "sleeping" ? label.textContent : "";
    measure.textContent = text;
    const pipsW = (pips.children.length ? pips.children.length * 12 + 6 : 0) + (waBtn.classList.contains("hidden") ? 0 : waBtn.offsetWidth + 10) + (mailBtn.classList.contains("hidden") ? 0 : mailBtn.offsetWidth + 8);
    // El texto ocupa lo que quepa (el resto se corta con "…"): la isla no pasa de MAX_W.
    const textW = text ? Math.min(measure.offsetWidth, 270, MAX_W - 116 - 12 - pipsW - 16) : 0;
    w = text || pipsW ? 116 + textW + (text ? 12 : 0) + pipsW + 16 : 150;
    h = BAR_H;
    if (state === "sleeping") { w = 132; h = 60; }
    root.classList.toggle("solo", !text && !pipsW);
  }
  const shrinking = w < lastSize.w - 1 || h < lastSize.h - 1;
  wrap.classList.toggle("closing", shrinking);
  if (open !== root.classList.contains("was-open")) (open ? SOUNDS.open : SOUNDS.close)();
  root.classList.toggle("was-open", open);
  wrap.style.setProperty("--w", `${Math.round(w)}px`);
  wrap.style.setProperty("--h", `${Math.round(h)}px`);
  lastSize = { w, h };
}
let layoutQueued = 0;
const relayout = () => { layoutQueued ||= requestAnimationFrame(layout); };
new MutationObserver(relayout).observe(content, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
new ResizeObserver(relayout).observe(content);

// --- Etiqueta: el texto viejo sube y se apaga mientras el nuevo entra desde abajo ---
const EASE_TICK = "cubic-bezier(.4, 0, .2, 1)";
function setLabel(text) {
  if (text === label.textContent) return;
  if (label.textContent && text && label.classList.contains("show")) {
    const ghost = label.cloneNode(true);
    ghost.removeAttribute("id");
    ghost.style.cssText = "color:#8f959e;background:none;animation:none";
    label.parentNode.append(ghost);
    ghost.animate([{ transform: "none", opacity: 1 }, { transform: "translate(-6px,-20px) scale(.9)", opacity: 0 }],
      { duration: 380, easing: EASE_TICK, fill: "forwards" }).onfinish = () => ghost.remove();
    label.animate([{ transform: "translateY(20px)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: 380, easing: EASE_TICK });
  }
  label.textContent = text;
}

// --- Insignia: al cambiar de estado encoge (90 ms), cambia y vuelve con rebote (280 ms) ---
const BADGE_STATES = ["thinking", "working", "needs", "finished", "error"];
function swapBadge(prev, next) {
  if (!BADGE_STATES.includes(prev) || !BADGE_STATES.includes(next) || prev === next) return;
  badge.animate([{ transform: "scale(1)" }, { transform: "scale(0)", offset: .32 }, { transform: "scale(1.15)", offset: .8 }, { transform: "scale(1)" }],
    { duration: 380, easing: "ease-out" });
}

const SLEEP_AFTER = 120_000;
let state = "idle";
let backTimer, sleepTimer, labelTimer;

function setState(next, text = "", { back, labelFor } = {}) {
  const prev = state;
  state = next;
  Jarvis.setState(next);
  root.className = root.className.replace(/state-\w+/, "state-" + next);
  // El saltito y el temblor son de una sola vez: se reinician aunque el estado se repita.
  if (next === "finished" || next === "error") {
    const bob = document.getElementById("bob");
    bob.style.animation = "none"; void bob.getBBox(); bob.style.animation = "";
  }
  if (prev !== next) {
    swapBadge(prev, next);
    blink(); // un parpadeo tapa el cambio de cara
  }

  setLabel(text);
  label.classList.toggle("show", !!text);
  clearTimeout(labelTimer);
  if (text && labelFor) labelTimer = setTimeout(() => { label.classList.remove("show"); relayout(); }, labelFor);
  relayout();

  clearTimeout(backTimer);
  if (back) backTimer = setTimeout(settle, back);
  clearTimeout(sleepTimer);
  if (next === "idle") sleepTimer = setTimeout(() => setState("sleeping"), SLEEP_AFTER);
}

// --- Sonidos sintetizados (nada de archivos) ---
let muted = false;
let mini = false; // modo juego: chiquito en una esquina y sin sonido
// Sintetizador: ataque de 6 ms, caída exponencial, glide de tono, vibrato y un parcial
// "campana" opcional; todo pasa por un volumen maestro bajo y un poco de reverberación.
let audio, master;
let lastSoundAt = 0;
function audioOut() {
  lastSoundAt = performance.now();
  if (audio) {
    if (audio.state === "suspended") audio.resume();
    return master;
  }
  audio = new AudioContext();
  master = audio.createGain();
  master.gain.value = 0.12;
  const dry = audio.createGain();
  const wet = audio.createGain();
  wet.gain.value = 0.2;
  const verb = audio.createConvolver();
  // Respuesta al impulso generada: ruido que se apaga en 1,3 s.
  const len = Math.floor(audio.sampleRate * 1.3);
  const ir = audio.createBuffer(2, len, audio.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
  }
  verb.buffer = ir;
  master.connect(dry).connect(audio.destination);
  master.connect(verb).connect(wet).connect(audio.destination);
  return master;
}
function tone({ f, to, d = .15, type = "sine", g = .5, delay = 0, vib = 0, vibf = 6, h = 0 }) {
  if (muted || mini) return;
  const out = audioOut();
  const t = audio.currentTime + delay;
  const voice = (freq, gain, dur) => {
    const o = audio.createOscillator();
    const gn = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(freq * (to / f), t + dur * .9);
    if (vib) {
      const lfo = audio.createOscillator();
      const lg = audio.createGain();
      lfo.frequency.value = vibf;
      lg.gain.value = vib;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    gn.gain.setValueAtTime(.0001, t);
    gn.gain.exponentialRampToValueAtTime(gain, t + .006);
    gn.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(gn).connect(out);
    o.start(t);
    o.stop(t + dur + .02);
  };
  voice(f, g, d);
  if (h) voice(f * h, g * .3, d * .35); // parcial inarmónico: suena a campanita
}
// Whoosh: ruido filtrado con un barrido de frecuencia (abrir hacia arriba, cerrar hacia abajo).
function whoosh(from, to, d = .22, g = .18) {
  if (muted || mini) return;
  const out = audioOut();
  const t = audio.currentTime;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * d), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  const bp = audio.createBiquadFilter();
  const gn = audio.createGain();
  src.buffer = buf;
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + d);
  gn.gain.setValueAtTime(.0001, t);
  gn.gain.exponentialRampToValueAtTime(g, t + d * .3);
  gn.gain.exponentialRampToValueAtTime(.0001, t + d);
  src.connect(bp).connect(gn).connect(out);
  src.start(t);
}
// Gramática: éxito = acorde mayor que sube; error = dos notas que bajan; atención = misma nota
// con campana; micro-feedback = tonos cortos, agudos y casi inaudibles.
const SOUNDS = {
  hello: () => { tone({ f: 523, d: .14, g: .4 }); tone({ f: 784, d: .22, g: .4, delay: .085, h: 2.76 }); },
  finish: () => [523, 659, 784].forEach((f, i) => tone({ f, d: i === 2 ? .45 : .18, g: .45, delay: i * .085, h: i === 2 ? 2.76 : 0 })),
  needs: () => { tone({ f: 880, d: .16, type: "triangle", g: .45, h: 2.76 }); tone({ f: 880, d: .24, type: "triangle", g: .45, delay: .18, h: 2.76 }); },
  error: () => { tone({ f: 392, d: .2, type: "triangle", g: .5 }); tone({ f: 311, d: .42, type: "triangle", g: .5, delay: .17 }); },
  poke: () => tone({ f: 620, to: 980, d: .1, g: .25 }),
  greet: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: i === 3 ? .5 : .16, g: .4, delay: i * .085, h: i === 3 ? 2.76 : 0 })),
  love: () => [784, 988, 1175].forEach((f, i) => tone({ f, d: .2, g: .3, delay: i * .1, vib: i === 2 ? 8 : 0 })),
  dizzy: () => tone({ f: 700, to: 380, d: .7, type: "triangle", g: .35, vib: 40, vibf: 9 }),
  gulp: () => { tone({ f: 330, to: 160, d: .2, g: .6 }); tone({ f: 200, to: 120, d: .12, g: .3, delay: .16 }); },
  yawn: () => tone({ f: 420, to: 300, d: .9, g: .15, vib: 6, vibf: 5 }),
  hover: () => tone({ f: 2100, d: .05, g: .05 }),
  open: () => whoosh(500, 2400, .26, .14),
  close: () => whoosh(2200, 400, .22, .1),
};
// El audio se suspende tras unos segundos de silencio, para no gastar CPU.
setInterval(() => { if (audio?.state === "running" && performance.now() - lastSoundAt > 4000) audio.suspend(); }, 5000);

// --- Eventos de Claude Code ---
const TOOLS = { Bash: t("Ejecuta"), PowerShell: t("Ejecuta"), Read: t("Lee"), Write: t("Escribe"), Edit: t("Edita"),
  MultiEdit: t("Edita"), Glob: t("Busca"), Grep: t("Busca"), WebSearch: t("Busca en la web"), WebFetch: t("Abre"),
  Task: t("Agente"), Agent: t("Agente"), TodoWrite: t("Tareas"), NotebookEdit: "Notebook" };
const base = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

function toolLabel(tool, input = {}) {
  const name = TOOLS[tool] ?? tool;
  const detail = input.command ?? (input.file_path && base(input.file_path)) ??
    (input.path && base(input.path)) ?? input.pattern ?? input.query ?? input.url ?? input.description;
  return detail ? `${name} · ${String(detail).slice(0, 60)}` : name;
}

// --- Varios chats a la vez: qué está haciendo cada uno ---
// main.js agrega p.title (el título del chat en la barra lateral de la app).
const sessions = new Map(); // session_id → { title, state, step, t }
const STALE_MS = 20 * 60_000;
const sessionBox = document.getElementById("sessions");

function track(p, st, step) {
  const id = p.session_id ?? p.title;
  if (!id) return;
  if (st === null) sessions.delete(id);
  else {
    const prev = sessions.get(id);
    sessions.set(id, { title: p.title || base(p.cwd ?? "") || "Claude", state: st, step: step ?? prev?.step ?? "",
      t: Date.now(), steps: prev?.steps ?? [], n: prev?.n ?? 0 });
    recordStep(sessions.get(id), p);
  }
  renderSessions();
  renderPips();
}
// Un puntito por chat activo en la barra de la isla (máx. 5), del color de su estado.
const STATE_COLOR = { working: "#4da3ff", thinking: "#9b87ff", needs: "#ffb020", finished: "#34c77b", error: "#e5484d", idle: "#6b717a" };
let lastPips = "";
function renderPips() {
  const list = liveSessions().slice(0, 5);
  const key = list.map((s) => s.title + s.state).join("|");
  if (key === lastPips) return; // sin cambios: no reiniciar sus animaciones
  lastPips = key;
  pips.replaceChildren(...list.map((s) => {
    const p = el("span", `pip ${s.state}`);
    p.style.setProperty("--c", STATE_COLOR[s.state] ?? "#888");
    p.title = `${s.title} · ${s.step}`;
    return p;
  }));
  relayout();
}
// Últimos 4 pasos de cada chat: { label, tool, input, out, status: run | ok | fail }
function recordStep(s, p) {
  const last = s.steps[s.steps.length - 1];
  switch (p.hook_event_name) {
    case "UserPromptSubmit":
      s.steps = [];
      s.n = 0;
      break;
    case "PreToolUse":
      if (last?.status === "run") last.status = "ok";
      s.n++;
      s.steps.push({ label: toolLabel(p.tool_name, p.tool_input), tool: p.tool_name, input: p.tool_input ?? {}, status: "run" });
      s.steps = s.steps.slice(-4);
      break;
    case "PostToolUse":
      if (last?.status === "run") { last.status = "ok"; last.out = p.tool_response; }
      break;
    case "PostToolUseFailure":
      if (last?.status === "run") { last.status = "fail"; last.out = p.tool_response ?? p.error; }
      break;
    case "Stop":
      if (last?.status === "run") last.status = "ok";
      break;
  }
  renderLive();
}

// --- Vista en vivo: el chat que más recientemente hizo algo ---
const liveBox = document.getElementById("live");
// Cuándo se abrió el resumen de WhatsApp (0 = cerrado). Al cerrarlo después de haberlo tenido
// a la vista al menos 2 s, cuenta como leído y esos mensajes no vuelven a salir.
let waOpenedAt = 0;
function waViewed() {
  const read = waOpenedAt && Date.now() - waOpenedAt > 2000 && whatsapp?.read && !whatsapp.busy && whatsapp.chats.length;
  waOpenedAt = 0;
  if (read) api.whatsappDismiss();
}
function hidePanel() {
  if (openApp === "wa") waViewed();
  sessionBox.classList.add("hidden");
  liveBox.classList.add("hidden");
  appsBox.classList.add("hidden");
  appView.classList.add("hidden");
  openApp = null;
}
const lines = (text, max) => String(text ?? "").replace(/\r/g, "").split("\n").slice(0, max);
function codeView(step) {
  const { tool, input = {}, out } = step;
  const view = el("div", "code");
  const tab = (name, note = "") => { const t = el("div", "tab", ""); t.append("📄 " + name, el("em", "", note)); view.append(t); };
  let i = 0;
  const add = (cls, text) => { const l = el("div", `ln ${cls}`, text || " "); if (cls === "add") l.style.setProperty("--i", i++); view.append(l); };
  if (tool === "Edit" || tool === "MultiEdit") {
    tab(base(input.file_path ?? ""), t("edita"));
    const edits = tool === "Edit" ? [input] : (input.edits ?? []).slice(0, 2);
    for (const e of edits) {
      lines(e.old_string, 3).forEach((t) => add("del", "- " + t));
      lines(e.new_string, 4).forEach((t) => add("add", "+ " + t));
    }
  } else if (tool === "Write") {
    tab(base(input.file_path ?? ""), t("nuevo"));
    lines(input.content, 6).forEach((t) => add("add", "+ " + t));
  } else if (tool === "Bash" || tool === "PowerShell") {
    add("cmd", "$ " + lines(input.command, 2).join(" "));
    const text = typeof out === "string" ? out : [out?.stdout, out?.stderr].filter(Boolean).join("\n");
    lines(text, 40).filter((t) => t.trim()).slice(-5).forEach((t) => add("out", t));
  } else return null;
  return view;
}
let liveKey = "";
function renderLive() {
  if (liveBox.classList.contains("hidden")) return;
  const s = liveSessions().find((x) => x.steps?.length);
  if (!s) return liveBox.classList.add("hidden");
  const cur = s.steps[s.steps.length - 1];
  // Solo se redibuja si cambió algo: así las animaciones de tecleo no se reinician solas.
  const key = s.title + s.state + s.n + s.steps.map((x) => x.status).join();
  if (key === liveKey) return;
  liveKey = key;
  const head = el("div", "lhead");
  head.append(el("span", `dot ${s.state}`), el("b", "", s.title), el("span", "sub", "Claude Code"),
    el("span", "count", s.state === "finished" ? t("listo") : t("paso {0}", s.n)));
  const steps = el("div", "steps");
  for (const st of s.steps) {
    const row = el("div", `lstep ${st.status}`);
    row.append(el("i"), el("span", "", st.label));
    steps.append(row);
  }
  liveBox.replaceChildren(head, steps, ...[codeView(cur)].filter(Boolean));
}
function showLive() {
  if (!liveSessions().some((x) => x.steps?.length)) return;
  liveKey = "";
  liveBox.classList.remove("hidden");
  renderLive();
}

function liveSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.t > STALE_MS) sessions.delete(id);
  return [...sessions.values()].sort((a, b) => b.t - a.t);
}
// Tras un "¡Listo!" o un error, Nimbo vuelve a lo que esté haciendo otro chat (o descansa).
function settle() {
  const busy = liveSessions().find((s) => s.state === "working" || s.state === "thinking");
  if (busy) setState(busy.state, `${busy.title} · ${busy.step}`);
  else setState("idle");
}
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};
function renderSessions() {
  renderApps();
  if (sessionBox.classList.contains("hidden")) return;
  const list = liveSessions();
  if (!list.length) { sessionBox.classList.add("hidden"); return; }
  const rows = list.map((s, i) => {
    const row = el("div", "srow");
    row.style.setProperty("--d", `${i * .035}s`); // entran escalonadas, 35 ms entre filas
    row.append(el("span", `dot ${s.state}`), el("b", "", s.title), el("span", "step", s.step), el("span", "ago", ago(s.t)));
    return row;
  });
  const head = list.length === 1 ? t("1 chat activo") : t("{0} chats activos", list.length);
  sessionBox.replaceChildren(el("div", "head", head), ...rows);
}

// --- Apps: píldoras (Chats, Trello, GitHub, WhatsApp, Pendientes) y la vista de cada una ---
// Al pasar el mouse solo sale la fila de píldoras, y solo las que tienen algo (cuenta > 0);
// el detalle de una se abre al tocarla, de a una. Así el panel nunca muestra todo a la vez.
const appsBox = document.getElementById("apps");
const appView = document.getElementById("appview");
let trelloData = null; // { at, boards: [{name, url}], byBoard: { [url]: { at, cards: [{name, list, due, url, done}] } } }
let trelloBusy = []; // consultas en curso: "boards" o la dirección de un tablero
let trelloBoard = null; // el tablero abierto (su dirección) o null = la lista de tableros
let mailData = null; // { on, at, emails: [{id, from, subject, summary, important}] } (mail.js)
let mailBusy = false;
let media = null; // lo que suena en Spotify: { title, artist, album, playing, art } (media.js)
let openApp = null; // la app cuya tarjeta está abierta
let lastApps = "";
const alertedCards = new Set();
const miniCloud = (color) => {
  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("class", "mini");
  svgEl.style.setProperty("--c", color);
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#mini");
  svgEl.append(use);
  return svgEl;
};
function appsList() {
  const out = [{ id: "chats", name: "Chats", color: "#d97757", count: liveSessions().length }];
  if (trelloData?.boards?.length) out.push({ id: "trello", name: "Trello", color: "#579dff", count: trelloData.boards.length });
  if (dayPlan) out.push({ id: "plan", name: t("Plan"), color: "#2dd4bf", count: dayPlan.solos + dayPlan.teNecesitan });
  if (github !== null) out.push({ id: "github", name: "GitHub", color: "#a371f7", count: github.length });
  if (media) out.push({ id: "spotify", name: "Spotify", color: "#1db954", count: 1, badge: media.playing ? "♪" : "❚❚" });
  if (mailData?.on) out.push({ id: "mail", name: t("Correo"), color: "#ea4335", count: mailData.emails.length || 1, badge: String(mailData.emails.length) });
  if (whatsapp) out.push({ id: "wa", name: "WhatsApp", color: waChats().some((c) => c.urgent) ? "#ff4d4f" : "#25d366", count: waCount() });
  out.push({ id: "pend", name: t("Pendientes"), color: "#ffd23f", count: pendingList.length });
  return out.filter((a) => a.count > 0);
}
function renderApps() {
  if (appsBox.classList.contains("hidden")) return;
  const list = appsList();
  appsBox.classList.toggle("hidden", !list.length);
  // Sin cambios no se redibuja: llega con cada evento de un chat y reemplazar los botones
  // se comería el clic que estuviera en curso.
  const key = list.map((a) => a.id + a.count + a.color + (a.badge ?? "")).join() + openApp;
  if (key === lastApps) return;
  lastApps = key;
  appsBox.replaceChildren(...list.map((a) => {
    const p = el("button", `pill${openApp === a.id ? " on" : ""}`);
    p.type = "button";
    p.style.setProperty("--c", a.color);
    p.append(miniCloud(a.color), el("span", "", a.name), el("b", "", a.badge ?? String(a.count)));
    p.onclick = () => {
      if (openApp === "wa") waViewed();
      openApp = openApp === a.id ? null : a.id;
      if (openApp === "wa") waOpenedAt = Date.now();
      renderApps();
      renderAppView();
    };
    return p;
  }));
}
const listColor = (name = "") => (/bloq|block/i.test(name) ? "red" : /revisi|review/i.test(name) ? "purple" : /proceso|progres|doing|haciendo/i.test(name) ? "blue" : "");
function dueChip(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return el("span", `chip2 ${ms < 0 ? "red" : ms < 864e5 ? "amber" : ""}`, ms < 0 ? t("vencida") : fmtDue(iso));
}
function renderAppView() {
  const app = appsList().find((a) => a.id === openApp);
  // "Chats" usa sus dos cajas de siempre (lista de chats + vista en vivo) en vez de #appview.
  const chats = app?.id === "chats";
  if (chats && sessionBox.classList.contains("hidden")) {
    sessionBox.classList.add("fresh");
    setTimeout(() => sessionBox.classList.remove("fresh"), 900);
  }
  sessionBox.classList.toggle("hidden", !chats);
  if (chats) { renderSessions(); showLive(); } else liveBox.classList.add("hidden");
  if (!app || chats) { appView.classList.add("hidden"); return; }
  appView.style.setProperty("--c", app.color);
  const head = el("div", "ahead");
  head.append(miniCloud(app.color), el("b", "", app.name));
  const rows = [];
  if (app.id === "trello") {
    const busy = (k) => trelloBusy.includes(k);
    const button = (text, fn) => { const b = el("button", "", text); b.type = "button"; b.onclick = fn; return b; };
    const board = trelloData.boards.find((b) => b.url === trelloBoard);
    if (!board) {
      // 1) La lista de tableros. Tocar uno carga sus tarjetas (una consulta, ~1 min la primera vez).
      trelloBoard = null;
      head.append(el("span", "sub", t("{0} tableros", trelloData.boards.length)), button(busy("boards") ? t("Actualizando…") : t("Actualizar"), () => api.trelloRefresh()));
      for (const b of trelloData.boards) {
        const got = trelloData.byBoard?.[b.url];
        const pending = got ? got.cards.filter((c) => !c.done).length : null;
        const r = el("div", "arow link");
        r.onclick = () => {
          trelloBoard = b.url;
          if (!trelloData.byBoard?.[b.url]) api.trelloBoard(b.url);
          renderAppView();
        };
        r.append(el("span", `chip2 cnt ${pending === null ? "" : pending ? "blue" : "green"}`, pending === null ? "›" : String(pending)), el("span", "name", b.name));
        rows.push(r);
      }
      rows.push(el("div", "afoot", t("Toca un tablero para ver sus pendientes.")));
    } else {
      // 2) Un tablero: sus tarjetas pendientes (las de listas de terminado quedan ocultas), las que vencen antes primero.
      const got = trelloData.byBoard?.[board.url];
      head.append(el("span", "sub", board.name), button("‹ " + t("Tableros"), () => { trelloBoard = null; renderAppView(); }),
        button(busy(board.url) ? t("Actualizando…") : t("Actualizar"), () => api.trelloBoard(board.url)));
      if (!got) rows.push(el("div", "afoot", busy(board.url) ? t("Cargando las tarjetas… tarda cerca de 1 minuto.") : t("No pude cargar este tablero.")));
      else {
        const due = (c) => (c.due ? Date.parse(c.due) : 8.64e15);
        const pend = got.cards.filter((c) => !c.done).sort((a, b) => due(a) - due(b));
        const list = el("div", "alist");
        for (const c of pend) {
          const r = el("div", "arow link");
          r.title = c.list;
          r.onclick = () => c.url && api.openUrl(c.url);
          r.append(el("span", `chip2 ${listColor(c.list)}`, c.list), el("span", "name", c.name), ...[dueChip(c.due)].filter(Boolean));
          list.append(r);
        }
        rows.push(pend.length ? list : el("div", "afoot", t("nada pendiente")));
        const hidden = got.cards.length - pend.length;
        rows.push(el("div", "afoot", [t("Actualizado {0}", fmtDue(got.at)), hidden ? t("{0} en listas de terminado (ocultas)", hidden) : ""].filter(Boolean).join(" · ")));
      }
    }
  } else if (app.id === "plan") {
    head.append(el("span", "sub", `${fmtPlanDate(dayPlan.fecha)} · ${t("{0} solos · {1} con propuesta para ti", dayPlan.solos, dayPlan.teNecesitan)}`));
    const hear = el("button", "", t("Escuchar"));
    hear.type = "button";
    hear.onclick = () => speak(dayPlan.say);
    head.append(hear);
    if (dayPlan.resumen) rows.push(el("div", "afoot", dayPlan.resumen));
    // Primero lo que te necesita a ti; después lo que puede avanzar solo.
    const withProposal = dayPlan.proyectos.filter((p) => p.propuesta).sort((a, b) => (b.propuesta.tipo === "te_necesita") - (a.propuesta.tipo === "te_necesita"));
    for (const p of withProposal.slice(0, 8)) {
      const r = el("div", "arow");
      const need = p.propuesta.tipo === "te_necesita";
      const name = el("span", "name");
      name.append(el("b", "", p.nombre), el("i", "", p.propuesta.titulo));
      name.title = [p.propuesta.titulo, p.propuesta.motivo, p.propuesta.detalle].filter(Boolean).join("\n");
      r.append(el("span", `chip2 ${need ? "amber" : "green"}`, need ? t("Para ti") : t("Solo")), name);
      rows.push(r);
    }
    const idle = dayPlan.proyectos.length - withProposal.length;
    if (idle > 0) rows.push(el("div", "afoot", t("{0} sin propuesta hoy", idle)));
  } else if (app.id === "mail") {
    const imp = mailData.emails.filter((e) => e.important).length;
    head.append(el("span", "sub", t("{0} sin leer · {1} importantes", mailData.emails.length, imp)));
    const again = el("button", "", mailBusy ? t("Revisando…") : t("Revisar ahora"));
    again.type = "button";
    again.onclick = () => api.mailRefresh();
    head.append(again);
    const list = el("div", "alist");
    if (!mailData.emails.length) list.append(el("div", "afoot", mailBusy ? t("Revisando…") : t("No tienes correos sin leer. 📭")));
    for (const e of mailData.emails) {
      const r = el("div", "arow link");
      r.title = e.subject;
      r.onclick = () => api.mailOpen(e.id);
      const name = el("span", "name");
      name.append(el("b", "", e.from || "?"), el("i", "", e.summary || e.subject));
      r.append(el("span", `chip2 cnt ${e.important ? "amber" : ""}`, e.important ? "★" : "·"), name);
      list.append(r);
    }
    rows.push(list, el("div", "afoot", mailData.at ? t("Actualizado {0}", fmtDue(mailData.at)) : t("Revisando…")));
  } else if (app.id === "spotify") {
    head.append(el("span", "sub", media.album));
    const find = el("button", "", t("Buscar"));
    find.type = "button";
    find.onclick = () => { if (chat.classList.contains("hidden")) toggleChat(true); msg.value = "spotify "; msg.focus(); };
    head.append(find);
    const now = el("div", "now");
    // La carátula solo puede ser un data: de imagen (lo valida media.js); el CSP no deja cargar nada de fuera.
    const art = media.art ? Object.assign(el("img"), { src: media.art, alt: "" }) : el("div", "noart");
    const meta = el("div", "meta");
    meta.append(el("b", "", media.title), el("i", "", media.artist));
    meta.title = `${media.title} · ${media.artist}`;
    const ctl = el("div", "ctl");
    const key = (cls, label, d, order) => {
      const b = el("button", cls);
      b.type = "button";
      b.title = label;
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgEl.setAttribute("viewBox", "0 0 24 24");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      svgEl.append(p);
      b.append(svgEl);
      b.onclick = () => {
        api.mediaDo(order);
        // El botón responde ya; Windows confirma el estado real en menos de un segundo.
        if (order === "toggle") { media = { ...media, playing: !media.playing }; renderApps(); renderAppView(); }
      };
      return b;
    };
    ctl.append(key("", t("Anterior"), "M6 6h2v12H6zM9.5 12l8.5 6V6z", "prev"),
      media.playing ? key("play", t("Pausar"), "M6 5h4v14H6zM14 5h4v14h-4z", "toggle") : key("play", t("Reproducir"), "M8 5v14l11-7z", "toggle"),
      key("", t("Siguiente"), "M16 6h2v12h-2zM6 18l8.5-6L6 6z", "next"));
    now.append(art, meta, ctl);
    rows.push(now);
  } else if (app.id === "github") {
    head.append(el("span", "sub", t("{0} sin leer", github.length)));
    for (const n of github.slice(0, 6)) {
      const r = el("div", "arow link");
      r.onclick = () => api.openGithub();
      r.append(el("span", "chip2 purple", (n.repo ?? "").split("/").pop() || "repo"), el("span", "name", n.title));
      rows.push(r);
    }
  } else if (app.id === "wa") {
    const chats = waChats();
    const ignored = whatsapp.chats.filter((c) => c.ignore);
    head.append(el("span", "sub", chats.length ? `${chats.length} ${chats.length === 1 ? "chat" : "chats"}` : t("{0} sin leer", waCount())));
    if (whatsapp.read) {
      // Antes había un "Abrir WhatsApp" (inútil: ya tienes la app). Ahora el botón de arriba vuelve a leer tus chats sin leer y los resume.
      const check = el("button", "open allow", whatsapp.busy ? t("Resumiendo…") : t("Revisar chats"));
      check.type = "button";
      check.disabled = whatsapp.busy === true;
      check.title = t("Vuelve a leer tus chats sin leer y los resume");
      check.onclick = () => api.whatsappRefresh();
      head.append(check);
    }
    if (whatsapp.headline) rows.push(el("div", "afoot", whatsapp.headline));
    const CHIP = { trabajo: ["blue", t("Trabajo")], personal: ["green", "Personal"], grupo: ["purple", t("Grupo")], otro: ["", t("Nuevo")] };
    for (const c of chats.slice(0, 7)) {
      const r = el("div", `arow${c.urgent ? " urgent" : ""}`);
      // "Nuevo" = todavía sin resumir; "Otro" = resumido y no es trabajo, personal ni grupo.
      const [color, text] = c.urgent ? ["red", t("Urgente")] : c.kind === "otro" && c.labeled ? ["", t("Otro")] : CHIP[c.kind] ?? CHIP.otro;
      const name = el("span", "name");
      name.append(el("b", "", c.n > 1 ? `${c.name} (${c.n})` : c.name), el("i", "", c.summary));
      name.title = c.summary;
      r.append(el("span", `chip2 ${color}`, text), name);
      rows.push(r);
      if (c.reply) {
        // Sugerencia para contestar: se copia y la pegas tú en WhatsApp (Nimbo no envía nada).
        const line = el("div", "areply");
        const copy = el("button", "", t("Copiar"));
        copy.type = "button";
        copy.title = t("Copia la respuesta sugerida para pegarla en WhatsApp");
        copy.onclick = () => { api.copy(c.reply); copy.textContent = t("Copiado ✓"); setTimeout(() => (copy.textContent = t("Copiar")), 1500); };
        line.append(el("span", "", `↩ ${c.reply}`), copy);
        rows.push(line);
      }
    }
    if (ignored.length) rows.push(el("div", "afoot", t("Ignorados: {0}", ignored.map((c) => `${c.name} (${c.n})`).join(", ")).slice(0, 150)));
    if (!whatsapp.read) rows.push(el("div", "afoot", t("Para ver quién escribe y qué es urgente: clic derecho en Nimbo > Leer mensajes de WhatsApp.")));
    else if (!whatsapp.access) rows.push(el("div", "afoot", t("Falta permiso: Configuración de Windows > Privacidad > Notificaciones.")));
    else if (!whatsapp.chats.length && whatsapp.count) rows.push(el("div", "afoot", t("Sin vista previa: esos chats no dejaron notificación en Windows.")));
    if (whatsapp.read && whatsapp.chats.length) {
      // Quién resumió (o que está en eso) y un botón para pedirlo de nuevo.
      const foot = el("div", "afoot row", whatsapp.busy ? t("Resumiendo…") : !whatsapp.brain ? t("Aún sin resumir.")
        : whatsapp.brain === "claude" ? t("Resumido por tu Claude.") : t("Resumido en tu equipo por {0}.", whatsapp.brain));
      const seenBtn = el("button", "allow", t("Visto"));
      seenBtn.type = "button";
      seenBtn.title = t("Ya lo leí: cerrar y no volver a mostrarlo");
      seenBtn.onclick = () => { waOpenedAt = 0; api.whatsappDismiss(); openApp = null; renderApps(); renderAppView(); };
      foot.append(seenBtn);
      rows.push(foot);
    }
  } else if (app.id === "pend") {
    head.append(el("span", "sub", t("tus recordatorios")));
    for (const p of pendingList.slice(0, 6)) {
      const r = el("div", "arow");
      const done = el("button", "done", "✓");
      done.type = "button";
      done.title = t("Marcar como hecho");
      done.onclick = () => api.reminderDone(p.id);
      r.append(el("span", "name", p.text), ...[dueChip(p.due) ?? el("span", "chip2", t("sin fecha"))], done);
      rows.push(r);
    }
  }
  appView.replaceChildren(head, ...rows);
  appView.classList.remove("hidden");
}
// WhatsApp (solo lectura, ver whatsapp.js): chats sin leer + quién escribió, clasificado por
// tu claude en trabajo / personal / grupo, con lo urgente aparte.
let whatsapp = null; // { running, access, count, chats: [{ name, kind, urgent, ignore, summary, n }], headline }
const waChats = () => (whatsapp?.chats ?? []).filter((c) => !c.ignore).sort((a, b) => b.urgent - a.urgent);
// Con notificaciones: los chats que importan (los grupos ignorados no cuentan). Sin ellas: el
// número del título de la ventana.
const waCount = () => (whatsapp?.read || whatsapp?.chats.length ? waChats().length : whatsapp?.count ?? 0);
let urgentTimer;
api.onWhatsapp(onWhatsapp);
// Abre de una el resumen de WhatsApp (lo mismo que pasar el mouse y tocar su píldora).
function openWaSummary() {
  if (mini || !card.classList.contains("hidden")) return;
  lastActivity = Date.now();
  toggleChat(false);
  appsBox.classList.remove("hidden");
  if (openApp === "wa") waViewed();
  openApp = openApp === "wa" ? null : "wa";
  if (openApp === "wa") waOpenedAt = Date.now();
  renderApps();
  renderAppView();
}
const WA_BUSY = () => t("WhatsApp · resumiendo…");
function onWhatsapp(d, alert) {
  const was = whatsapp ? waCount() : null;
  const wasBusy = whatsapp?.busy === true;
  whatsapp = d;
  // El botón de la barra: cuántos chats te esperan, girando mientras se resume.
  const n = waCount();
  const showBtn = d.read === true && (n > 0 || d.busy === true);
  if (showBtn === waBtn.classList.contains("hidden")) { waBtn.classList.toggle("hidden", !showBtn); relayout(); }
  waBtn.textContent = n > 0 ? String(n) : "";
  waBtn.classList.toggle("busy", d.busy === true);
  waBtn.classList.toggle("urgent", waChats().some((c) => c.urgent));
  if (!alert && !mini && !d.quiet && !root.classList.contains("wa-urgent")) {
    if (d.busy && !wasBusy) {
      // Igual que un chat de Claude trabajando: se ve que está en eso.
      setLabel(WA_BUSY());
      label.classList.add("show");
      relayout();
    } else if (!d.busy && wasBusy) {
      // Terminó: el resumen sale solo unos segundos (si todo era ruido de grupos, no dice nada).
      if (d.last) setState(state, `WhatsApp · ${d.last.name}: ${d.last.summary}`.slice(0, 90), { labelFor: 7000 });
      else if (label.textContent === WA_BUSY()) { label.classList.remove("show"); relayout(); }
    }
  }
  if (alert && !mini) {
    // Urgente: alarma roja, tres avisos y el mensaje fijo 12 s (nada que ver con el saludo normal).
    root.classList.add("wa-urgent");
    clearTimeout(urgentTimer);
    urgentTimer = setTimeout(() => root.classList.remove("wa-urgent"), 12000);
    [0, 450, 900].forEach((ms) => setTimeout(SOUNDS.needs, ms));
    setState("needs", `🚨 ${alert.name}: ${alert.summary}`.slice(0, 90), { labelFor: 12000, back: 12000 });
  } else if (was !== null && waCount() > was && !mini) {
    // Llegó un mensaje: saluda. El texto lo pone el resumen cuando esté (arriba).
    emote("hello", 1600);
    SOUNDS.hello();
    if (!d.busy && !d.read) setState(state, `WhatsApp: ${t("{0} sin leer", waCount())}`, { labelFor: 5000 });
  }
  renderApps();
  if (openApp === "wa") renderAppView();
}
api.trello().then((d) => { trelloData = d; });
api.onTrelloBusy((b) => { trelloBusy = Array.isArray(b) ? b : []; if (openApp === "trello") renderAppView(); });
api.onTrello((d) => {
  trelloData = d;
  // Aviso si una tarjeta pendiente de un tablero que abriste vence en menos de un día (una vez por tarjeta).
  const soon = Object.values(d.byBoard ?? {}).flatMap((x) => x.cards).find((c) => !c.done && c.due && Date.parse(c.due) - Date.now() < 864e5 && !alertedCards.has(c.url || c.name));
  if (soon) {
    alertedCards.add(soon.url || soon.name);
    emote("hello", 1600);
    SOUNDS.needs();
    setState(state, t("Trello: \"{0}\" vence {1}", soon.name, fmtDue(soon.due)).slice(0, 90), { labelFor: 6000 });
  }
  renderApps();
  if (openApp === "trello") renderAppView();
});

// GitHub: main.js consulta `gh` cada 5 min; si llega una notificación nueva, Nimbo avisa.
let github = null; // null = todavía no se sabe
// Plan del día (plan.js en main): llega al arrancar, cada 30 min y cuando lo pides.
let dayPlan = null; // { fecha, resumen, proyectos, solos, teNecesitan, say }
const fmtPlanDate = (iso) => (iso === new Date().toLocaleDateString("sv") ? t("hoy") : new Date(iso + "T12:00").toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" }));
function onPlan(p) {
  dayPlan = p;
  renderApps();
  if (openApp === "plan") renderAppView();
  if (p?.fresh && !mini) announcePlan();
}
// Lo muestra en la isla y lo dice (con la voz del tema, si está activada).
function announcePlan() {
  emote("hello", 1600);
  SOUNDS.hello();
  setState(state, `${t("Plan de hoy")} · ${t("{0} solos · {1} con propuesta para ti", dayPlan.solos, dayPlan.teNecesitan)}`, { labelFor: 9000 });
  speak(dayPlan.say);
}
// "dame el plan de hoy" en el chat: se responde aquí mismo, al instante y sin gastar Claude.
const PLAN_ASK = /^\W*(dame|dime|mu[eé]strame|cu[aá]l es|show me|give me|what(?:'s| is))?\s*(el |mi |the |my |today'?s )?plan( de hoy| del d[ií]a| for today| of the day)?\W*$/i;
async function answerPlan() {
  answer.replaceChildren(el("div", "", t("Pensando…")));
  answerBox.classList.remove("hidden");
  // Si ya lo tiene, lo da al instante; solo espera a traerlo cuando todavía no hay ninguno.
  const p = dayPlan ?? (await api.plan().catch(() => null));
  if (p) dayPlan = p;
  const text = p ? p.say : t("No tengo el plan de hoy: no está configurado, no hay conexión o todavía no ha salido.");
  answer.replaceChildren(el("div", "reply", text));
  speak(text);
  if (p) { appsBox.classList.remove("hidden"); openApp = "plan"; renderApps(); renderAppView(); }
}
api.onPlan(onPlan);
// Música: "spotify <canción>", "reproduce <canción>" o "pon <canción> en spotify" en el chat. Busca
// tu claude con el conector de Spotify (sin claves); la que elijas se abre en tu app de Spotify.
function onMedia(m) {
  media = m;
  renderApps();
  if (openApp === "spotify") renderAppView();
}
// Volvió el permiso de Spotify (Premium): se avisa y, si el panel de conexiones está abierto, se refresca.
api.onTelegram(() => { if (!setupBox.classList.contains("hidden")) api.setup().then(renderSetup); });
api.onSpotify((ok) => {
  setState(state, ok ? t("Spotify conectado ♪") : t("No se pudo conectar Spotify."), { labelFor: 4500 });
  if (!setupBox.classList.contains("hidden")) api.setup().then(renderSetup);
});
api.media().then(onMedia);
// Correo: llega la lista (y si hay un importante que no habías visto, la isla lo dice).
const seenMail = new Set();
function onMail(d) {
  const fresh = d?.on ? d.emails.find((e) => e.important && !seenMail.has(e.id)) : null;
  const first = mailData === null; // lo primero que llega al abrir Nimbo no se anuncia: ya lo habías visto
  mailData = d;
  for (const e of d?.emails ?? []) seenMail.add(e.id);
  if (fresh && !first && !mini) setState(state, `✉ ${fresh.from}: ${fresh.subject}`.slice(0, 80), { labelFor: 6000 });
  updateMailBtn();
  renderApps();
  if (openApp === "mail") renderAppView();
}
// El botón ✉ de la barra: visible mientras el correo esté activado; gira mientras revisa y muestra cuántos importan.
function updateMailBtn() {
  const show = mailData?.on === true;
  if (show === mailBtn.classList.contains("hidden")) { mailBtn.classList.toggle("hidden", !show); relayout(); }
  const n = (mailData?.emails ?? []).filter((e) => e.important).length;
  mailBtn.textContent = n ? `✉ ${n}` : "✉";
  mailBtn.classList.toggle("busy", mailBusy);
}
// Tocar el botón ES pedir el correo: se abre la lista con lo último que había y se vuelve a revisar (si pasaron 2 min).
function openMail() {
  if (mini || !card.classList.contains("hidden")) return;
  if (!mailData?.on) return; // apagado: el botón ni se ve (se activa en Conexiones)
  lastActivity = Date.now();
  toggleChat(false);
  appsBox.classList.remove("hidden");
  openApp = openApp === "mail" ? null : "mail";
  if (openApp === "mail" && !mailBusy && !(Date.now() - Date.parse(mailData.at || 0) < 120_000)) api.mailRefresh();
  renderApps();
  renderAppView();
}
api.onMailOpenUi(() => { if (!mailData?.on) openSetup(); else if (openApp !== "mail") openMail(); }); // desde el menú: apagado lleva a Conexiones, donde se activa
api.mail().then(onMail);
api.onMail(onMail);
api.onMailBusy((b) => { mailBusy = b; updateMailBtn(); if (openApp === "mail") renderAppView(); });
// "revisa mi correo": abre la lista (y la vuelve a pedir si tiene más de 30 min).
const MAIL_ASK = /^\W*(?:(?:revisa|mira|abre|dame|mu[eé]strame|c[oó]mo (?:va|est[aá])n?)\s+(?:mi\s+|mis\s+|el\s+|los\s+)?(?:correos?|e-?mails?|mail|gmail|bandeja de entrada)|(?:check|show)\s+(?:my\s+)?(?:e-?mail|mail|gmail|inbox))\W*$/i;
function answerMail() {
  if (!mailData?.on) {
    answer.replaceChildren(el("div", "reply", t("El correo está apagado: actívalo en Conexiones (necesita el conector de Gmail de tu Claude).")));
    return answerBox.classList.remove("hidden");
  }
  if (!mailBusy) api.mailRefresh(); // lo pediste: se revisa ahora
  appsBox.classList.remove("hidden");
  openApp = "mail";
  answer.replaceChildren(el("div", "reply", t("Revisando tu correo…")));
  answerBox.classList.remove("hidden");
  renderApps(); renderAppView();
}
api.onMedia(onMedia);
// Entrenador de entrevistas (src/main/interview.js): "entrenar entrevista para <puesto>". Nimbo pregunta, tú
// contestas escribiendo o dictando (🎤) y tu Claude evalúa y hace la siguiente. Mientras dura, lo que escribes
// en el chat es la respuesta; "terminar" sale. El estado vive aquí: no se guarda nada.
const INTERVIEW_START = /^\W*(?:(?:entrenar|practicar|simular|hacer)\s+(?:una\s+|mi\s+)?entrevistas?|entrenador de entrevistas?)(?:\s+(?:de|para|como|sobre)\s+(.+?))?\W*$|^\W*entrev[ií]stame(?:\s+(?:de|para|como)\s+(.+?))?\W*$|^\W*(?:interview me|mock interview|practice (?:an? )?interview)(?:\s+(?:for|as)\s+(.+?))?\W*$/i;
const INTERVIEW_END = /^\W*(?:terminar|termina|salir|fin|basta|stop|end|exit|quit|finish)\W*$/i;
const INTERVIEW_SKIP = /^\W*(?:siguiente|otra|pasar|skip|next|pass)\W*$/i;
const interviewStart = (text) => { const m = INTERVIEW_START.exec(text); return m ? { role: (m[1] ?? m[2] ?? m[3] ?? "").trim() } : null; };
let interview = null; // { role, awaitingRole, asked: [preguntas ya hechas], current, notes: [{ score, tip }] }

function interviewShow(lines) {
  answer.classList.remove("wait");
  answer.replaceChildren(...lines.map(([cls, text]) => el("div", cls, text)));
  answerBox.classList.remove("hidden");
  answer.scrollTop = 0;
}
async function interviewBegin(role) {
  interview = { role, awaitingRole: !role, asked: [], current: "", notes: [] };
  if (!role) return interviewShow([["reply", t("¿Para qué puesto quieres practicar? Escríbelo (por ejemplo: desarrollador junior).")]]);
  await interviewTurn(null);
}
// `text`: tu respuesta · "" = pasar a otra pregunta · null = la primera pregunta (o el puesto, si faltaba).
async function interviewTurn(text) {
  const s = interview;
  if (s.awaitingRole) { s.role = text.slice(0, 80); s.awaitingRole = false; text = null; }
  stopSpeaking();
  answer.replaceChildren(el("div", "", t("Pensando…")));
  answer.classList.add("wait");
  answerBox.classList.remove("hidden");
  progressStart(12_000);
  const r = await api.interview({ role: s.role, asked: s.asked, current: s.current, answer: text ?? "" }).catch(() => null);
  progressEnd();
  // Si falla se queda en la misma pregunta: puedes volver a enviar tu respuesta.
  if (!r || r.error) return interviewShow([["reply", t("No pude hablar con Claude.")]]);
  const lines = [];
  if (text && r.feedback !== undefined) {
    s.notes.push({ score: r.score, tip: r.tip });
    lines.push(["reply", `${"★".repeat(r.score)}${"☆".repeat(5 - r.score)}  ${r.feedback}`]);
    if (r.tip) lines.push(["afoot", `💡 ${r.tip}`]);
    if (r.better) lines.push(["afoot", `✍ ${t("Mejor así")}: ${r.better}`]);
  }
  if (s.current) s.asked.push(s.current);
  s.current = r.next;
  const n = s.asked.length + 1;
  lines.push(["reply", `${t("Pregunta {0}", n)}: ${r.next}`], ["afoot", t("Responde escribiendo o dictando 🎤. Di «terminar» para salir o «siguiente» para otra pregunta.")]);
  interviewShow(lines);
  setState(state, t("Entrevista · pregunta {0}", n), { labelFor: 3500 });
  speak(r.next); // solo la pregunta: cada letra dicha gasta cuota de voz
}
function interviewEnd() {
  const s = interview;
  interview = null;
  const n = s.notes.length;
  if (!n) return interviewShow([["reply", t("Entrevista terminada.")]]);
  const tips = [...new Set(s.notes.map((x) => x.tip).filter(Boolean))].slice(-3);
  interviewShow([["reply", t("Entrevista terminada: {0} respuestas, promedio {1}/5.", n, (s.notes.reduce((a, x) => a + x.score, 0) / n).toFixed(1))], ...tips.map((x) => ["afoot", `💡 ${x}`])]);
}

const MUSIC_ASK =/^\W*(?:spotify[:,]?\s+(.+)|(?:pon(?:me)?|reproduce|toca|busca(?:me)?|play|search|find)\s+(.+?)\s+(?:en|on|in)\s+spotify|(?:reproduce|play)\s+(.+))$/i;
const musicQuery = (text) => {
  const m = MUSIC_ASK.exec(text);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").replace(/^(la canci[oó]n|the song)\s+/i, "").replace(/[\s.!?¡¿]+$/, "");
};
async function answerMusic(query) {
  stopSpeaking();
  answer.replaceChildren(el("div", "", t("Buscando en Spotify…")));
  answer.classList.add("wait");
  answerBox.classList.remove("hidden");
  progressStart(20_000);
  const r = await api.spotifySearch(query).catch(() => null);
  progressEnd();
  answer.classList.remove("wait");
  if (!r || r.error || !r.connected) {
    const link = el("button", "", "claude.ai");
    link.type = "button";
    link.onclick = () => api.setupDo("open", "connectors");
    answer.replaceChildren(el("div", "reply", r?.connected === false ? t("Activa el conector de Spotify en claude.ai y vuelve a intentar.") : t("No pude buscar en Spotify.")), ...(r?.connected === false ? [link] : []));
    return;
  }
  if (!r.tracks.length) { answer.replaceChildren(el("div", "reply", t("No encontré \"{0}\" en Spotify.", query))); return; }
  answer.replaceChildren(el("div", "afoot", r.plays ? t("Spotify · toca una para escucharla") : t("Spotify · toca una para abrirla")), ...r.tracks.map((s) => {
    const row = el("div", "arow link");
    const name = el("span", "name");
    name.append(el("b", "", s.title), el("i", "", s.artist));
    name.title = `${s.title} · ${s.artist}`;
    row.append(el("span", "chip2 green", "♪"), name);
    row.onclick = async () => {
      const p = await api.spotifyPlay(s.uri).catch(() => null);
      // Con Premium suena; sin eso (o si algo falla) Spotify abre la página de la canción.
      const said = p?.ok || p?.opened ? `♪ ${s.title}` : p?.error === "premium" ? t("Spotify pide Premium para elegir la canción; la abrí allá.")
        : p?.error === "device" ? t("Abrí Spotify: cuando cargue, toca la canción otra vez.") : t("No pude ponerla a sonar; la abrí en Spotify.");
      setState(state, said.slice(0, 70), { labelFor: 4500 });
      // Debajo queda la tarjeta de lo que suena, con sus botones.
      appsBox.classList.remove("hidden"); openApp = "spotify"; renderApps(); renderAppView();
    };
    return row;
  }));
  answer.scrollTop = 0;
}
api.onGithub((list) => {
  const before = github;
  github = Array.isArray(list) ? list.slice(0, 50) : [];
  if (before && github.length > before.length) {
    emote("hello", 1600);
    SOUNDS.hello();
    setState(state, `GitHub: ${github[0].title}`.slice(0, 90), { labelFor: 5000 });
  }
  renderSessions();
  renderApps();
  if (openApp === "github") renderAppView();
});
setInterval(() => { renderSessions(); renderPips(); }, 5000); // refresca los "hace 2m" y quita los viejos

function handle(p) {
  const who = p.title || base(p.cwd ?? "") || "Claude";
  switch (p.hook_event_name) {
    case "SessionStart":
      track(p, "idle", t("empezó"));
      setState("idle", t("Hola 👋 · {0}", who), { labelFor: 3500 });
      SOUNDS.hello();
      break;
    case "UserPromptSubmit": {
      const asked = (p.prompt ?? t("Pensando…")).replace(/\s+/g, " ").slice(0, 70);
      track(p, "thinking", asked);
      setState("thinking", `${who} · ${asked}`);
      break;
    }
    case "PreToolUse": {
      const step = toolLabel(p.tool_name, p.tool_input);
      track(p, "working", step);
      setState("working", `${who} · ${step}`);
      break;
    }
    case "PostToolUse":
      track(p, "working");
      if (state !== "working") setState("working", label.textContent);
      break;
    case "PostToolUseFailure": {
      const step = t("⚠ Falló · {0}", toolLabel(p.tool_name, p.tool_input));
      track(p, "working", step);
      setState("working", `${who} · ${step}`);
      break;
    }
    case "Notification":
      // Permisos pendientes o "esperando tu respuesta": las dos cosas te necesitan.
      track(p, "needs", p.message ?? t("te necesita"));
      setState("needs", `${who}: ${p.message ?? t("te necesita")}`);
      SOUNDS.needs();
      break;
    case "Stop":
      track(p, "finished", t("terminó"));
      setState("finished", t("¡Listo! · {0}", who), { back: 5000 });
      SOUNDS.finish();
      break;
    case "StopFailure":
      track(p, "error", t("falló"));
      setState("error", t("Algo falló en {0} 😢", who), { back: 8000, labelFor: 2500 });
      SOUNDS.error();
      break;
    case "SessionEnd":
      track(p, null);
      settle();
      break;
  }
}
window.handleHook = handle; // para probar a mano desde la consola
api.onHook(handle);
api.onMuted((m) => { muted = m; if (m) stopSpeaking(); });

// --- Ojos que siguen el cursor ---
api.onCursor(({ x, y }) => {
  const r = svg.getBoundingClientRect();
  const s = r.width / 240;
  const dx = x - (r.left + 120 * s);
  const dy = y - (r.top + 64 * s);
  if (lookOverride) return; // está mirando alrededor por su cuenta
  Jarvis.look(dx, dy);
  let lx = Math.tanh(dx / 260);
  let ly = Math.tanh(dy / 200);
  // Pensando: mira arriba a la derecha, con solo un 35 % de atención al cursor.
  if (state === "thinking") { lx = .35 * lx + .65 * .55; ly = .35 * ly - .65 * .55; }
  look.style.transform = `translate(${lx * 3.8}px,${ly * 3}px)`;
});

// --- Parpadeo: cierra en 70 ms, abre en 130; cada 2,2–5,4 s; 22 % de las veces, doble ---
function blink(double = Math.random() < .22) {
  if (state === "sleeping" || /emote-dizzy/.test(root.className)) return;
  for (const eye of document.querySelectorAll(".eyes-open .eye")) {
    eye.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(.06)", offset: .35, easing: "cubic-bezier(.2,.8,.3,1)" }, { transform: "scaleY(1)" }],
      { duration: 200, easing: "cubic-bezier(.45,0,.55,1)" });
  }
  if (double) setTimeout(() => blink(false), 230);
}
(function blinkLoop() {
  setTimeout(() => { blink(); blinkLoop(); }, 2200 + Math.random() * 3200);
})();

api.onMini((m) => {
  mini = m;
  root.classList.toggle("mini", m);
  if (m) toggleChat(false);
  else { lastSize = { w: 0, h: 0 }; relayout(); showReminder(); }
});

// --- Interacción: la ventana solo atrapa el mouse sobre la nube y las cajas ---
const hit = document.getElementById("hit");
// Le cuenta al proceso principal dónde están las partes tocables; él decide, con la
// posición real del cursor, cuándo la ventana acepta clics.
let lastRects = "";
function reportHitRects() {
  const rects = [...document.querySelectorAll("#hit, .solid")]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width && r.height)
    .map((r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
  const key = JSON.stringify(rects);
  if (key !== lastRects) {
    lastRects = key;
    api.hitRects(rects);
  }
}
// ponytail: sondeo cada 200 ms en vez de observar cada cambio de layout; son 2–4 rectángulos.
setInterval(reportHitRects, 200);
// Al pasar el mouse: despierta y muestra los chats activos (si el chat no está abierto).
let hoverTimer, loveTimer;
let lastLove = 0;
api.onHover((on) => {
  clearTimeout(hoverTimer);
  clearTimeout(loveTimer);
  root.classList.toggle("hovering", on && !mini);
  if (on) {
    lastActivity = Date.now();
    blink(false);
    SOUNDS.hover();
    loveTimer = setTimeout(() => {
      if (Date.now() - lastLove > 6000 && !emoting()) { lastLove = Date.now(); emote("love", 1500); SOUNDS.love(); }
    }, 1900);
    if (state === "sleeping") setState("idle");
    if (!mini && chat.classList.contains("hidden") && card.classList.contains("hidden") && remindCard.classList.contains("hidden") && setupBox.classList.contains("hidden") && appsList().length) {
      appsBox.classList.remove("hidden");
      renderApps();
    }
  } else {
    hoverTimer = setTimeout(() => hidePanel(), 700);
  }
});

// --- Conexiones y ajustes: qué está conectado y cómo conectar lo que falta ---
// Se abre solo la primera vez y desde el menú. Cada fila: punto verde/ámbar, qué es, y su botón.
const setupBox = document.getElementById("setup");
let setupBusy = "";
function renderSetup(s) {
  const act = async (action, value) => {
    setupBusy = action;
    renderSetup(s);
    const next = await api.setupDo(action, value);
    setupBusy = "";
    if (!setupBox.classList.contains("hidden")) renderSetup(next);
  };
  const btn = (text, action, value, cls = "") => {
    const b = el("button", cls, setupBusy === action ? "…" : text);
    b.type = "button";
    b.disabled = !!setupBusy;
    b.onclick = () => act(action, value);
    return b;
  };
  const row = (ok, title, text, ...actions) => {
    const r = el("div", "crow");
    const info = el("div", "cinfo");
    const line = el("span");
    // `así` en el texto se muestra como código (para los comandos que hay que escribir).
    text.split("`").forEach((part, i) => line.append(i % 2 ? el("code", "", part) : part));
    info.append(el("b", "", title), line);
    r.append(el("span", `cdot ${ok === true ? "on" : ok === false ? "off" : ""}`), info, ...actions);
    return r;
  };
  const head = el("div", "ahead");
  const close = el("button", "allow", t("Listo"));
  close.type = "button";
  close.onclick = () => { api.setupDo("done"); closeSetup(); };
  head.append(el("b", "", t("Conexiones")), el("span", "sub", t("lo que Nimbo puede ver")), btn(t("Guía"), "open", "guide"), close);

  const name = el("input");
  name.value = s.name;
  name.placeholder = t("Tu nombre");
  name.maxLength = 30;
  name.onchange = () => api.setupDo("name", name.value);

  const claude = !s.claude ? row(false, "Claude Code", t("No lo encontré en este equipo."), btn(t("Cómo instalarlo"), "open", "claude"))
    : s.hooks === "on" ? row(true, "Claude Code", t("Conectado: ve tus chats y te pasa los permisos."), btn(t("Desconectar"), "hooks-off"))
    : s.hooks === "stale" ? row(false, "Claude Code", t("La conexión apunta a otra carpeta."), btn(t("Reconectar"), "hooks-on", null, "allow"))
    : s.hooks === "error" ? row(false, "Claude Code", t("No pude leer `~/.claude/settings.json`: revisa que sea JSON válido."))
    : row(false, "Claude Code", t("Conéctalo para ver tus chats en vivo y aprobar permisos."), btn(t("Conectar"), "hooks-on", null, "allow"));
  const github = s.github === "on" ? row(true, "GitHub", t("Conectado con tu sesión de gh."))
    : s.github === "off" ? row(false, "GitHub", t("Abre una terminal y escribe `gh auth login`."))
    : row(null, "GitHub", t("Opcional: avisa de tus notificaciones."), btn(t("Instalar GitHub CLI"), "open", "gh"));
  const trello = s.trello !== null ? row(true, "Trello", t(s.trello === 1 ? "Conectado: {0} tablero." : "Conectado: {0} tableros.", s.trello), btn(t("Actualizar"), "trello"))
    : row(null, "Trello", t("Opcional: activa el conector de Trello en claude.ai y pulsa Probar (tarda 1 min)."), btn("claude.ai", "open", "connectors"), btn(t("Probar"), "trello"));
  const wa = s.platform && s.platform !== "win32" ? row(null, "WhatsApp", t("Solo funciona en Windows: lee las notificaciones de Windows."))
    : s.whatsappRead ? row(true, "WhatsApp", s.whatsappBrain === "claude" ? t("Lo resume tu propio Claude. Con Ollama lo haría un modelo local, sin gastar tokens.")
      : s.whatsappBrain === "kimi" ? t("Lo resume Kimi (Moonshot): el texto de los mensajes sale a sus servidores. Cámbialo en el menú → Quién resume WhatsApp.")
      : t("Lo resume un modelo local ({0}): nada sale de tu equipo.", s.whatsappBrain), btn(t("Reglas"), "whatsapp-rules"), btn(t("Apagar"), "whatsapp", false))
    : row(null, "WhatsApp", t("Opcional: tu propio Claude resume tus mensajes. Nada pasa por Nimbo ni por su autor."), btn(t("Activar"), "whatsapp", true));
  const auto = row(s.autostart ? true : null, (!s.platform || s.platform === "win32" ? t("Iniciar con Windows") : t("Iniciar con el sistema")), s.autostart ? t("Nimbo arranca al prender el equipo.") : t("Que Nimbo arranque solo al prender el equipo."),
    btn(s.autostart ? t("Quitar") : t("Activar"), "autostart", !s.autostart));

  const look = row(null, t("Apariencia"), s.theme === "cloud" ? t("Nube. Cada apariencia tiene su propia voz.") : t("JARVIS. Cada apariencia tiene su propia voz."),
    btn(s.theme === "cloud" ? "JARVIS" : t("Nube"), "theme", s.theme === "cloud" ? "jarvis" : "cloud"));
  const voiceRow = s.voice === null ? row(null, t("Voz"), t("Opcional: pon en prefs.json la dirección de un servicio de voz (`ttsUrl`)."))
    : s.voice ? row(true, t("Voz"), t("Lee sus respuestas en voz alta."), btn(t("Apagar"), "speak", false))
    : row(null, t("Voz"), t("Que Nimbo lea sus respuestas en voz alta."), btn(t("Activar"), "speak", true));
  // Spotify: lo que suena no necesita nada. Con Premium y tu propia app de Spotify, elegir una canción la pone a sonar.
  const spotifyId = el("input");
  spotifyId.placeholder = "Client ID";
  spotifyId.maxLength = 32;
  spotifyId.spellcheck = false;
  spotifyId.onchange = () => act("spotify-id", spotifyId.value);
  const spotify = s.spotify === true ? row(true, "Spotify", t("Conectado con Premium: eliges una canción y suena."), btn(t("Desconectar"), "spotify-logout"))
    : s.spotify === false ? row(false, "Spotify", t("Falta tu permiso: se abre Spotify en el navegador y aceptas. Si se abre donde no tienes tu sesión, pega el enlace en tu navegador: queda copiado."), btn(t("Quitar"), "spotify-id", ""), btn(t("Conectar"), "spotify-login", null, "allow"))
    : row(null, "Spotify", t("Lo que suena sale solo. Con Premium, elegir una canción la pone a sonar: pega el Client ID de tu app de Spotify."), spotifyId, btn(t("Guía"), "open", "spotify-guide"));
  // Telegram: hablar con Nimbo desde el celular. El token se pega aquí y va directo, cifrado, a tu PC.
  const tg = s.telegram ?? {};
  const tgToken = el("input");
  tgToken.type = "password";
  tgToken.placeholder = t("Token del bot");
  tgToken.spellcheck = false;
  tgToken.autocomplete = "off";
  tgToken.onchange = () => act("telegram-token", tgToken.value);
  const telegramRow = tg.paired ? row(true, "Telegram", t("Conectado con @{0}: escríbele a tu bot desde el celular.", tg.bot || "bot"), btn(t("Desconectar"), "telegram-logout"))
    : tg.token ? row(false, "Telegram", tg.pairing ? (tg.bot ? t("Envíale este código a @{0} en Telegram: {1}", tg.bot, tg.pairing) : t("Envíale este código a tu bot en Telegram: {0}", tg.pairing)) : t("Falta vincular tu cuenta: pulsa Vincular y te doy un código."), ...(tg.bot ? [btn(t("Abrir bot"), "open", "telegram-bot")] : []), btn(t("Quitar"), "telegram-logout"), btn(t("Vincular"), "telegram-pair", null, "allow"))
    : row(null, "Telegram", t("Opcional: habla con Nimbo desde el celular. Crea un bot con @BotFather y pega aquí su token."), tgToken, btn(t("Guía"), "open", "telegram-guide"));
  // Otras IAs: Ollama (local, gratis) se detecta solo; Gemini y OpenAI piden su clave, que se guarda cifrada en tu PC.
  const ai = s.ai ?? { providers: [], keyed: {}, ollama: "off" };
  const aiProv = el("select");
  const AI_NAMES = { gemini: "Gemini", openai: "OpenAI", kimi: "Kimi" };
  for (const [id, label] of Object.entries(AI_NAMES)) aiProv.append(Object.assign(document.createElement("option"), { value: id, textContent: label }));
  const aiKey = el("input");
  aiKey.type = "password";
  aiKey.placeholder = t("Clave de API");
  aiKey.spellcheck = false;
  aiKey.autocomplete = "off";
  aiKey.onchange = () => { if (aiKey.value.trim()) act("ai-key", `${aiProv.value}:${aiKey.value.trim()}`); };
  const others = ai.providers.filter((p) => p.id !== "claude");
  // Ollama en pocos clics para quien llega nuevo: instalarlo, abrirlo y descargar un modelo (con su peso a la vista), todo desde aquí.
  const aiText = ai.pull ? t("Descargando {0}… {1} % (puedes seguir usando Nimbo).", ai.recommended, ai.pull.percent)
    : others.length ? t("Disponibles: {0}. Elige cuál usar en el selector del chat.", others.map((p) => `${p.label} (${p.model})`).join(", "))
    : ai.ollama === "empty" ? t("Ollama está listo pero sin ningún modelo: descarga uno gratis con un clic (≈2 GB, una sola vez) o pega una clave de Gemini u OpenAI.")
    : ai.installed ? t("Ollama está instalado pero cerrado: ábrelo para usar una IA gratis en tu PC, o pega una clave de Gemini u OpenAI.")
    : t("Opcional: una IA gratis en tu PC. Instala Ollama (gratis) y descarga un modelo con un clic, o pega una clave de Gemini u OpenAI.");
  const ollamaBtns = ai.pull ? [btn(t("Cancelar descarga"), "ollama-pull-cancel")]
    : ai.ollama === "empty" ? [btn(t("Descargar modelo gratis (≈2 GB)"), "ollama-pull", null, "allow")]
    : ai.ollama === "off" ? [ai.installed ? btn(t("Abrir Ollama"), "ollama-open") : btn(t("Instalar Ollama (gratis)"), "open", "ollama")] : [];
  const aiRow = row(others.length ? true : null, t("Otras IAs"), aiText, ...ollamaBtns, aiProv, aiKey,
    ...Object.keys(AI_NAMES).filter((id) => ai.keyed?.[id]).map((id) => btn(t("Quitar {0}", AI_NAMES[id]), "ai-key-clear", id)), btn(t("Guía"), "open", "ai-guide"));
  // Correo: tu Gmail por el conector de tu Claude (solo lectura). Apagado hasta que lo activas; al activarlo se comprueba de verdad.
  const mailRow = s.mail?.on ? row(true, t("Correo"), t("Solo revisa cuando tú lo pides: toca el botón ✉ de la barra, escribe «revisa mi correo» o usa /correo en Telegram. Ahora: {0} sin leer, {1} importantes.", s.mail.count, s.mail.important), btn(t("Revisar ahora"), "mail-refresh"), btn(t("Apagar"), "mail-off"))
    : row(null, t("Correo"), t("Opcional: Nimbo revisa tu Gmail (solo lectura, con el conector de Gmail de tu Claude) y te dice cuáles correos importan."), btn("claude.ai", "open", "connectors"), btn(t("Activar"), "mail-on", null, "allow"));
  const rows = [head, claude, row(s.name ? true : null, t("Tu nombre"), t("Para saludarte."), name), github, trello, mailRow, spotify, telegramRow, aiRow, wa, look, voiceRow, auto];
  if (s.error) rows.push(el("div", "afoot", t("No se pudo: {0}", s.error)));
  setupBox.replaceChildren(...rows);
}
async function openSetup() {
  if (mini) return;
  hidePanel();
  toggleChat(false);
  renderSetup(await api.setup());
  setupBox.classList.remove("hidden");
  api.chatOpen(true); // la ventana acepta teclado mientras el panel está abierto (para el nombre)
}
function closeSetup() {
  setupBox.classList.add("hidden");
  api.chatOpen(false);
}
api.onSetupOpen(openSetup);

// --- Gestos: hola, cariño, mareo, bostezo, tragar ---
let emoteTimer;
function emote(name, ms = 1400) {
  root.className = root.className.replace(/\s*emote-\w+/g, "");
  void root.offsetWidth; // fuerza a que las animaciones del gesto empiecen de nuevo
  root.classList.add(`emote-${name}`);
  Jarvis.emote(name, ms);
  clearTimeout(emoteTimer);
  emoteTimer = setTimeout(() => root.classList.remove(`emote-${name}`), ms);
}
const emoting = () => /emote-/.test(root.className);

// Un clic abre/cierra el chat; varios seguidos son "cariños"; muchos lo marean.
let clicks = 0;
let clickTimer;
wrap.addEventListener("click", (e) => {
  if (e.target.closest("#menuBtn")) return api.menu();
  if (e.target.closest("#waBtn")) return openWaSummary();
  if (e.target.closest("#mailBtn")) return openMail();
  // composedPath y no closest(): una píldora se redibuja en su propio clic, y para cuando el
  // evento llega aquí el botón ya no está en la página (closest daba null y se abría el chat).
  if (e.composedPath().includes(content) || suppressClick) return;
  lastActivity = Date.now();
  clicks++;
  clearTimeout(clickTimer);
  SOUNDS.poke();
  Jarvis.poke();
  root.classList.remove("poke"); void root.offsetWidth; root.classList.add("poke");
  setTimeout(() => root.classList.remove("poke"), 650);
  if (clicks === 1) {
    clickTimer = setTimeout(() => {
      clicks = 0;
      if (mini) api.toggleMini(); // tocarlo en mini lo devuelve a su tamaño
      else toggleChat();
    }, 280);
    return;
  }
  if (clicks === 2) { emote("love", 1500); SOUNDS.love(); }
  if (clicks === 5) { emote("dizzy", 2600); SOUNDS.dizzy(); setState(state, t("Ya, ya… 😵‍💫"), { labelFor: 2200 }); }
  clickTimer = setTimeout(() => (clicks = 0), 900);
});

// --- Vida propia en reposo: mira alrededor, se estira, bosteza si llevas rato sin usarlo ---
let lastActivity = Date.now();
let lookOverride = false;
(function idleLife() {
  setTimeout(() => {
    const quiet = state === "idle" && !emoting() && chat.classList.contains("hidden") && !mini;
    if (quiet) {
      const roll = Math.random();
      if (Date.now() - lastActivity > 60_000 && roll < 0.35) {
        emote("yawn", 1500);
        SOUNDS.yawn();
      } else if (roll < 0.75) {
        // Mira a un lado y al otro, ignorando el cursor un momento.
        lookOverride = true;
        const side = Math.random() < 0.5 ? -1 : 1;
        look.style.transform = `translate(${3 * side}px,0)`;
        Jarvis.look(260 * side, 0);
        setTimeout(() => { look.style.transform = `translate(${-3 * side}px,0)`; Jarvis.look(-260 * side, 0); }, 700);
        setTimeout(() => (lookOverride = false), 1400);
      } else {
        root.classList.remove("poke"); void root.offsetWidth; root.classList.add("poke");
        setTimeout(() => root.classList.remove("poke"), 650);
      }
    }
    idleLife();
  }, 9000 + Math.random() * 11000);
})();
wrap.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea")) return; // ahí sirve el menú de copiar/pegar
  e.preventDefault();
  api.menu();
});

// --- Nivel 2: aprobar permisos desde la nube ---
const card = document.getElementById("card");
const FIELDS = ["command", "file_path", "path", "url", "query", "pattern", "prompt", "description"];
let cardRid = "";
api.onPermission((p) => {
  const input = p.tool_input ?? {};
  const field = FIELDS.find((k) => typeof input[k] === "string" && input[k].trim());
  // Se muestra el comando o archivo completo: aprobar "Bash" a ciegas no sirve de nada.
  card.querySelector(".what").textContent = t("{0} quiere usar {1}", p.title || base(p.cwd ?? ""), p.tool_name ?? t("una herramienta"));
  hidePanel();
  // Completo y sin recortar a ciegas: el campo principal y, debajo, el resto de lo que manda
  // (p. ej. el contenido de un Write o el cambio de un Edit). Si es largo, la caja hace scroll.
  const rest = Object.entries(input).filter(([k, v]) => k !== field && v !== undefined && v !== "")
    .map(([k, v]) => `— ${k} —\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);
  card.querySelector(".cmd").textContent = [field ? input[field] : "", ...rest].filter(Boolean).join("\n\n").slice(0, 20000);
  card.querySelector(".cmd").scrollTop = 0;
  cardRid = p.rid;
  // "Siempre": Claude Code propone reglas (p. ej. Bash(npm test:*)); hook.js se las devuelve.
  const rules = (Array.isArray(p.permission_suggestions) ? p.permission_suggestions : [])
    .flatMap((x) => x.rules ?? []).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName));
  const always = document.getElementById("always");
  always.classList.toggle("hidden", !rules.length);
  always.title = t("Permitir siempre: {0}", rules.join(", "));
  // Lo que "Siempre" dejaría aprobado para el futuro, a la vista (no solo en un tooltip).
  const rulesLine = document.getElementById("alwaysRules");
  rulesLine.textContent = t("\"Siempre\" aprobaría: {0}", rules.join(", "));
  rulesLine.classList.toggle("hidden", !rules.length);
  setState("needs");
  card.classList.remove("hidden");
  SOUNDS.needs();
});
card.addEventListener("click", (e) => {
  const d = e.target.dataset?.d;
  if (d === undefined) return;
  api.decide(d, cardRid);
  card.classList.add("hidden");
  const text = { allow: t("Aprobado ✓"), always: t("Aprobado para siempre ✓"), deny: t("Denegado ✋"), "": t("Te pregunta en la terminal") }[d];
  setState(d === "allow" || d === "always" ? "working" : "idle", text, { labelFor: 2500 });
});
api.onPermissionDone(() => card.classList.add("hidden"));

// --- Recordatorios: main.js los avisa cuando vencen; aquí la tarjeta y la lista de pendientes ---
const remindCard = document.getElementById("remind");
const remindQueue = [];
let pendingList = [];
api.reminders().then((l) => { pendingList = l ?? []; });
api.onReminders((l) => {
  pendingList = l ?? [];
  renderSessions();
  renderApps();
  if (openApp === "pend") renderAppView();
});
api.onReminder((r) => { remindQueue.push(r); showReminder(); });
// "hoy 3:00 p. m.", "mañana 9:00 a. m.", "vie 3 oct, 9:00 a. m." o t("sin fecha")
function fmtDue(iso) {
  if (!iso) return t("sin fecha");
  const d = new Date(iso);
  const hour = d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  const day = (offset) => { const t = new Date(); t.setDate(t.getDate() + offset); return t.toDateString(); };
  if (d.toDateString() === day(0)) return t("hoy {0}", hour);
  if (d.toDateString() === day(1)) return t("mañana {0}", hour);
  return `${d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" })}, ${hour}`;
}
function showReminder() {
  const r = remindQueue[0];
  if (!r || mini || !remindCard.classList.contains("hidden")) return;
  remindCard.dataset.id = r.id;
  remindCard.querySelector(".rtext").textContent = r.text;
  remindCard.querySelector(".rdue").textContent = fmtDue(r.due);
  hidePanel();
  remindCard.classList.remove("hidden");
  setState("needs", `⏰ ${r.text}`);
  emote("hello", 1400);
  SOUNDS.needs();
}
remindCard.addEventListener("click", (e) => {
  const action = e.target.dataset?.r;
  if (!action) return;
  const id = remindCard.dataset.id;
  if (action === "done") api.reminderDone(id);
  else api.reminderSnooze(id, 10);
  remindQueue.shift();
  remindCard.classList.add("hidden");
  setState(state, action === "done" ? t("✓ Hecho") : t("⏰ Te aviso en 10 min"), { labelFor: 2200 });
  setTimeout(() => { settle(); showReminder(); }, 2300);
});

// --- Chat con Claude (clic en la nube) ---
const chat = document.getElementById("chat");
const msg = document.getElementById("msg");
const answer = document.getElementById("answer");
const answerBox = document.getElementById("answerBox");
const rail = document.getElementById("rail");
const thumb = document.getElementById("thumb");

function updateRail() {
  const { scrollTop, scrollHeight, clientHeight } = answer;
  const on = scrollHeight > clientHeight + 2;
  rail.classList.toggle("on", on);
  if (!on) return;
  const h = rail.clientHeight;
  const th = Math.max(18, (h * clientHeight) / scrollHeight);
  thumb.style.height = `${th}px`;
  thumb.style.top = `${((h - th) * scrollTop) / (scrollHeight - clientHeight)}px`;
}
answer.addEventListener("scroll", updateRail);
new MutationObserver(updateRail).observe(answer, { childList: true, subtree: true, characterData: true });
new ResizeObserver(updateRail).observe(answerBox);
let asking = false;

function toggleChat(open = chat.classList.contains("hidden")) {
  chat.classList.toggle("hidden", !open);
  if (!open) answerBox.classList.add("hidden");
  api.chatOpen(open);
  if (open) setTimeout(() => msg.focus(), 60);
}
msg.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleChat(false); });

// --- Adjuntos: soltar sobre Nimbo, 📎 o Ctrl+V (sirve con capturas de Win+Shift+S) ---
// Las imágenes van dentro del mensaje; el resto (PDF, código, texto…) va por su ruta y
// el orquestador lo lee con Read (solo lectura).
const thumbs = document.getElementById("thumbs");
const fileInput = document.getElementById("file");
const MAX_IMAGE = 5 * 1024 * 1024; // límite de la API por imagen
const MAX_FILES = 10;
let images = []; // { media_type, data, url }
let files = []; // { path, name }

function addFile(file) {
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type) && file.size <= MAX_IMAGE) return addImage(file);
  const p = api.filePath(file);
  if (!p || files.length >= MAX_FILES || files.some((f) => f.path === p)) return;
  files.push({ path: p, name: file.name });
  renderThumbs();
}

function addImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return;
  if (file.size > MAX_IMAGE) {
    answer.textContent = t("\"{0}\" pesa más de 5 MB.", file.name);
    answer.classList.remove("wait");
    answerBox.classList.remove("hidden");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    images.push({ media_type: file.type, data: reader.result.split(",")[1], url: reader.result });
    renderThumbs();
  };
  reader.readAsDataURL(file);
}
function renderThumbs() {
  const imgs = images.map((img, i) => {
    const e = document.createElement("img");
    e.src = img.url;
    e.title = t("Quitar");
    e.onclick = () => { images.splice(i, 1); renderThumbs(); };
    return e;
  });
  const chips = files.map((f, i) => {
    const c = el("div", "chip");
    c.title = `${f.path}\n${t("(clic para quitar)")}`;
    c.append("📄", el("span", "", f.name));
    c.onclick = () => { files.splice(i, 1); renderThumbs(); };
    return c;
  });
  thumbs.replaceChildren(...imgs, ...chips);
}
document.getElementById("attach").addEventListener("click", () => fileInput.click());
// 🖥 Ver mi pantalla: un pantallazo que queda como miniatura (se puede quitar) hasta que envíes.
const shotBtn = document.getElementById("shot");
shotBtn.addEventListener("click", async () => {
  if (shotBtn.disabled) return;
  shotBtn.disabled = true;
  const shot = await api.screenshot().catch(() => null);
  shotBtn.disabled = false;
  if (shot?.data) {
    images.push({ media_type: shot.media_type, data: shot.data, url: `data:${shot.media_type};base64,${shot.data}`, screen: true });
    renderThumbs();
    SOUNDS.poke();
    if (!msg.value) msg.placeholder = t("¿Qué necesitas de lo que ves en mi pantalla?");
  } else {
    setState(state, t("No pude tomar el pantallazo"), { labelFor: 3000 });
  }
  msg.focus();
});
fileInput.addEventListener("change", () => { [...fileInput.files].forEach(addFile); fileInput.value = ""; msg.focus(); });
msg.addEventListener("paste", (e) => [...e.clipboardData.files].forEach(addFile));

// Soltar archivos sobre Nimbo: abre la boca mientras pasan por encima y se los traga.
// Fin del arrastre por vigilante: mientras el archivo está encima llegan "dragover" cada
// pocos ms; si dejan de llegar (lo soltaste en otro lado, cancelaste o la ventana dejó de
// recibir el mouse al salir de la isla), Nimbo vuelve a la normalidad. Contar
// dragenter/dragleave fallaba: al salir de la isla Windows ya no avisa y quedaba trabado.
const charEl = document.getElementById("char");
let dragWatch = 0;
let swallowing = false;
function startDrop() {
  if (root.classList.contains("dropping")) return;
  hidePanel();
  root.classList.add("drag-over", "dropping");
  Jarvis.setLevel(0.6);
  relayout();
}
function endDrop() {
  clearTimeout(dragWatch);
  root.classList.remove("drag-over", "dropping");
  charEl.style.left = "";
  Jarvis.setLevel(0);
  lastSize = { w: 0, h: 0 };
  relayout();
}
function watchDrag() {
  clearTimeout(dragWatch);
  dragWatch = setTimeout(() => { if (!swallowing) endDrop(); }, 350);
}
document.addEventListener("dragenter", (e) => { e.preventDefault(); startDrop(); watchDrag(); });
// Mientras arrastras, el personaje grande sigue al cursor por la isla.
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  startDrop();
  watchDrag();
  const w = wrap.getBoundingClientRect();
  const cw = charEl.offsetWidth;
  charEl.style.left = `${Math.max(8, Math.min(w.width - cw - 8, e.clientX - w.left - cw * .46))}px`;
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  clearTimeout(dragWatch);
  const dropped = [...(e.dataTransfer?.files ?? [])];
  if (!dropped.length) return endDrop();
  swallow(dropped, e.clientX, e.clientY);
});

// Cada archivo vuela de donde lo soltaste a la boca: primero se levanta un poco
// (anticipación) y luego acelera encogiéndose, como absorbido por un embudo.
function swallow(dropped, x, y) {
  swallowing = true;
  const c = charEl.getBoundingClientRect();
  const mx = c.left + c.width * .5;
  const my = c.top + c.height * .62;
  const flights = dropped.slice(0, 5).map((file, i) => {
    const f = el("div", "flyer");
    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      f.append(img);
    } else f.append("📄");
    f.append(el("span", "", file.name));
    document.body.append(f);
    const { width: fw, height: fh } = f.getBoundingClientRect();
    const at = (px, py, sx, sy, r) => `translate(${px - fw / 2}px,${py - fh / 2}px) scale(${sx},${sy}) rotate(${r}deg)`;
    return f.animate([
      { transform: at(x, y, 1, 1, 0), opacity: 1 },
      { transform: at(x, y - 12, 1.08, 1.08, -4), opacity: 1, offset: .2 },
      { transform: at((x + mx) / 2, (y + my) / 2, .6, .45, 6), opacity: 1, offset: .7 },
      { transform: at(mx, my, .1, .05, 10), opacity: .2 },
    ], { duration: 560, delay: i * 90, easing: "cubic-bezier(.55,0,.85,.35)", fill: "forwards" }).finished.then(() => f.remove());
  });
  Promise.all(flights).then(() => {
    root.classList.remove("drag-over"); // cierra la boca: traga
    emote("gulp", 700);
    SOUNDS.gulp();
    setTimeout(() => { root.classList.add("chew"); setTimeout(() => root.classList.remove("chew"), 460); }, 380);
    // Después de masticar, la isla vuelve a su tamaño con el chat abierto y los adjuntos.
    setTimeout(() => {
      swallowing = false;
      endDrop();
      dropped.forEach(addFile);
      if (chat.classList.contains("hidden")) toggleChat(true);
      setState(state, dropped.length === 1 ? t("Me tragué \"{0}\" 📎", dropped[0].name) : t("Me tragué {0} archivos 📎", dropped.length), { labelFor: 2500 });
    }, 900);
  });
}

// --- Otras IAs: el selector del chat (Claude siempre; las demás, si están instaladas o tienen clave) ---
const aiSelect = document.getElementById("ai");
let aiLabel = "Claude";
function resetPlaceholder() {
  msg.placeholder = aiLabel === "Claude" ? t("Escríbele a Claude… (suelta archivos sobre mí)") : t("Escríbele a {0}… (los adjuntos van a Claude)", aiLabel);
}
function applyAi(r) {
  if (!r?.providers) return;
  aiSelect.replaceChildren(...r.providers.map((p) => Object.assign(document.createElement("option"), { value: p.id, textContent: p.label })));
  aiSelect.value = r.current;
  aiSelect.classList.toggle("hidden", r.providers.length < 2);
  aiLabel = r.providers.find((p) => p.id === r.current)?.label ?? "Claude";
  resetPlaceholder();
}
aiSelect.onchange = () => { api.aiSelect(aiSelect.value); aiLabel = aiSelect.selectedOptions[0]?.textContent ?? "Claude"; resetPlaceholder(); };
api.aiProviders().then(applyAi);
api.onAi((r) => { applyAi(r); if (!setupBox.classList.contains("hidden")) api.setup().then(renderSetup); });
api.onAiError((m) => { setState(state, m.slice(0, 80), { labelFor: 6000 }); if (!setupBox.classList.contains("hidden")) api.setup().then(renderSetup); });

chat.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = msg.value.trim() || (images.some((i) => i.screen) ? t("Mira mi pantalla y dime qué ves.") : images.length ? t("¿Qué ves en esta imagen?") : files.length ? t("Revisa estos archivos.") : "");
  if (!text || asking) return;
  asking = true;
  lastActivity = Date.now();
  const sent = images.map(({ media_type, data }) => ({ media_type, data }));
  const paths = files.map((f) => f.path);
  images = [];
  files = [];
  renderThumbs();
  msg.value = "";
  resetPlaceholder();
  if (interview && !sent.length && !paths.length) {
    if (INTERVIEW_END.test(text)) interviewEnd();
    else if (INTERVIEW_SKIP.test(text) && !interview.awaitingRole) await interviewTurn("");
    else await interviewTurn(text);
  } else if (!sent.length && !paths.length && interviewStart(text)) await interviewBegin(interviewStart(text).role);
  else if (!sent.length && !paths.length && MAIL_ASK.test(text)) answerMail();
  else if (!sent.length && !paths.length && PLAN_ASK.test(text) && /plan/i.test(text)) await answerPlan();
  else if (!sent.length && !paths.length && musicQuery(text)) await answerMusic(musicQuery(text));
  else await askAndShow({ text, images: sent, files: paths });
  asking = false;
});

// --- Barra de progreso: rápida hasta el 60 %, lenta hasta el 92 %, y ahí espera la respuesta ---
const prog = document.getElementById("progress");
let progRaf = 0;
const eOut = (t) => 1 - Math.pow(1 - t, 3);
const eInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function progressStart(expectedMs) {
  cancelAnimationFrame(progRaf);
  prog.classList.remove("done");
  prog.classList.add("on");
  const t0 = performance.now();
  const tick = () => {
    const u = (performance.now() - t0) / expectedMs;
    const p = u < .4 ? .6 * eOut(u / .4) : u < .85 ? .6 + .32 * eInOut((u - .4) / .45) : .92 + .05 * (1 - Math.exp(-(u - .85) * 2));
    prog.style.setProperty("--p", `${(p * 100).toFixed(1)}%`);
    progRaf = requestAnimationFrame(tick);
  };
  tick();
}
function progressEnd() {
  cancelAnimationFrame(progRaf);
  prog.style.setProperty("--p", "100%");
  prog.classList.add("done");
  setTimeout(() => prog.classList.remove("on"), 700);
  setTimeout(() => prog.classList.remove("done"), 1100);
}

// --- Voz: Nimbo dice su respuesta (main.js pide el audio con la voz del tema activo) ---
// Una voz a la vez. Se corta si llega otra respuesta, si empiezas a dictar (voice.js), si cambias
// de tema o si apagas la voz. Si no hay audio (voz apagada, sin internet…), no pasa nada.
let speaking = null; // { audio, url } de lo que suena ahora
let speakTurn = 0;
function stopSpeaking() {
  speakTurn++; // lo que venga en camino de una respuesta anterior ya no suena
  if (!speaking) return;
  speaking.audio.pause();
  quiet();
}
// Deja de sonar lo actual sin cancelar lo que sigue en cola (fin natural de un audio).
function quiet() {
  if (!speaking) return;
  URL.revokeObjectURL(speaking.url);
  speaking = null;
  Jarvis.setLevel(0);
}
/** Reproduce un mp3 y avisa cuando termina (o falla). */
function playSpeech(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    speaking = { audio, url };
    const done = () => { if (speaking?.audio === audio) quiet(); resolve(); };
    audio.onended = done;
    audio.onerror = done;
    audio.onpause = done; // la cortó stopSpeaking()
    audio.onplaying = () => Jarvis.setLevel(0.45); // la esfera crece mientras habla
    audio.play().catch(done);
  });
}
// Un texto largo tarda varios segundos en llegar entero (unos 8 s para 300 letras). Se parte en
// frases y se dicen en orden, pidiendo cada una mientras suena la anterior: así empieza a los 2 o 3 s.
// Cada parte se pide una sola vez; si una no llega, ahí se calla.
function speechParts(text) {
  if (text.length <= 140) return [text];
  const parts = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const last = parts.length - 1;
    // Se juntan frases hasta ~110 letras; a partir de la cuarta parte, todo va junto.
    if (last >= 0 && (parts[last].length < 60 || parts[last].length + sentence.length <= 110 || parts.length === 4)) parts[last] += " " + sentence;
    else parts.push(sentence);
  }
  return parts;
}
async function speak(text) {
  stopSpeaking();
  const turn = speakTurn;
  if (!text || mini) return;
  const parts = speechParts(String(text));
  const request = (i) => (i < parts.length ? api.tts(parts[i]).catch(() => null) : null);
  // De a una petición: la parte siguiente se pide cuando empieza a sonar la actual. Pedirlas
  // todas juntas hizo que el proveedor de voz rechazara llamadas por un rato.
  let coming = request(0);
  for (let i = 0; i < parts.length; i++) {
    const bytes = await coming;
    if (!bytes || turn !== speakTurn) return;
    coming = request(i + 1);
    await playSpeech(bytes);
    if (turn !== speakTurn) return;
  }
}
api.onVoice((on) => { if (!on) stopSpeaking(); });

async function askAndShow(message) {
  stopSpeaking(); // pregunta nueva: se calla lo anterior
  // Mientras Claude responde, la isla sigue viva: contador de segundos y un botón para cancelar (nunca un "Pensando…" mudo e inmóvil).
  const waiting = el("div", "waiting");
  const waitText = el("span", "", t("Pensando…"));
  const cancel = el("button", "", t("Cancelar"));
  cancel.type = "button";
  let cancelled = false;
  cancel.onclick = () => { cancelled = true; cancel.disabled = true; api.askCancel(); };
  waiting.append(waitText, cancel);
  answer.replaceChildren(waiting);
  answer.classList.add("wait");
  answerBox.classList.remove("hidden");
  progressStart(message.files?.length || message.images?.length ? 25_000 : 15_000);
  setState("thinking", t("Pensando…"));
  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    waitText.textContent = s < 12 ? t("Pensando…") : t("Sigue trabajando… {0} s", s);
  }, 1000);
  let r;
  try { r = await api.ask(message); } finally { clearInterval(tick); }
  progressEnd();
  // Estas preguntas ya no pasan por los hooks de Claude Code (iban más lentas): los gestos de la isla los pone la página.
  if (cancelled) settle();
  else if (r?.error || !r?.text) { setState("error", t("Algo falló en {0} 😢", "Nimbo"), { back: 6000, labelFor: 2500 }); SOUNDS.error(); }
  else { setState("finished", t("¡Listo! · {0}", "Nimbo"), { back: 5000 }); SOUNDS.finish(); }
  if (r?.added?.length) setTimeout(() => setState(state, `⏰ Anotado: ${r.added[0].text}`, { labelFor: 3500 }), 300);
  answer.classList.remove("wait");
  answer.replaceChildren(el("div", "reply", r?.text ?? t("No pude hablar con Claude.")));
  speak(r?.text); // solo la respuesta corta; los prompts propuestos para otros chats no se leen
  for (const d of r?.dispatch ?? []) answer.append(proposal(d));
  for (const d of r?.delegate ?? []) answer.append(delegateCard(d));
  answer.scrollTop = 0;
  return r;
}

// --- Orquestador: Nimbo propone un prompt para otro chat; tú lo revisas y lo envías ---
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function proposal(d) {
  const box = el("div", "prop");
  const head = el("div", "what", `→ ${d.project}${d.title ? " · " + d.title : ""}`);
  if (d.active) head.append(el("span", "warn", t("  ⚠ abierto en la app: ahí no verás esto hasta reabrirlo")));
  const prompt = el("textarea");
  prompt.value = d.prompt;
  const send = el("button", "allow", t("Enviar"));
  const drop = el("button", "", t("Descartar"));
  const btns = el("div", "btns");
  btns.append(send, drop);
  box.append(head, prompt, btns);

  drop.onclick = () => box.remove();
  send.onclick = async () => {
    // Mientras el otro chat trabaja se esconde el texto; el progreso va en la etiqueta
    // (los hooks de ese chat también mueven a Nimbo: "Ejecuta · git push", etc.).
    const text = prompt.value;
    box.classList.add("hidden");
    answer.querySelector(".reply")?.classList.add("hidden");
    if (!answer.querySelector(".prop:not(.hidden)")) answerBox.classList.add("hidden");
    setState("working", t("→ {0} trabajando…", d.project));

    progressStart(60_000);
    const res = await api.dispatch(d.session, text);
    progressEnd();
    box.replaceChildren(el("div", "done", `✓ ${res?.project ?? d.project}: ${res?.text ?? t("(sin respuesta)")}`));
    box.classList.remove("hidden");
    answerBox.classList.remove("hidden");
    setState("finished", t("¡Listo! · {0}", d.project), { back: 5000 });
    SOUNDS.finish();
  };
  return box;
}

// --- Encargo a otra IA (Gemini): Claude lo propone; tú eliges abrirlo en la web de Gemini o generarlo aquí con tu clave ---
const DELEGATE_ERR = {
  key: "Gemini no tiene una clave válida. Pégala en Conexiones → Otras IAs (se saca gratis en Google AI Studio).",
  limit: "Gemini dice que llegaste a su límite. Espera un rato.",
  billing: "Google no deja generar imágenes con la clave gratis: hay que activar la facturación en AI Studio. Mientras, usa \"Abrir en Gemini\" con tu cuenta.",
  blocked: "Gemini no quiso generar eso (filtros de seguridad). Cambia el texto del encargo.",
  model: "Gemini no tiene el modelo que se necesita. Revisa su nombre.",
  offline: "No pude conectarme con Gemini.",
  fail: "Gemini no pudo responder.",
};
// El resultado de un encargo ya hecho (imagen o texto) y el botón para dárselo a Claude.
function delegateResult(out, res) {
  const give = el("button", "allow", t("Dárselo a Claude"));
  const more = el("div", "btns");
  if (res.kind === "image") {
    const url = `data:${res.mime};base64,${res.data}`;
    const img = el("img", "dimg");
    img.src = url;
    const show = el("button", "", t("Ver en la carpeta"));
    show.onclick = () => api.delegateShow(res.file);
    give.onclick = () => {
      if (res.data.length * 0.75 > MAX_IMAGE) { out.textContent = t("La imagen pesa más de 5 MB: ábrela desde la carpeta."); return; }
      images.push({ media_type: res.mime, data: res.data, url });
      renderThumbs();
      msg.focus();
    };
    more.append(give, show);
    out.replaceChildren(img, more);
  } else {
    give.onclick = () => { msg.value = `${msg.value ? msg.value + "\n\n" : ""}${res.text}`; msg.focus(); };
    more.append(give);
    out.replaceChildren(el("div", "dtext", res.text), more);
  }
}
function delegateCard(d) {
  const box = el("div", "prop");
  box.append(el("div", "what", d.kind === "image" ? t("→ Gemini · imagen") : t("→ Gemini · texto")));
  const prompt = el("textarea");
  prompt.value = d.prompt;
  const open = el("button", "allow", t("Abrir en Gemini"));
  const run = el("button", "", t("Generar aquí"));
  const drop = el("button", "", t("Descartar"));
  const btns = el("div", "btns");
  btns.append(open, run, drop);
  const out = el("div", "dout");
  box.append(prompt, btns, out);
  const mine = () => ({ ai: "gemini", kind: d.kind, prompt: prompt.value });

  drop.onclick = () => box.remove();
  open.onclick = () => { api.delegateOpen(mine()); out.textContent = t("Copié el encargo: pégalo en Gemini con Ctrl+V."); };
  run.onclick = async () => {
    run.disabled = true;
    out.textContent = t("Gemini está trabajando…");
    const res = await api.delegateRun(mine()).catch(() => ({ error: "fail" }));
    run.disabled = false;
    if (res?.error) { out.textContent = t(DELEGATE_ERR[res.error] ?? DELEGATE_ERR.fail); return; }
    delegateResult(out, res);
  };
  return box;
}

// Posición a lo largo del borde superior (la guarda main.js)
api.onAnchor((f) => root.style.setProperty("--f", f));

// --- Arrastrar a Nimbo por el borde de arriba ---
// Se agarra de la barra de la isla. Menos de 6 px de movimiento sigue siendo un clic.
// Mientras se mueve: se inclina hacia atrás según la velocidad y deja una estela; al
// soltarlo aterriza con un rebote.
let dragDown = null; // { x, id } desde que se presiona
let dragging = false;
let suppressClick = false;
let lean = 0, leanTarget = 0, leanRaf = 0, lastDragX = 0;
const islandEl = document.getElementById("island");
function leanLoop() {
  lean += (leanTarget - lean) * .22;
  leanTarget *= .86; // sin movimiento vuelve a enderezarse
  charEl.style.setProperty("--lean", `${lean.toFixed(2)}deg`);
  islandEl.style.setProperty("--trail", Math.min(Math.abs(lean) / 10, 1).toFixed(2));
  islandEl.style.setProperty("--trail-dir", lean > 0 ? "90deg" : "270deg");
  Jarvis.look(-lean * 40, 0);
  leanRaf = dragging ? requestAnimationFrame(leanLoop) : 0;
}
wrap.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || mini || e.target.closest("#content")) return;
  dragDown = { x: e.screenX, id: e.pointerId };
});
wrap.addEventListener("pointermove", (e) => {
  if (!dragDown) return;
  // Si llega un movimiento sin botón presionado, es que la suelta se perdió: terminar.
  if (e.buttons === 0) return endDrag();
  if (!dragging && Math.abs(e.screenX - dragDown.x) > 6) {
    dragging = true;
    wrap.setPointerCapture(dragDown.id);
    root.classList.add("dragging");
    hidePanel();
    api.dragStart({ w: wrap.offsetWidth, grab: e.clientX - wrap.getBoundingClientRect().left });
    SOUNDS.open();
    islandEl.animate([{ transform: "scale(1)" }, { transform: "scale(1.05, .94)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
    lastDragX = e.screenX;
    leanLoop();
  }
  if (dragging) {
    // Se inclina en contra del movimiento, como si lo llevaras colgando.
    leanTarget = Math.max(-16, Math.min(16, (e.screenX - lastDragX) * 1.3));
    lastDragX = e.screenX;
  }
});
function endDrag() {
  if (dragging) {
    dragging = false;
    suppressClick = true; // el clic que llega tras soltar no debe abrir el chat
    setTimeout(() => (suppressClick = false), 250);
    api.dragEnd();
    root.classList.remove("dragging");
    charEl.style.removeProperty("--lean");
    lastSize = { w: 0, h: 0 };
    relayout();
    // Aterrizaje: se aplasta contra el borde y rebota.
    islandEl.animate([{ transform: "scale(1.07, .88)" }, { transform: "scale(.97, 1.06)" }, { transform: "scale(1.01, .99)" }, { transform: "scale(1)" }],
      { duration: 420, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
    SOUNDS.close();
    emote("hello", 900);
  }
  dragDown = null;
}
// La suelta se escucha por varios caminos: mientras la ventana se mueve bajo el cursor, el
// evento puede llegar a otro elemento o perderse, y Nimbo no debe quedar pegado al mouse.
for (const type of ["pointerup", "pointercancel", "mouseup"]) document.addEventListener(type, endDrag, true);
wrap.addEventListener("lostpointercapture", endDrag);
window.addEventListener("blur", endDrag);
api.onDragAbort(endDrag);

api.onTheme((t) => {
  stopSpeaking(); // cada tema tiene su voz: lo que sonaba era la del otro
  const jarvis = t === "jarvis";
  root.classList.toggle("theme-jarvis", jarvis);
  root.classList.toggle("theme-cloud", !jarvis);
  Jarvis.setActive(jarvis);
});

// Entrada: baja desde arriba con un rebote y saluda.
let NAME = ""; // tu nombre para el saludo (prefs.json → "name")
api.onName((n) => { NAME = n; });
setTimeout(() => root.classList.remove("enter"), 60);
setState("idle");
setTimeout(() => {
  const h = new Date().getHours();
  const hi = h < 12 ? t("Buenos días") : h < 19 ? t("Buenas tardes") : t("Buenas noches");
  emote("hello", 1600);
  SOUNDS.greet();
  setState("idle", NAME ? `${hi}, ${NAME} 👋` : `${hi} 👋`, { labelFor: 3500 });
}, 900);

// Guion del video. Corre dentro de la página real de Nimbo y usa sus propias funciones
// (handle, onWhatsapp, etc.) con datos inventados. Devuelve una promesa que termina al final.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cb = window.__cb;
  const mk = (tag, id) => { const e = document.createElement(tag); e.id = id; document.body.append(e); return e; };

  // --- Escenario: marca, textos y cursor ---
  mk("div", "promo-brand").textContent = "NIMBO";
  const cap = mk("div", "promo-cap");
  const cur = mk("div", "promo-cur");
  let step = 0;
  async function caption(title, sub, big = false) {
    cap.classList.remove("in");
    await sleep(320);
    cap.classList.toggle("big", big);
    const n = document.createElement("div"); n.className = "n"; n.textContent = big ? "" : String(++step).padStart(2, "0");
    const h = document.createElement("h1"); h.textContent = title;
    const p = document.createElement("p"); p.textContent = sub;
    cap.replaceChildren(n, h, p);
    cap.classList.add("in");
  }
  async function pointAt(target, fx = .5, fy = .5) {
    const r = target.getBoundingClientRect();
    cur.classList.add("on");
    cur.style.transform = `translate(${r.left + r.width * fx}px, ${r.top + r.height * fy}px)`;
    await sleep(680);
  }
  async function tap(target, fx, fy) {
    await pointAt(target, fx, fy);
    cur.classList.add("tap");
    await sleep(120);
    target.click();
    cur.classList.remove("tap");
    await sleep(120);
  }
  const hideCursor = () => cur.classList.remove("on");
  const pill = (name) => [...appsBox.querySelectorAll(".pill")].find((p) => p.textContent.includes(name));
  const closePanel = async () => { cb.hover(false); hidePanel(); hideCursor(); await sleep(500); };

  const S1 = { session_id: "s1", title: "tienda-web", cwd: "D:/proyectos/tienda-web" };
  const S2 = { session_id: "s2", title: "api-pagos", cwd: "D:/proyectos/api-pagos" };
  const hook = (s, name, extra = {}) => handle({ hook_event_name: name, ...s, ...extra });

  cb.theme("cloud");

  // ── 0 · Presentación ──
  caption("Nimbo", "Tu compañero flotante para Claude Code, en Windows.", true);
  await sleep(4300);

  // ── 1 · Chats en vivo ──
  caption("Mira trabajar a tus chats", "Cada sesión de Claude Code, en vivo y todas a la vez.");
  hook(S1, "UserPromptSubmit", { prompt: "Agrega modo oscuro al checkout" });
  await sleep(1700);
  hook(S1, "PreToolUse", { tool_name: "Read", tool_input: { file_path: "src/checkout/theme.css" } });
  await sleep(900);
  hook(S1, "PostToolUse", { tool_name: "Read" });
  hook(S2, "UserPromptSubmit", { prompt: "Corre las pruebas de pagos" });
  await sleep(1000);
  hook(S1, "PreToolUse", { tool_name: "Edit", tool_input: { file_path: "src/checkout/theme.css",
    old_string: "  --bg: #ffffff;\n  --text: #111418;",
    new_string: "  --bg: light-dark(#ffffff, #0f1115);\n  --text: light-dark(#111418, #eceef2);\n  color-scheme: light dark;" } });
  await sleep(1200);
  await pointAt(wrap, .5, .6);
  cb.hover(true);
  await sleep(900);
  await tap(pill("Chats"));
  await sleep(1700);
  hook(S1, "PostToolUse", { tool_name: "Edit" });
  hook(S2, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test -- pagos" } });
  await sleep(1500);
  hook(S2, "PostToolUse", { tool_name: "Bash", tool_response: { stdout: "PASS  pagos/cobro.test.js\nPASS  pagos/reembolso.test.js\n\n✓ 42 pruebas pasaron (3.1 s)" } });
  await sleep(2300);
  await closePanel();

  // ── 2 · Permisos ──
  caption("Aprueba sin salir de lo tuyo", "Los permisos llegan a la isla, con el comando completo a la vista.");
  cb.permission({ ...S1, rid: "r1", tool_name: "Bash",
    tool_input: { command: "git push origin feature/modo-oscuro", description: "Sube la rama al remoto" },
    permission_suggestions: [{ rules: [{ toolName: "Bash", ruleContent: "git push:*" }] }] });
  await sleep(2900);
  await tap(document.querySelector("#card .allow"));
  hideCursor();
  await sleep(1400);
  hook(S1, "Stop");
  hook(S2, "Stop");
  await sleep(2700);

  // ── 3 · Chat y orquestador ──
  caption("Dile qué necesitas", "Escribe, dicta o suéltale archivos. Nimbo reparte el trabajo entre tus chats.");
  await tap(wrap, .14, .55);
  await sleep(800);
  hideCursor();
  for (const ch of "Dile a api-pagos que agregue reintentos") {
    msg.value += ch;
    msg.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(42);
  }
  await sleep(450);
  window.__askReply = { text: "Eso le toca a api-pagos. Le preparé este pedido:", added: [], dispatch: [{ session: "s2", project: "api-pagos", title: "", active: false,
    prompt: "Agrega reintentos con espera exponencial (máximo 3) al cliente de pagos y cúbrelo con una prueba." }] };
  chat.requestSubmit();
  await sleep(4300);
  const send = answer.querySelector(".prop .allow");
  if (send) await tap(send);
  hideCursor();
  await sleep(5200);
  // Cierra el chat y la respuesta para dejar la isla limpia.
  wrap.click();
  await sleep(700);
  answerBox.classList.add("hidden");
  chat.classList.add("hidden");
  setState("idle");
  await sleep(600);

  // ── 4 · Apps ──
  caption("Todo lo pendiente, de un vistazo", "Trello, GitHub, WhatsApp y tus recordatorios, cada uno en su píldora.");
  cb.github([{ title: "Revisión pedida: modo oscuro en el checkout", repo: "acme/tienda-web" }, { title: "CI falló en main", repo: "acme/api-pagos" }]);
  cb.reminders([{ id: "1", text: "Enviar la factura de octubre", due: new Date(Date.now() + 2 * 3600e3).toISOString() }, { id: "2", text: "Llamar al contador" }]);
  onWhatsapp({ running: true, read: true, access: true, count: 2, headline: "", chats: [
    { name: "Mamá", kind: "personal", urgent: false, ignore: false, summary: "¿Vienes a almorzar el domingo?", n: 1 },
    { name: "Equipo diseño", kind: "trabajo", urgent: false, ignore: false, summary: "Revisar el banner antes del viernes", n: 3 }] }, null);
  await sleep(1500);
  await pointAt(wrap, .5, .6);
  cb.hover(true);
  await sleep(1000);
  await tap(pill("Trello"));
  await sleep(2700);
  await tap(pill("Pendientes"));
  await sleep(2300);
  await closePanel();

  // ── 5 · WhatsApp urgente ──
  caption("Lo urgente suena distinto", "Resume tu WhatsApp: quién escribió, qué es trabajo y qué puede esperar.");
  await sleep(700);
  onWhatsapp({ running: true, read: true, access: true, count: 4, headline: "1 urgente de Laura; 2 pueden esperar; el resto son grupos.", chats: [
    { name: "Mamá", kind: "personal", urgent: false, ignore: false, summary: "¿Vienes a almorzar el domingo?", n: 1 },
    { name: "Equipo diseño", kind: "trabajo", urgent: false, ignore: false, summary: "Revisar el banner antes del viernes", n: 3 },
    { name: "Laura", kind: "trabajo", urgent: true, ignore: false, summary: "El checkout está caído, el cliente espera", n: 2 },
    { name: "Fútbol los jueves", kind: "grupo", urgent: false, ignore: true, summary: "", n: 14 }] },
    { name: "Laura", summary: "El checkout está caído, el cliente espera" });
  await sleep(3200);
  await pointAt(wrap, .5, .6);
  cb.hover(true);
  await sleep(900);
  await tap(pill("WhatsApp"));
  await sleep(3800);
  await closePanel();
  root.classList.remove("wa-urgent");
  setState("idle");
  await sleep(500);

  // ── 6 · Dos apariencias ──
  caption("Dos personalidades", "Una nube con cara, o una esfera de puntos al estilo JARVIS.");
  await sleep(600);
  cb.theme("jarvis");
  setState("idle");
  await sleep(2600);
  hook(S1, "UserPromptSubmit", { prompt: "Optimiza las imágenes" });
  await sleep(1700);
  hook(S1, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run optimize" } });
  await sleep(2000);
  hook(S1, "Stop");
  await sleep(2600);

  // ── 7 · Se mueve ──
  caption("Va donde tú lo pongas", "Arrástralo por el borde de arriba, o encógelo a una esquina cuando juegas.");
  setState("idle");
  await sleep(900);
  root.classList.add("dragging");
  const t0 = performance.now();
  let last = .5;
  await new Promise((done) => {
    (function frame() {
      const u = Math.min((performance.now() - t0) / 3200, 1);
      const f = .5 + .45 * Math.sin(u * Math.PI * 2) * (1 - u * .15);
      const lean = Math.max(-14, Math.min(14, (f - last) * 900));
      last = f;
      root.style.setProperty("--f", f.toFixed(4));
      charEl.style.setProperty("--lean", `${lean.toFixed(2)}deg`);
      islandEl.style.setProperty("--trail", Math.min(Math.abs(lean) / 10, 1).toFixed(2));
      islandEl.style.setProperty("--trail-dir", lean > 0 ? "90deg" : "270deg");
      u < 1 ? requestAnimationFrame(frame) : done();
    })();
  });
  root.classList.remove("dragging");
  root.style.setProperty("--f", ".5");
  charEl.style.removeProperty("--lean");
  islandEl.animate([{ transform: "scale(1.07, .88)" }, { transform: "scale(.97, 1.06)" }, { transform: "scale(1.01, .99)" }, { transform: "scale(1)" }],
    { duration: 420, easing: "cubic-bezier(.3, 1.4, .5, 1)" });
  await sleep(1200);

  // ── 8 · Cierre ──
  cb.theme("cloud");
  setState("idle");
  caption("Nimbo", "Código abierto · Windows · usa tu propio Claude, sin API keys.", true);
  await sleep(900);
  emote("love", 1800);
  await sleep(3600);
  cap.classList.remove("in");
  await sleep(600);
})();

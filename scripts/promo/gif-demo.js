// Guion del GIF del README: lo esencial de Nimbo en ~30 s, sin textos alrededor.
// Corre dentro de la página real y usa sus propias funciones con datos inventados (ver promo-preload.js).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cb = window.__cb;
  const S1 = { session_id: "s1", title: "web-shop", cwd: "D:/projects/web-shop" };
  const hook = (name, extra = {}) => handle({ hook_event_name: name, ...S1, ...extra });
  const pill = (name) => [...appsBox.querySelectorAll(".pill")].find((p) => p.textContent.includes(name));
  const peek = async (name, ms) => { cb.hover(true); await sleep(650); pill(name)?.click(); await sleep(ms); };
  const unpeek = async () => { cb.hover(false); hidePanel(); await sleep(450); };

  cb.theme("cloud");
  await sleep(2400); // entra y saluda

  // Un chat trabajando, con su diff en vivo
  hook("UserPromptSubmit", { prompt: "Add dark mode to the checkout" });
  await sleep(1100);
  hook("PreToolUse", { tool_name: "Edit", tool_input: { file_path: "src/checkout/theme.css",
    old_string: "  --bg: #ffffff;", new_string: "  --bg: light-dark(#fff, #0f1115);\n  color-scheme: light dark;" } });
  await sleep(900);
  await peek("Chats", 2300);
  await unpeek();

  // Permiso → Permitir → listo
  cb.permission({ ...S1, rid: "r1", tool_name: "Bash", tool_input: { command: "git push origin feature/dark-mode" } });
  await sleep(2000);
  document.querySelector("#card .allow").click();
  await sleep(900);
  hook("Stop");
  await sleep(1500);

  // Trello: tus tableros, y al tocar uno, sus pendientes
  await peek("Trello", 1600);
  document.querySelector("#appview .arow")?.click();
  await sleep(2600);
  await unpeek();

  // Spotify: lo que suena, con sus botones
  const cover = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 120;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 120, 120);
    grad.addColorStop(0, "#ff6a88");
    grad.addColorStop(1, "#3a3df0");
    g.fillStyle = grad;
    g.fillRect(0, 0, 120, 120);
    g.fillStyle = "rgba(255,255,255,.85)";
    g.beginPath();
    g.arc(60, 64, 26, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/png");
  })();
  cb.media({ title: "Midnight Drive", artist: "Neon Harbor", album: "City Lights", playing: true, art: cover });
  await sleep(500);
  await peek("Spotify", 1300);
  document.querySelector("#appview .ctl .play")?.click(); // pausa
  await sleep(1100);
  document.querySelector("#appview .ctl .play")?.click(); // y sigue
  await sleep(700);
  await unpeek();

  // Correo: aparece el botón ✉ y, al tocarlo, lo que importa
  cb.mail({ on: true, at: new Date().toISOString(), emails: [
    { id: "18c3a9f0b2d4e5f6", from: "Maria Perez", subject: "Workshop delivery", summary: "Needs the workshop finished before Friday", important: true },
    { id: "18c3a9f0b2d4e5f7", from: "Example Bank", subject: "Account security", summary: "New sign-in from another device", important: true },
    { id: "18c3a9f0b2d4e5f8", from: "Web Shop", subject: "Your order shipped", summary: "Shipping notice for order 4821", important: false }] });
  await sleep(1300);
  document.getElementById("mailBtn").click();
  await sleep(2700);
  document.getElementById("mailBtn").click();
  await sleep(500);
  cb.mail({ on: false, at: "", emails: [] });
  await sleep(300);

  // WhatsApp urgente
  onWhatsapp({ running: true, read: true, access: true, count: 1, headline: "", chats: [
    { name: "Laura", kind: "trabajo", urgent: true, ignore: false, summary: "The checkout is down", n: 2 }] },
    { name: "Laura", summary: "The checkout is down" });
  await sleep(2400);
  root.classList.remove("wa-urgent");
  setState("idle");
  await sleep(400);

  // JARVIS trabajando
  cb.theme("jarvis");
  await sleep(1000);
  hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run build" } });
  await sleep(1600);
  setState("idle");
  await sleep(400);

  // Se mueve por el borde
  root.classList.add("dragging");
  const t0 = performance.now();
  let last = .5;
  await new Promise((done) => {
    (function frame() {
      const u = Math.min((performance.now() - t0) / 2200, 1);
      const f = .5 + .48 * Math.sin(u * Math.PI * 2);
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
  cb.theme("cloud");
  emote("love", 1500);
  await sleep(1400);
})();

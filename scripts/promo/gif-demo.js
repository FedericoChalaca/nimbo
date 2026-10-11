// Guion del GIF del README: lo esencial de Nimbo en ~18 s, sin textos alrededor.
// Corre dentro de la página real y usa sus propias funciones con datos inventados.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cb = window.__cb;
  const S1 = { session_id: "s1", title: "web-shop", cwd: "D:/projects/web-shop" };
  const hook = (name, extra = {}) => handle({ hook_event_name: name, ...S1, ...extra });
  const pill = (name) => [...appsBox.querySelectorAll(".pill")].find((p) => p.textContent.includes(name));

  cb.theme("cloud");
  await sleep(2600); // entra y saluda

  // Un chat trabajando, con su diff en vivo
  hook("UserPromptSubmit", { prompt: "Add dark mode to the checkout" });
  await sleep(1300);
  hook("PreToolUse", { tool_name: "Edit", tool_input: { file_path: "src/checkout/theme.css",
    old_string: "  --bg: #ffffff;", new_string: "  --bg: light-dark(#fff, #0f1115);\n  color-scheme: light dark;" } });
  await sleep(1000);
  cb.hover(true);
  await sleep(700);
  pill("Chats")?.click();
  await sleep(2600);
  cb.hover(false);
  hidePanel();
  await sleep(500);

  // Permiso → Permitir → listo
  cb.permission({ ...S1, rid: "r1", tool_name: "Bash", tool_input: { command: "git push origin feature/dark-mode" } });
  await sleep(2300);
  document.querySelector("#card .allow").click();
  await sleep(1100);
  hook("Stop");
  await sleep(2000);

  // WhatsApp urgente
  onWhatsapp({ running: true, read: true, access: true, count: 1, headline: "", chats: [
    { name: "Laura", kind: "trabajo", urgent: true, ignore: false, summary: "The checkout is down", n: 2 }] },
    { name: "Laura", summary: "The checkout is down" });
  await sleep(2600);
  root.classList.remove("wa-urgent");
  setState("idle");
  await sleep(400);

  // JARVIS trabajando
  cb.theme("jarvis");
  await sleep(1200);
  hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm run build" } });
  await sleep(2000);
  setState("idle");
  await sleep(500);

  // Se mueve por el borde
  root.classList.add("dragging");
  const t0 = performance.now();
  let last = .5;
  await new Promise((done) => {
    (function frame() {
      const u = Math.min((performance.now() - t0) / 2400, 1);
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
  await sleep(1500);
})();

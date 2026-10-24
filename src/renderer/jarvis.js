// Tema JARVIS: esfera holográfica de puntos conectados (plexus) con anillos.
// Cada estado de Claude cambia color, velocidad y pulso; los cambios se
// interpolan para que nunca salte de golpe. Al activarse hace una secuencia de
// encendido y, en reposo, un barrido de radar de vez en cuando.
(() => {
  const canvas = document.getElementById("orb");
  const ctx = canvas.getContext("2d");
  const W = 240, H = 140, CX = 120, CY = 66, BASE_R = 42;
  // El dibujo usa coordenadas de 240×140, pero en pantalla el lienzo mide 120×70 (190×111 al soltar archivos): los
  // píxeles reales se ajustan a lo que se ve (antes eran 480×280 fijos, ~7 veces más de lo necesario).
  let scale = 1;
  const fit = () => {
    const w = Math.max(1, Math.round((canvas.clientWidth || W / 2) * (devicePixelRatio || 1)));
    if (canvas.width !== w) { canvas.width = w; canvas.height = Math.round((w * H) / W); }
    scale = canvas.width / W;
  };
  fit();
  new ResizeObserver(fit).observe(canvas);

  // Puntos repartidos parejo sobre una esfera (espiral de Fibonacci).
  const N = 140;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = i * Math.PI * (3 - Math.sqrt(5));
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  const LINK = 0.4;
  // La esfera gira entera (rígida): la distancia entre dos puntos nunca cambia, así que los pares
  // que se unen con una línea se calculan una sola vez (antes eran ~9.700 comparaciones por cuadro).
  const PAIRS = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
    if (d <= LINK) PAIRS.push(i, j, 1 - d / LINK);
  }
  // Las líneas y los puntos se agrupan por brillo: un trazo por grupo en vez de uno por línea.
  const BANDS = 8;
  const bands = Array.from({ length: BANDS }, () => []);

  // Chispas: trazos cortos que orbitan alrededor, como datos girando.
  const sparks = Array.from({ length: 46 }, () => ({
    r: 1.05 + Math.random() * .5,
    a: Math.random() * Math.PI * 2,
    len: .05 + Math.random() * .25,
    v: (Math.random() < .5 ? -1 : 1) * (.4 + Math.random() * 1.2),
    alpha: .3 + Math.random() * .6,
  }));

  //            color RGB          giro  pulso brillo temblor
  const STATES = {
    idle:     { c: [255, 165, 50],  spin: .25, pulse: .6, glow: .85, shake: 0 },
    thinking: { c: [255, 195, 90],  spin: .7,  pulse: 2.2, glow: 1,  shake: 0 },
    working:  { c: [255, 145, 30],  spin: 1.5, pulse: 1.4, glow: 1.1, shake: 0 },
    needs:    { c: [255, 80, 35],   spin: .5,  pulse: 4,  glow: 1.2, shake: 0 },
    finished: { c: [255, 220, 130], spin: .9,  pulse: 1,  glow: 1.3, shake: 0 },
    error:    { c: [255, 45, 45],   spin: .15, pulse: 6,  glow: .9, shake: 1.2 },
    sleeping: { c: [200, 110, 40],  spin: .06, pulse: .3, glow: .35, shake: 0 },
    listening:{ c: [255, 205, 120], spin: .35, pulse: .8, glow: 1,  shake: 0 },
  };
  // Gestos: cambian el estado un rato (mismos nombres que en la nube).
  const EMOTES = {
    hello: { glow: 1.3 },
    love:  { c: [255, 110, 170], pulse: 3, glow: 1.3 },
    dizzy: { spin: 6, shake: 1.6 },
    yawn:  { glow: .4, spin: .1 },
    gulp:  { glow: 1.4, pulse: 3 },
  };
  let level = 0; // volumen del micrófono (0–1): la esfera crece cuando hablas
  let levelTarget = 0;
  const cur = { ...STATES.idle, c: [...STATES.idle.c] };
  let target = STATES.idle;
  let emoteTarget = null;
  let emoteUntil = 0;
  let angle = 0, phase = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0;
  let shock = -1; // onda expansiva (-1 = apagada)
  let boot = 1; // 0→1 durante la secuencia de encendido
  let booted = false;
  let scan = -1; // barrido de radar en reposo (-1 = apagado)
  let nextScan = performance.now() + 6000;
  let last = performance.now();
  let active = false;
  let lastDraw = 0;
  // Cuadros por segundo según lo que pasa: en reposo no hace falta dibujar a 60.
  const FPS = { idle: 15, sleeping: 6, working: 24, thinking: 24, needs: 24, listening: 30, error: 24, finished: 30 };
  let stateName = "idle";
  let hidden = false; // el personaje no se ve (modo mini sin espacio, ventana tapada): no se dibuja

  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rgba = (a) => `rgba(${cur.c[0] | 0},${cur.c[1] | 0},${cur.c[2] | 0},${a})`;

  function frame(now) {
    if (!active) return;
    requestAnimationFrame(frame);
    const busy = now < emoteUntil || shock >= 0 || scan >= 0 || boot < 1 || level > .02 || levelTarget > 0;
    const fps = busy ? 40 : FPS[stateName] ?? 24;
    if (hidden || now - lastDraw < 1000 / fps - 2) return;
    lastDraw = now;
    const dt = Math.min((now - last) / 1000, .1);
    last = now;
    const k = 1 - Math.pow(.02, dt); // suavizado independiente de los FPS
    const tgt = now < emoteUntil ? emoteTarget : target;
    for (const key of ["spin", "pulse", "glow", "shake"]) cur[key] = lerp(cur[key], tgt[key], k);
    for (let i = 0; i < 3; i++) cur.c[i] = lerp(cur.c[i], tgt.c[i], k);
    angle += cur.spin * dt;
    phase += cur.pulse * dt;
    tiltX = lerp(tiltX, aimX, k);
    tiltY = lerp(tiltY, aimY, k);
    level = lerp(level, levelTarget, Math.min(1, dt * 18));

    // Encendido: la esfera crece, los puntos aparecen y los anillos se dibujan.
    if (boot < 1) {
      boot = Math.min(1, boot + dt / 1.8);
      if (boot === 1) shock = 0;
    }
    const b = easeOut(boot);

    const glowSave = cur.glow;
    cur.glow = (cur.glow + level * .6) * (.3 + .7 * b);
    const R = BASE_R * (1 + level * .14) * (.25 + .75 * b);

    const beat = (Math.sin(phase * Math.PI) + 1) / 2;
    const jx = (Math.random() - .5) * cur.shake * 3;
    const jy = (Math.random() - .5) * cur.shake * 3;
    const cx = CX + jx, cy = CY + jy;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    // Núcleo
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (.75 + beat * .15));
    core.addColorStop(0, rgba(.55 * cur.glow));
    core.addColorStop(.35, rgba(.18 * cur.glow));
    core.addColorStop(1, rgba(0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Esfera: rota en Y, se inclina hacia el cursor
    const ca = Math.cos(angle + tiltY), sa = Math.sin(angle + tiltY);
    const cb = Math.cos(.35 + tiltX), sb = Math.sin(.35 + tiltX);
    const shown = Math.ceil(N * b); // durante el encendido los puntos van apareciendo
    const proj = pts.slice(0, shown).map(([x, y, z]) => {
      const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
      const y2 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      const p = 1.6 / (2.4 - z2);
      return [cx + x1 * R * p, cy + y2 * R * p, (z2 + 1) / 2, x1, y2, z2];
    });
    ctx.lineWidth = .6;
    for (const band of bands) band.length = 0;
    for (let k = 0; k < PAIRS.length; k += 3) {
      const i = PAIRS[k], j = PAIRS[k + 1];
      if (i >= shown || j >= shown) continue;
      // brillo 0…~1,1 (cercanía × profundidad de los dos puntos) → su grupo
      const w = PAIRS[k + 2] * (proj[i][2] + proj[j][2]) * .55;
      bands[Math.min(BANDS - 1, (w * BANDS) | 0)].push(i, j);
    }
    for (let b8 = 0; b8 < BANDS; b8++) {
      const list = bands[b8];
      if (!list.length) continue;
      ctx.strokeStyle = rgba(((b8 + .5) / BANDS) * cur.glow);
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        const a = proj[list[k]], c = proj[list[k + 1]];
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(c[0], c[1]);
      }
      ctx.stroke();
    }
    // Puntos con su halo: dos pasadas (halo ancho y tenue + punto) por grupo de profundidad, sin shadowBlur
    // (el desenfoque de sombra en 140 puntos era lo más caro de todo el cuadro).
    for (const band of bands) band.length = 0;
    for (let i = 0; i < proj.length; i++) bands[Math.min(BANDS - 1, (proj[i][2] * BANDS) | 0)].push(i);
    for (let b8 = 0; b8 < BANDS; b8++) {
      const list = bands[b8];
      if (!list.length) continue;
      const depth = (b8 + .5) / BANDS;
      for (const [grow, alpha] of [[2.6, .16], [1, 1]]) {
        ctx.fillStyle = rgba((.25 + depth * .75) * cur.glow * alpha);
        ctx.beginPath();
        const r = (.6 + depth * 1.1) * grow;
        for (const i of list) { const [x, y] = proj[i]; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
        ctx.fill();
      }
    }

    // Chispas en órbita: van más rápido mientras Claude trabaja (agrupadas por brillo, como las líneas)
    ctx.lineWidth = 1.1;
    for (const band of bands) band.length = 0;
    for (const s of sparks) {
      s.a += s.v * dt * (.4 + cur.spin);
      bands[Math.min(BANDS - 1, (s.alpha * BANDS) | 0)].push(s);
    }
    for (let b8 = 0; b8 < BANDS; b8++) {
      if (!bands[b8].length) continue;
      ctx.strokeStyle = rgba(((b8 + .5) / BANDS) * cur.glow * (.6 + beat * .4) * b);
      ctx.beginPath();
      for (const s of bands[b8]) { ctx.moveTo(cx + Math.cos(s.a) * R * s.r, cy + Math.sin(s.a) * R * s.r); ctx.arc(cx, cy, R * s.r, s.a, s.a + s.len); }
      ctx.stroke();
    }

    // Anillos: marcas finas, arcos y un aro tenue, girando a distinto ritmo
    // (durante el encendido se dibujan de 0 a su largo completo).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([1.5, 3.5]);
    ctx.strokeStyle = rgba(.55 * cur.glow);
    ctx.rotate(angle * .8);
    ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, Math.PI * 2 * b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(.5 * cur.glow);
    ctx.rotate(-angle * 2.1);
    for (const start of [0, Math.PI]) {
      ctx.beginPath(); ctx.arc(0, 0, R * 1.32, start, start + 1.7 * b); ctx.stroke();
    }
    ctx.lineWidth = .7;
    ctx.strokeStyle = rgba(.22 * cur.glow + beat * .12);
    ctx.rotate(angle * 1.4);
    ctx.beginPath(); ctx.arc(0, 0, R * 1.45, 0, Math.PI * 1.6 * b); ctx.stroke();
    ctx.restore();

    // Barrido de radar: en reposo, cada 8–14 s una pasada de 1,4 s.
    if (scan < 0 && target === STATES.idle && boot === 1 && now > nextScan) scan = 0;
    if (scan >= 0) {
      scan += dt / 1.4;
      const a = -Math.PI / 2 + scan * Math.PI * 2;
      const fade = Math.sin(Math.min(scan, 1) * Math.PI);
      const beam = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.45);
      beam.addColorStop(0, rgba(0));
      beam.addColorStop(1, rgba(.22 * fade));
      ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.45, a - .55, a); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(.6 * fade);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 1.45, cy + Math.sin(a) * R * 1.45); ctx.stroke();
      if (scan >= 1) {
        scan = -1;
        nextScan = now + 8000 + Math.random() * 6000;
      }
    }

    // Onda expansiva
    if (shock >= 0) {
      shock += dt * 1.4;
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(Math.max(0, 1 - shock) * .8);
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + shock * 1.2), 0, Math.PI * 2); ctx.stroke();
      if (shock > 1) shock = -1;
    }
    cur.glow = glowSave;
  }

  window.Jarvis = {
    setActive(on) {
      if (on === active) return;
      active = on;
      last = performance.now();
      if (on && !booted) {
        booted = true;
        boot = 0; // la primera vez que aparece, se enciende
      }
      if (on) requestAnimationFrame(frame);
    },
    setState(name) {
      stateName = name;
      target = STATES[name] ?? STATES.idle;
      if (name === "finished") shock = 0;
    },
    emote(name, ms = 1400) {
      if (!EMOTES[name]) return;
      emoteTarget = { ...target, ...EMOTES[name] };
      emoteUntil = performance.now() + ms;
      if (name === "hello" || name === "gulp") shock = 0;
    },
    poke() { shock = 0; },
    setLevel(v) { levelTarget = v; },
    setHidden(h) { hidden = !!h; },
    // El cursor inclina la esfera, como los ojos de la nube.
    look(dx, dy) {
      aimY = Math.max(-1, Math.min(1, dx / 400)) * .6;
      aimX = Math.max(-1, Math.min(1, dy / 400)) * .4;
    },
  };
})();

// La aldea de Nimbo: cada carpeta con chats de Claude Code es una casita y cada chat, un aldeano. Caminas con tu personaje
// (con Nimbo flotando detrás), hablas con los aldeanos y entras a las casas para ver el proyecto, su git y sus fotos.
// Todo el arte se dibuja con código (rectángulos de píxeles): nada copiado de ningún juego.
// El mundo se pinta en un lienzo chico y se agranda con píxeles duros; los textos van en HTML encima para que se lean.
// Sin Electron (vista previa en un navegador) usa una aldea de ejemplo.
(() => {
  const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";
  const t = translator(LANG);
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (LANG === "en") {
    document.documentElement.lang = "en";
    for (const e of document.querySelectorAll("#hud *, #help, #house h2, #houseClose, #zoom button")) {
      if (!e.children.length && e.textContent.trim()) e.textContent = t(e.textContent.trim());
      if (e.title) e.title = t(e.title);
    }
    document.title = t("Aldea de Nimbo");
  }

  const DEMO = {
    name: "Federico",
    houses: [
      { id: "h1", name: "portafolio", folder: "D:\\hobby\\portafolio", git: { branch: "main", subject: "Menú móvil", when: "hace 2 horas", github: "https://github.com/x/y", changes: 0 }, chats: [{ id: "a", title: "Portafolio", lastPrompt: "arregla el menú en móvil", at: Date.now() }] },
      { id: "h2", name: "viajero fiel", folder: "D:\\hobby\\viajero fiel", git: null, chats: [{ id: "b", title: "Viajero Fiel", lastPrompt: "revisa el PIN", at: Date.now() - 6e5 }, { id: "c", title: "Supabase", lastPrompt: "RLS", at: Date.now() - 9e6 }] },
      { id: "h3", name: "nimbo", folder: "D:\\nimbo", git: null, chats: [{ id: "d", title: "Nimbo", lastPrompt: "la aldea", at: Date.now() - 1e5 }] },
      { id: "h4", name: "calidad", folder: "D:\\calidad", git: null, chats: [{ id: "e", title: "Calidad de software", lastPrompt: "casos de prueba", at: Date.now() - 3e6 }] },
    ],
  };
  const api = window.aldea ?? { data: async () => DEMO, photos: async () => [], photo: async () => null, open() {}, onHook() {} };

  // --- Utilidades ---
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  function rng(seed) {
    return () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => clamp(Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t("ahora") : m < 60 ? t("hace {0} min", m) : m < 1440 ? t("hace {0} h", Math.round(m / 60)) : t("hace {0} días", Math.round(m / 1440)); };

  // --- Mapa: 64×44 baldosas de 16 px ---
  const TILE = 16, MW = 64, MH = 44;
  const GRASS = 0, PATH = 1, PLAZA = 2, WATER = 3;
  const ground = new Uint8Array(MW * MH);
  const solid = new Uint8Array(MW * MH); // árboles, casas, agua, adornos
  const idx = (x, y) => y * MW + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const SQ = { x: 27, y: 18, w: 11, h: 8 }; // la plaza
  const HALL = { x: 28, y: 10, w: 8, h: 6 }; // la casa de Nimbo
  const SLOTS = [[15, 10], [44, 10], [10, 19], [49, 19], [15, 28], [44, 28], [22, 34], [37, 34], [5, 29], [54, 29], [20, 2], [39, 2], [30, 37], [2, 10], [56, 10]];
  const HW = 5, HH = 4; // casa: 5×4 baldosas; la puerta en el centro de la fila de abajo
  const ROOFS = ["#c0392b", "#2e86de", "#8e44ad", "#16a085", "#d35400", "#7b5e3b", "#b7950b", "#c2185b", "#2c7a7b", "#5b4fc4", "#a0522d", "#3d8b40"];
  const POND = { x: 56, y: 37, rx: 4.6, ry: 3.2 };

  let houses = []; // las casas de los lotes: { ...datos, x, y, roof, wall, front, work, windows }
  let hallHouse = null; // la casa grande de la plaza (la de Nimbo), si aldea.json le dio habitantes ("ayuntamiento")
  let plazaHome = null; // los chats sin casa viven en la plaza
  const slotOf = new Map(); // id de casa → lote: cada casa conserva su lugar entre recargas
  const homes = () => [hallHouse, ...houses, plazaHome].filter(Boolean);
  let staticLayer = null;
  let deco = []; // adornos con brillo de noche (faroles)

  function carve(x0, y0, x1, y1, kind = PATH) {
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    for (;;) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (inMap(x + ox, y + oy) && ground[idx(x + ox, y + oy)] !== PLAZA) ground[idx(x + ox, y + oy)] = kind;
      if (x === x1 && y === y1) break;
      if (x !== x1) x += dx; else y += dy;
    }
  }

  function buildMap(list, plazaChats = []) {
    ground.fill(GRASS);
    solid.fill(0);
    deco = [];
    const r = rng(20261024);
    for (let y = SQ.y; y < SQ.y + SQ.h; y++) for (let x = SQ.x; x < SQ.x + SQ.w; x++) ground[idx(x, y)] = PLAZA;
    carve(HALL.x + 3, HALL.y + HALL.h, HALL.x + 3, SQ.y); // de la puerta de Nimbo a la plaza
    const slotted = list.filter((h) => !h.hall);
    for (const id of [...slotOf.keys()]) if (!slotted.some((h) => h.id === id)) slotOf.delete(id);
    for (const h of slotted) if (!slotOf.has(h.id)) { const used = new Set(slotOf.values()); const free = SLOTS.findIndex((_, i) => !used.has(i)); if (free >= 0) slotOf.set(h.id, free); }
    const hallData = list.find((h) => h.hall);
    hallHouse = hallData ? { ...hallData, x: HALL.x, y: HALL.y, front: { x: HALL.x + 3, y: HALL.y + HALL.h }, work: { x: HALL.x + 4, y: HALL.y + HALL.h }, isHall: true } : null;
    plazaHome = { id: "plaza", name: t("Plaza"), isPlaza: true, chats: plazaChats, projects: [], front: { x: SQ.x + 2, y: SQ.y + 2 }, work: { x: SQ.x + 2, y: SQ.y + 2 } };
    houses = slotted.filter((h) => slotOf.has(h.id)).map((h) => {
      const [x, y] = SLOTS[slotOf.get(h.id)];
      const seed = hash(h.name);
      const front = { x: x + 2, y: y + HH };
      const midRow = SQ.y + 3;
      carve(front.x, front.y, front.x, midRow); // baja (o sube) hasta la fila de la plaza…
      carve(front.x, midRow, front.x < SQ.x ? SQ.x : front.x > SQ.x + SQ.w ? SQ.x + SQ.w - 1 : front.x, midRow); // …y va hasta ella
      return { ...h, x, y, front, work: { x: x + 3, y: y + HH }, roof: h.color || ROOFS[(h.tema ? hash(h.tema.toLowerCase()) : seed) % ROOFS.length], wall: seed & 1 ? "wood" : "stone", seed };
    });
    // Estanque
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const d = ((x + .5 - POND.x) / POND.rx) ** 2 + ((y + .5 - POND.y) / POND.ry) ** 2;
      if (d < 1 && ground[idx(x, y)] === GRASS) { ground[idx(x, y)] = WATER; solid[idx(x, y)] = 1; }
    }
    // Edificios: sólidos
    const block = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inMap(i, j)) solid[idx(i, j)] = 2; };
    block(HALL.x, HALL.y, HALL.w, HALL.h);
    for (const h of houses) { block(h.x, h.y, HW, HH); block(h.x + 4, h.y + HH, 1, 1); } // la casa y su mesa de trabajo
    // Fuente en el centro de la plaza y bancas
    const fx = SQ.x + 5, fy = SQ.y + 4;
    block(fx - 1, fy - 1, 2, 2);
    // Árboles: bosque en el borde, manchones adentro, casi nada cerca de la plaza y de los caminos
    const trees = [];
    const near = (x, y, k) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (inMap(x + i, y + j) && ground[idx(x + i, y + j)] === k) return true; return false; };
    for (let y = 1; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = idx(x, y);
      if (ground[i] !== GRASS || solid[i] || near(x, y, PATH) || near(x, y, PLAZA)) continue;
      if (solid[idx(x, y - 1)] === 2 || (y + 1 < MH && solid[idx(x, y + 1)] === 2)) continue; // no tapar casas
      const edge = Math.min(x, y, MW - 1 - x, MH - 1 - y);
      const n = Math.sin(x * .31 + 1.7) * Math.cos(y * .27 - .4) + Math.sin((x + y) * .17) * .6;
      const dPlaza = Math.hypot(x - (SQ.x + SQ.w / 2), y - (SQ.y + SQ.h / 2));
      const p = edge < 3 ? .9 : dPlaza < 9 ? 0 : n > .55 ? .55 : .05;
      if (r() < p) { trees.push({ x, y, kind: r() < .78 ? "pine" : "round", s: r() }); solid[i] = 1; }
    }
    // Flores, arbustos y piedras en el pasto libre
    const bits = [];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = idx(x, y);
      if (ground[i] !== GRASS || solid[i]) continue;
      const v = r();
      if (v < .05) bits.push({ x, y, kind: "flower", s: r() });
      else if (v < .065) { bits.push({ x, y, kind: "bush", s: r() }); solid[i] = 1; }
      else if (v < .072) { bits.push({ x, y, kind: "rock", s: r() }); solid[i] = 1; }
    }
    // Faroles en las esquinas de la plaza
    for (const [x, y] of [[SQ.x, SQ.y], [SQ.x + SQ.w - 1, SQ.y], [SQ.x, SQ.y + SQ.h - 1], [SQ.x + SQ.w - 1, SQ.y + SQ.h - 1]]) { deco.push({ x, y, kind: "lamp" }); solid[idx(x, y)] = 1; }
    drawStatic(trees, bits, { fx, fy });
    if (hallHouse) hallHouse.windows = HALL.windows;
  }

  // --- Arte (todo a mano, a píxeles) ---
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  function ellipse(g, cx, cy, rx, ry, c) { g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function grassTile(g, x, y, r) {
    const px = x * TILE, py = y * TILE;
    R(g, px, py, TILE, TILE, pick(r, ["#79b347", "#76af44", "#7db84a", "#74ab42"]));
    for (let k = 0; k < 5; k++) { const sx = px + Math.floor(r() * 15), sy = py + Math.floor(r() * 14); R(g, sx, sy, 1, 2, "#5e9636"); R(g, sx + 1, sy + 1, 1, 1, "#5e9636"); }
    for (let k = 0; k < 3; k++) R(g, px + Math.floor(r() * 16), py + Math.floor(r() * 16), 1, 1, "#9bcd62");
  }
  function pathTile(g, x, y, r) {
    const px = x * TILE, py = y * TILE;
    R(g, px, py, TILE, TILE, "#cfa66c");
    for (let k = 0; k < 4; k++) R(g, px + Math.floor(r() * 15), py + Math.floor(r() * 15), 2, 1, "#b48a52");
    for (let k = 0; k < 2; k++) R(g, px + Math.floor(r() * 15), py + Math.floor(r() * 15), 1, 1, "#e2c08a");
    const g2 = (i, j) => inMap(i, j) && ground[idx(i, j)] === GRASS;
    if (g2(x, y - 1)) { R(g, px, py, 16, 1, "#9c7845"); for (let k = 0; k < 16; k += 3) R(g, px + k, py, 1, 1 + ((k * 7) % 2), "#6aa33f"); }
    if (g2(x, y + 1)) R(g, px, py + 15, 16, 1, "#a98552");
    if (g2(x - 1, y)) R(g, px, py, 1, 16, "#9c7845");
    if (g2(x + 1, y)) R(g, px + 15, py, 1, 16, "#a98552");
  }
  function plazaTile(g, x, y) {
    const px = x * TILE, py = y * TILE;
    R(g, px, py, TILE, TILE, (x + y) % 2 ? "#c6c0b2" : "#bdb6a7");
    R(g, px, py + 15, 16, 1, "#a39c8d");
    R(g, px + 15, py, 1, 16, "#a39c8d");
    R(g, px + 1, py + 1, 14, 1, "#d6d0c3");
  }
  function waterTile(g, x, y, r) {
    const px = x * TILE, py = y * TILE;
    R(g, px, py, TILE, TILE, "#4c9fd6");
    for (let k = 0; k < 3; k++) R(g, px + Math.floor(r() * 12), py + Math.floor(r() * 14), 4, 1, "#7cc0ec");
    if (inMap(x, y - 1) && ground[idx(x, y - 1)] !== WATER) R(g, px, py, 16, 2, "#2f6f9e");
  }
  function pine(g, px, py, s) {
    const mid = s > .5 ? "#2f6d3b" : "#2b663a", dark = "#1d4a29", light = "#4e9a4c";
    ellipse(g, px + 8, py + 15, 7, 2.5, "rgba(0,0,0,.22)");
    R(g, px + 6, py + 10, 4, 6, "#6b4226");
    R(g, px + 6, py + 10, 1, 6, "#4a2c18");
    for (const [ty, w, h] of [[py + 1, 16, 11], [py - 6, 13, 9], [py - 12, 9, 8]]) {
      for (let i = 0; i < h; i++) {
        const rw = Math.max(1, Math.round((w * (i + 1)) / h));
        const x0 = px + 8 - rw / 2;
        R(g, x0, ty + i, rw, 1, mid);
        R(g, x0, ty + i, Math.max(1, Math.round(rw * .3)), 1, light);
        R(g, x0 + rw - 1, ty + i, 1, 1, dark);
      }
      R(g, px + 8 - w / 2, ty + h - 1, w, 1, dark);
    }
  }
  function roundTree(g, px, py, s) {
    ellipse(g, px + 8, py + 15, 7, 2.5, "rgba(0,0,0,.22)");
    R(g, px + 6, py + 8, 4, 8, "#6b4226");
    ellipse(g, px + 8, py + 2, 8, 8, "#1f5a2b");
    ellipse(g, px + 8, py + 1, 7, 7, s > .5 ? "#3b8a3e" : "#418f3a");
    ellipse(g, px + 6, py - 1, 4, 3.5, "#5fae52");
    if (s > .7) for (const [a, b] of [[4, 2], [10, 0], [9, 5]]) R(g, px + a, py + b, 2, 2, "#e74c3c"); // manzanas
  }
  function bit(g, b) {
    const px = b.x * TILE, py = b.y * TILE;
    if (b.kind === "flower") {
      const c = ["#ff6b8b", "#ffd23f", "#ffffff", "#b388ff", "#ff9f43"][Math.floor(b.s * 5)];
      for (const [a, c2] of [[3, 4], [10, 9], [6, 12]]) { R(g, px + a, py + c2 + 1, 1, 2, "#3f7a2b"); R(g, px + a - 1, py + c2, 3, 1, c); R(g, px + a, py + c2 - 1, 1, 3, c); R(g, px + a, py + c2, 1, 1, "#ffe9a0"); }
    } else if (b.kind === "bush") {
      ellipse(g, px + 8, py + 13, 7, 2, "rgba(0,0,0,.2)");
      ellipse(g, px + 8, py + 9, 7, 5.5, "#2c6b35");
      ellipse(g, px + 7, py + 8, 6, 4.5, "#3f8e45");
      R(g, px + 4, py + 6, 3, 2, "#62b05a");
    } else {
      ellipse(g, px + 8, py + 13, 6, 2, "rgba(0,0,0,.2)");
      ellipse(g, px + 8, py + 10, 6, 4, "#8a8f96");
      ellipse(g, px + 7, py + 9, 5, 3, "#a6abb2");
      R(g, px + 5, py + 8, 2, 1, "#c9cdd2");
    }
  }
  function house(g, h) {
    const px = h.x * TILE, py = h.y * TILE, roof = h.roof;
    ellipse(g, px + 40, py + 64, 40, 4, "rgba(0,0,0,.25)");
    // Paredes: madera o piedra
    const wall = h.wall === "wood" ? "#c99258" : "#a9a49a";
    R(g, px + 6, py + 26, 68, 38, wall);
    if (h.wall === "wood") for (let y = py + 30; y < py + 62; y += 4) R(g, px + 6, y, 68, 1, "#a87443");
    else for (let y = py + 28, row = 0; y < py + 62; y += 5, row++) { R(g, px + 6, y, 68, 1, "#8d887f"); for (let x = px + 6 + (row % 2) * 6; x < px + 74; x += 12) R(g, x, y, 1, 5, "#8d887f"); }
    R(g, px + 6, py + 26, 2, 38, shade(wall, -.25));
    R(g, px + 72, py + 26, 2, 38, shade(wall, -.3));
    R(g, px + 4, py + 62, 72, 3, "#7d776c"); // cimiento
    // Ventanas (la luz la pone el dibujo de cada cuadro)
    h.windows = [];
    for (const wx of [px + 13, px + 55]) {
      R(g, wx - 1, py + 37, 14, 12, "#5a3a22");
      R(g, wx, py + 38, 12, 10, "#9fd0f0");
      R(g, wx + 1, py + 39, 4, 3, "#d8f0ff");
      R(g, wx + 5, py + 38, 2, 10, "#5a3a22");
      R(g, wx, py + 42, 12, 2, "#5a3a22");
      R(g, wx - 1, py + 49, 14, 3, "#7a4a28"); // jardinera
      for (let k = 0; k < 4; k++) R(g, wx + k * 3 + 1, py + 47, 2, 2, ["#ff6b8b", "#ffd23f", "#ff9f43", "#ffffff"][(h.seed + k) % 4]);
      h.windows.push({ x: wx, y: py + 38, w: 12, h: 10 });
    }
    // Puerta
    R(g, px + 33, py + 44, 14, 20, "#4a2c18");
    R(g, px + 34, py + 45, 12, 19, "#7b4a26");
    for (let y = py + 48; y < py + 63; y += 4) R(g, px + 34, y, 12, 1, "#65391c");
    R(g, px + 43, py + 54, 2, 2, "#f2c14e");
    R(g, px + 31, py + 63, 18, 2, "#9a948a"); // escalón
    // Techo: trapecio a filas, con tejas
    for (let i = 0; i < 28; i++) {
      const rw = Math.round(54 + (24 * i) / 27);
      const x0 = px + 40 - rw / 2;
      R(g, x0, py + 4 + i, rw, 1, i % 4 === 3 ? shade(roof, -.25) : roof);
      R(g, x0 + rw - Math.round(rw * .28), py + 4 + i, Math.round(rw * .28), 1, shade(roof, i % 4 === 3 ? -.38 : -.15));
      R(g, x0, py + 4 + i, 2, 1, shade(roof, -.4));
      R(g, x0 + rw - 2, py + 4 + i, 2, 1, shade(roof, -.45));
    }
    R(g, px + 13, py + 3, 54, 2, shade(roof, .3)); // cumbrera
    R(g, px + 2, py + 31, 76, 2, shade(roof, -.5)); // alero
    R(g, px + 6, py + 33, 68, 2, "rgba(0,0,0,.18)"); // sombra del alero
    // Chimenea
    R(g, px + 54, py - 4, 9, 14, "#8e4b36");
    R(g, px + 53, py - 6, 11, 3, "#6d3627");
    R(g, px + 55, py - 1, 3, 1, "#a8604a");
    h.chimney = { x: px + 58, y: py - 7 };
    // Mesa de trabajo con yunque, a la derecha de la puerta
    const bx = (h.x + 4) * TILE, by = (h.y + HH) * TILE;
    ellipse(g, bx + 8, by + 14, 7, 2, "rgba(0,0,0,.22)");
    R(g, bx + 2, by + 6, 12, 3, "#8a5a32");
    R(g, bx + 3, by + 9, 2, 5, "#6b4226");
    R(g, bx + 11, by + 9, 2, 5, "#6b4226");
    R(g, bx + 5, by + 3, 7, 3, "#5d6670");
    R(g, bx + 4, by + 2, 9, 1, "#7f8a95");
  }
  function hall(g) {
    const px = HALL.x * TILE, py = HALL.y * TILE;
    ellipse(g, px + 64, py + 96, 62, 5, "rgba(0,0,0,.25)");
    R(g, px + 8, py + 40, 112, 56, "#efeae0");
    for (let y = py + 46; y < py + 94; y += 6) R(g, px + 8, y, 112, 1, "#ddd6c8");
    for (const cx of [px + 14, px + 106]) { R(g, cx, py + 42, 8, 54, "#ffffff"); R(g, cx + 6, py + 42, 2, 54, "#cfc8b9"); }
    R(g, px + 4, py + 93, 120, 4, "#8f8a80");
    // Puerta doble
    R(g, px + 50, py + 66, 28, 30, "#1f3f66");
    R(g, px + 52, py + 68, 11, 28, "#2f5f97");
    R(g, px + 65, py + 68, 11, 28, "#2f5f97");
    R(g, px + 60, py + 80, 2, 3, "#f2c14e"); R(g, px + 66, py + 80, 2, 3, "#f2c14e");
    // Ventanas altas
    for (const wx of [px + 26, px + 88]) { R(g, wx - 1, py + 55, 16, 22, "#1f3f66"); R(g, wx, py + 56, 14, 20, "#a9d8f5"); R(g, wx + 6, py + 56, 2, 20, "#1f3f66"); R(g, wx, py + 64, 14, 2, "#1f3f66"); }
    HALL.windows = [{ x: px + 26, y: py + 56, w: 14, h: 20 }, { x: px + 88, y: py + 56, w: 14, h: 20 }];
    // Techo azul grande con frontón
    for (let i = 0; i < 40; i++) {
      const rw = Math.round(70 + (60 * i) / 39);
      const x0 = px + 64 - rw / 2;
      R(g, x0, py + 2 + i, rw, 1, i % 5 === 4 ? "#2a5f9e" : "#3a78c2");
      R(g, x0 + rw - Math.round(rw * .25), py + 2 + i, Math.round(rw * .25), 1, "#2d649f");
    }
    R(g, px + 29, py + 1, 70, 2, "#7fb2e6");
    R(g, px + 1, py + 41, 126, 3, "#1f4f86");
    // Emblema: la nube de Nimbo con su carita
    const cx = px + 64, cy = py + 22;
    ellipse(g, cx, cy + 2, 17, 9, "#cfe3f7");
    ellipse(g, cx - 7, cy - 1, 8, 7, "#ffffff"); ellipse(g, cx + 6, cy - 3, 9, 8, "#ffffff"); ellipse(g, cx, cy + 3, 15, 7, "#ffffff");
    R(g, cx - 5, cy, 2, 3, "#2b2d42"); R(g, cx + 3, cy, 2, 3, "#2b2d42");
    R(g, cx - 2, cy + 4, 4, 1, "#2b2d42");
    R(g, cx - 9, cy + 3, 3, 1, "#ff9bb3"); R(g, cx + 6, cy + 3, 3, 1, "#ff9bb3");
    // Banderines
    for (const fx of [px + 10, px + 116]) { R(g, fx, py + 8, 2, 34, "#6b4226"); R(g, fx + 2, py + 9, 10, 7, "#ffd23f"); R(g, fx + 2, py + 16, 6, 2, "#ffd23f"); }
  }
  function lamp(g, d) {
    const px = d.x * TILE, py = d.y * TILE;
    ellipse(g, px + 8, py + 15, 4, 1.5, "rgba(0,0,0,.25)");
    R(g, px + 7, py - 6, 2, 21, "#3b3f45");
    R(g, px + 4, py - 11, 8, 6, "#3b3f45");
    R(g, px + 5, py - 10, 6, 4, "#ffe9a0");
    R(g, px + 5, py - 13, 6, 2, "#2b2f35");
  }
  function fountain(g, fx, fy) {
    const px = fx * TILE, py = fy * TILE;
    ellipse(g, px, py + 6, 20, 9, "#8d887f");
    ellipse(g, px, py + 5, 18, 8, "#a9a49a");
    ellipse(g, px, py + 5, 15, 6, "#4c9fd6");
    ellipse(g, px - 4, py + 3, 5, 1.5, "#8cc8ef");
    R(g, px - 2, py - 8, 4, 12, "#bdb6a7");
    ellipse(g, px, py - 8, 6, 2.5, "#bdb6a7");
  }
  function bench(g, x, y) {
    const px = x * TILE, py = y * TILE;
    R(g, px + 1, py + 6, 14, 3, "#8a5a32"); R(g, px + 1, py + 3, 14, 2, "#a06a3a");
    R(g, px + 2, py + 9, 2, 4, "#5d3a1e"); R(g, px + 12, py + 9, 2, 4, "#5d3a1e");
  }
  function drawStatic(trees, bits, { fx, fy }) {
    staticLayer = document.createElement("canvas");
    staticLayer.width = MW * TILE;
    staticLayer.height = MH * TILE;
    const g = staticLayer.getContext("2d");
    const r = rng(7);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const k = ground[idx(x, y)];
      if (k === GRASS) grassTile(g, x, y, r); else if (k === PATH) pathTile(g, x, y, r); else if (k === PLAZA) plazaTile(g, x, y); else waterTile(g, x, y, r);
    }
    for (const b of bits) bit(g, b);
    fountain(g, fx, fy); // la fuente queda entre 4 baldosas
    FOUNTAIN.x = fx * TILE; FOUNTAIN.y = fy * TILE;
    bench(g, SQ.x + 2, SQ.y + 6); bench(g, SQ.x + 8, SQ.y + 6); bench(g, SQ.x + 2, SQ.y + 1); bench(g, SQ.x + 8, SQ.y + 1);
    // De arriba hacia abajo: lo de más abajo tapa a lo de arriba
    const things = [...trees.map((tr) => ({ y: tr.y, draw: () => (tr.kind === "pine" ? pine : roundTree)(g, tr.x * TILE, tr.y * TILE, tr.s) })),
      ...houses.map((h) => ({ y: h.y + HH, draw: () => house(g, h) })), { y: HALL.y + HALL.h, draw: () => hall(g) },
      ...deco.map((d) => ({ y: d.y, draw: () => lamp(g, d) }))];
    things.sort((a, b) => a.y - b.y).forEach((x) => x.draw());
  }
  const FOUNTAIN = { x: 0, y: 0 };

  // --- Caminar: la ruta más corta, prefiriendo los caminos (el pasto "cuesta" más) ---
  const walkable = (x, y) => inMap(x, y) && !solid[idx(x, y)];
  function route(sx, sy, tx, ty) {
    if (!walkable(tx, ty)) return null;
    const dist = new Float32Array(MW * MH).fill(Infinity);
    const prev = new Int32Array(MW * MH).fill(-1);
    const heap = [[0, idx(sx, sy)]];
    dist[idx(sx, sy)] = 0;
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const goal = idx(tx, ty);
    while (heap.length) {
      const [d, i] = pop();
      if (i === goal) break;
      if (d > dist[i]) continue;
      const x = i % MW, y = (i / MW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!walkable(nx, ny) && idx(nx, ny) !== goal) continue;
        const ni = idx(nx, ny);
        const nd = d + (ground[ni] === GRASS ? 2.5 : 1);
        if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; push([nd, ni]); }
      }
    }
    if (prev[goal] < 0 && goal !== idx(sx, sy)) return null;
    const out = [];
    for (let i = goal; i !== idx(sx, sy) && i >= 0; i = prev[i]) out.push({ x: (i % MW) * TILE + 8, y: ((i / MW) | 0) * TILE + 12 });
    return out.reverse();
  }
  const tileOf = (p) => ({ x: clamp(Math.floor(p.x / TILE), 0, MW - 1), y: clamp(Math.floor((p.y - 4) / TILE), 0, MH - 1) });

  // --- Personajes ---
  const SKIN = ["#f5cfa6", "#e8b48a", "#c98d62", "#9c6644", "#f0c08f"];
  const HAIR = ["#3b2a1a", "#6b4226", "#1f1f1f", "#c48a3a", "#8e3b2e", "#d9c27a", "#4a4a6a"];
  const SHIRT = ["#e74c3c", "#3498db", "#27ae60", "#9b59b6", "#f39c12", "#16a085", "#e67e22", "#2c3e50", "#d35400", "#c2185b"];
  const palette = (id) => { const h = hash(id); return { skin: SKIN[h % 5], hair: HAIR[(h >>> 3) % 7], shirt: SHIRT[(h >>> 6) % 10], pants: ["#34495e", "#5d4037", "#2c3e50", "#455a64"][(h >>> 10) % 4] }; };
  function person(g, x, y, p, dir, walk, { tool = false, cap = null, jump = 0 } = {}) {
    x = Math.round(x); y = Math.round(y - jump);
    ellipse(g, x, Math.round(y + jump), 4.5, 1.6, "rgba(0,0,0,.28)");
    const lift = walk ? 1 : 0;
    const rects = [
      [x - 3, y - 4 + (walk === 1 ? -1 : 0), 2, 4, p.pants], [x + 1, y - 4 + (walk === 2 ? -1 : 0), 2, 4, p.pants], // piernas
      [x - 4, y - 9, 8, 5, p.shirt], // cuerpo
      [x - 5, y - 9 + (walk ? lift : 0), 1, 4, p.skin], [x + 4, y - 9 + (walk ? 1 - lift : 0), 1, 4, p.skin], // brazos
      [x - 4, y - 16, 8, 7, p.skin], // cabeza
    ];
    for (const [a, b, w, h] of rects) R(g, a - 1, b - 1, w + 2, h + 2, "#2a1c12"); // contorno
    for (const [a, b, w, h, c] of rects) R(g, a, b, w, h, c);
    R(g, x - 4, y - 9, 8, 1, shade(p.shirt, -.25));
    // Pelo (o gorra) y ojos según hacia dónde mira
    const hair = cap ?? p.hair;
    if (dir === "up") { R(g, x - 4, y - 16, 8, 6, hair); }
    else {
      R(g, x - 4, y - 16, 8, 2, hair);
      if (dir !== "right") R(g, x - 4, y - 14, 1, 3, hair);
      if (dir !== "left") R(g, x + 3, y - 14, 1, 3, hair);
      const eye = "#1f1f1f";
      if (dir === "down") { R(g, x - 2, y - 12, 1, 2, eye); R(g, x + 1, y - 12, 1, 2, eye); R(g, x - 3, y - 10, 1, 1, "#f19aa0"); R(g, x + 2, y - 10, 1, 1, "#f19aa0"); }
      if (dir === "left") R(g, x - 3, y - 12, 1, 2, eye);
      if (dir === "right") R(g, x + 2, y - 12, 1, 2, eye);
    }
    if (cap) { R(g, x - 4, y - 17, 8, 2, cap); R(g, dir === "left" ? x - 6 : dir === "right" ? x + 2 : x - 3, y - 15, dir === "up" ? 0 : 4, 1, shade(cap, -.3)); }
    if (tool) { // martillo: sube y baja
      const up = tool === 1;
      R(g, x + 5, y - (up ? 14 : 9), 1, 6, "#6b4226");
      R(g, x + 3, y - (up ? 15 : 10), 5, 2, "#8a939c");
    }
  }
  function cloud(g, x, y) {
    x = Math.round(x); y = Math.round(y);
    ellipse(g, x, y + 9, 5, 1.5, "rgba(0,0,0,.18)");
    ellipse(g, x, y + 1, 7, 4, "#bcd6f2");
    ellipse(g, x - 3, y - 1, 4, 3.5, "#ffffff"); ellipse(g, x + 2, y - 2, 4.5, 4, "#ffffff"); ellipse(g, x, y + 1, 6.5, 3.2, "#ffffff");
    R(g, x - 3, y - 1, 1, 2, "#2b2d42"); R(g, x + 2, y - 1, 1, 2, "#2b2d42");
    R(g, x - 5, y + 1, 2, 1, "#ff9bb3"); R(g, x + 3, y + 1, 2, 1, "#ff9bb3");
  }

  // Aldeanos: uno por chat. live = lo que dicen los eventos de Claude Code ahora mismo.
  let villagers = [];
  const live = new Map(); // id del chat → { state, step, at, ctx, message }
  let NAME = "";
  const player = { x: 0, y: 0, dir: "down", walk: 0, path: null, step: 0, pal: { skin: "#f5cfa6", hair: "#3b2a1a", shirt: "#2e86de", pants: "#2c3e50" } };
  const buddy = { x: 0, y: 0, trail: [] };

  function makeVillagers() {
    const keep = new Map(villagers.map((v) => [v.id, v]));
    villagers = [];
    for (const h of homes()) for (const c of h.chats) {
      const old = keep.get(c.id);
      const r = rng(hash(c.id));
      const start = { x: h.front.x * TILE + 8 + Math.round((r() - .5) * 20), y: (h.front.y + 1) * TILE + 12 };
      villagers.push(old ? Object.assign(old, { chat: c, house: h }) : { id: c.id, chat: c, house: h, pal: palette(c.id), x: start.x, y: start.y, dir: "down", walk: 0, path: null,
        mode: "idle", wait: 1 + r() * 4, bubble: null, talk: null, cooldown: 10 + r() * 20, jump: 0, tool: 0, r });
    }
  }
  const nameOf = (v) => short(v.chat.title || v.house.name, 22);
  const stateOf = (v) => {
    const l = live.get(v.id);
    if (!l) return v.chat.active ? "working" : "idle";
    const age = Date.now() - l.at;
    if (l.state === "working" || l.state === "thinking") return age < 5 * 60_000 ? "working" : "idle";
    if (l.state === "finished") return age < 3000 ? "finished" : "idle";
    if (l.state === "error") return age < 4000 ? "error" : "idle";
    return l.state;
  };
  function say(v, text, ms = 2600, kind = "") { v.bubble = { text: short(text, 64), until: performance.now() + ms, kind }; }
  function goTo(v, tx, ty) { const from = tileOf(v); const p = route(from.x, from.y, tx, ty); v.path = p && p.length ? p : null; return !!v.path; }
  function randomSpot(r) { // un punto de camino o de la plaza
    for (let k = 0; k < 40; k++) { const x = Math.floor(r() * MW), y = Math.floor(r() * MH); if ((ground[idx(x, y)] === PATH || ground[idx(x, y)] === PLAZA) && walkable(x, y)) return { x, y }; }
    return { x: SQ.x + 1, y: SQ.y + 1 };
  }
  const night = () => { const h = new Date().getHours(); return h >= 21 || h < 6; };

  // Conversaciones entre aldeanos: con lo que de verdad están haciendo.
  function chatLines(a, b) {
    const r = a.r;
    const greet = pick(r, [t("¡Hola, {0}!", nameOf(b)), t("¿Qué más, {0}?", nameOf(b)), t("¿Cómo va {0}?", b.house.name)]);
    const lb = live.get(b.id);
    const answer = stateOf(b) === "working" && lb?.step ? t("Ando con {0}.", lb.step)
      : b.chat.lastPrompt ? t("Lo último que me pidieron: {0}", short(b.chat.lastPrompt, 44))
      : t("Tranquilo, esperando a {0}.", NAME || t("Federico"));
    const reply = stateOf(a) === "working" ? t("Yo sigo con lo mío en {0}.", a.house.name) : pick(r, [t("¡Ánimo con eso!"), t("Nos vemos en la plaza."), t("¡Suerte! Avísame si necesitas algo."), t("Qué bien, a mí me falta poco.")]);
    return [[a, greet], [b, answer], [a, reply]];
  }

  function updateVillager(v, dt, now) {
    const st = stateOf(v);
    const h = v.house;
    if (v.bubble && now > v.bubble.until) v.bubble = null;
    v.jump = Math.max(0, v.jump - dt * 30);
    if (v.talk) { // conversando: quietos, mirándose
      v.path = null;
      return;
    }
    if (st !== v.mode) {
      v.mode = st;
      v.path = null;
      if (st === "working") goTo(v, h.work.x, h.work.y);
      if (st === "needs") { const k = villagers.indexOf(v); goTo(v, HALL.x + 1 + (k % 6), SQ.y + 1); }
      if (st === "finished") { v.jump = 10; say(v, t("✓ ¡Listo!"), 3000, "done"); }
      if (st === "error") say(v, t("Uy, algo falló 😢"), 3500);
    }
    if (v.path) { moveAlong(v, dt, 30); return; }
    v.walk = 0;
    if (st === "working") {
      const atBench = tileOf(v).x === h.work.x && tileOf(v).y === h.work.y;
      if (!atBench) { if (!goTo(v, h.work.x, h.work.y)) v.tool = 0; return; }
      v.dir = "right";
      v.tool = Math.floor(now / 260) % 2 ? 1 : 2;
      const l = live.get(v.id);
      if (l?.step && l.shown !== l.step) { l.shown = l.step; say(v, l.step, 3400, "work"); }
      return;
    }
    v.tool = 0;
    if (st === "needs") { v.dir = "up"; if (!v.bubble || v.bubble.kind !== "alert") say(v, "!", 60_000, "alert"); return; }
    if (v.bubble?.kind === "alert") v.bubble = null;
    if (night() && !v.chat.active && !h.isPlaza) { // de noche los que no trabajan se van a dormir
      if (tileOf(v).x === h.front.x && tileOf(v).y === h.front.y) { v.inside = true; return; }
      goTo(v, h.front.x, h.front.y);
      return;
    }
    v.inside = false;
    v.wait -= dt;
    if (v.wait > 0) return;
    v.wait = 3 + v.r() * 6;
    if (h.isPlaza) { goTo(v, SQ.x + 1 + Math.floor(v.r() * (SQ.w - 2)), SQ.y + 1 + Math.floor(v.r() * (SQ.h - 2))); return; } // los sin casa pasean por la plaza
    if (v.r() < .25) { goTo(v, h.front.x, h.front.y + 1); return; } // volver un rato a casa
    const s = randomSpot(v.r);
    goTo(v, s.x, s.y);
  }
  function moveAlong(v, dt, speed) {
    const target = v.path[0];
    const dx = target.x - v.x, dy = target.y - v.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) { v.path.shift(); if (!v.path.length) v.path = null; return; }
    const s = Math.min(d, speed * dt);
    v.x += (dx / d) * s;
    v.y += (dy / d) * s;
    v.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    v.step = (v.step ?? 0) + s;
    v.walk = Math.floor(v.step / 5) % 2 ? 1 : 2;
  }
  // Cada tanto, dos aldeanos tranquilos que andan cerca se juntan a conversar.
  let talkClock = 4;
  function maybeTalk(dt, now) {
    for (const v of villagers) if (v.talk && now > v.talk.end) { v.talk = null; v.cooldown = 25 + v.r() * 30; }
    for (const v of villagers) v.cooldown -= dt;
    talkClock -= dt;
    if (talkClock > 0) return;
    talkClock = 3 + Math.random() * 3;
    const free = villagers.filter((v) => !v.talk && !v.inside && v.cooldown <= 0 && stateOf(v) === "idle");
    for (const a of free) {
      const b = free.find((x) => x !== a && Math.hypot(x.x - a.x, x.y - a.y) < 70);
      if (!b) continue;
      const lines = chatLines(a, b);
      const end = now + lines.length * 2600 + 400;
      a.talk = { with: b, end }; b.talk = { with: a, end };
      a.dir = b.x > a.x ? "right" : "left"; b.dir = a.x > b.x ? "right" : "left";
      lines.forEach(([who, text], i) => setTimeout(() => say(who, text, 2500), i * 2600));
      return;
    }
  }

  // --- Cámara, tamaño y eventos ---
  const canvas = $("world");
  const ctx = canvas.getContext("2d");
  let SCALE = 3, VW = 0, VH = 0, cam = { x: 0, y: 0 };
  // Zoom: la rueda del mouse, las teclas + y − (0 vuelve a lo normal) o los botones. Siempre en pasos enteros para que los
  // píxeles sigan nítidos: 1 = toda la aldea a la vista, 6 = muy de cerca. Se recuerda en este equipo.
  let zoom = 0; // pasos sobre el tamaño automático
  try { zoom = Number(localStorage.getItem("aldea-zoom")) || 0; } catch {}
  const autoScale = () => clamp(Math.round(Math.min(innerWidth / 520, innerHeight / 330)), 2, 5); // ~34×21 baldosas a la vista
  function setZoom(step) {
    const next = clamp(autoScale() + step, 1, 6) - autoScale();
    if (next === zoom && step !== 0) return;
    zoom = next;
    try { localStorage.setItem("aldea-zoom", String(zoom)); } catch {}
    resize();
  }
  function resize() {
    SCALE = clamp(autoScale() + zoom, 1, 6);
    VW = Math.ceil(innerWidth / SCALE);
    VH = Math.ceil(innerHeight / SCALE);
    canvas.width = VW;
    canvas.height = VH;
    ctx.imageSmoothingEnabled = false;
  }
  addEventListener("resize", resize);
  resize();
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  $("zoomIn").onclick = () => setZoom(zoom + 1);
  $("zoomOut").onclick = () => setZoom(zoom - 1);

  const keys = new Set();
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeAll(); return; }
    if (e.target.closest?.("input")) return;
    if (["+", "=", "-", "_", "0"].includes(e.key) && !e.ctrlKey) { e.preventDefault(); setZoom(e.key === "0" ? 0 : zoom + (e.key === "-" || e.key === "_" ? -1 : 1)); return; }
    if (!$("house").classList.contains("hidden") || !$("lightbox").classList.contains("hidden")) return;
    const k = e.key.toLowerCase();
    if (["e", " ", "enter"].includes(k)) { e.preventDefault(); if (!$("dialog").classList.contains("hidden")) closeDialog(); else interact(); return; }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { e.preventDefault(); keys.add(k); player.path = null; $("help").style.opacity = .35; }
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());

  function updatePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys.has("a") || keys.has("arrowleft")) dx--;
    if (keys.has("d") || keys.has("arrowright")) dx++;
    if (keys.has("w") || keys.has("arrowup")) dy--;
    if (keys.has("s") || keys.has("arrowdown")) dy++;
    if (dx || dy) {
      const sp = 64 * dt / Math.hypot(dx, dy);
      const tryMove = (nx, ny) => { const tl = tileOf({ x: nx, y: ny }); if (walkable(tl.x, tl.y)) { player.x = nx; player.y = ny; return true; } return false; };
      if (!tryMove(player.x + dx * sp, player.y)) dx && tryMove(player.x, player.y);
      tryMove(player.x, player.y + dy * sp);
      player.dir = Math.abs(dx) >= Math.abs(dy) && dx ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      player.step += sp;
      player.walk = Math.floor(player.step / 6) % 2 ? 1 : 2;
    } else if (player.path) moveAlong(player, dt, 70);
    else player.walk = 0;
    player.x = clamp(player.x, 8, MW * TILE - 8);
    player.y = clamp(player.y, 16, MH * TILE - 2);
    // Nimbo flota detrás, siguiendo el rastro del jugador
    buddy.trail.push({ x: player.x, y: player.y });
    if (buddy.trail.length > 14) buddy.trail.shift();
    const tgt = buddy.trail[0];
    buddy.x += (tgt.x - 10 - buddy.x) * Math.min(1, dt * 4);
    buddy.y += (tgt.y - 6 - buddy.y) * Math.min(1, dt * 4);
  }
  function updateCamera(dt) {
    const tx = MW * TILE <= VW ? (MW * TILE - VW) / 2 : clamp(player.x - VW / 2, 0, MW * TILE - VW);
    const ty = MH * TILE <= VH ? (MH * TILE - VH) / 2 : clamp(player.y - VH / 2, 0, MH * TILE - VH);
    cam.x += (tx - cam.x) * Math.min(1, dt * 5);
    cam.y += (ty - cam.y) * Math.min(1, dt * 5);
  }

  // Hablar con lo que está al lado (o con lo que tocaste)
  function nearestVillager(p, max = 22) {
    let best = null, bd = max;
    for (const v of villagers) { if (v.inside) continue; const d = Math.hypot(v.x - p.x, v.y - 8 - (p.y - 8)); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  function houseAt(tx, ty) {
    if (tx >= HALL.x && tx < HALL.x + HALL.w && ty >= HALL.y - 1 && ty <= HALL.y + HALL.h) return hallHouse ?? "hall";
    return houses.find((h) => tx >= h.x && tx < h.x + HW && ty >= h.y - 1 && ty <= h.y + HH) ?? null;
  }
  function interact() {
    const v = nearestVillager(player);
    if (v) return talkTo(v);
    const tl = tileOf(player);
    for (const [dx, dy] of [[0, -1], [0, 0], [-1, 0], [1, 0]]) { const h = houseAt(tl.x + dx, tl.y + dy); if (h) return h === "hall" ? hallTalk() : openHouse(h); }
    showDialog(NAME || t("Tú"), pick(Math.random, [t("Nada por aquí. Acércate a un aldeano o a una puerta."), t("Qué día tan bonito en la aldea.")]), []);
  }
  function talkTo(v) {
    const l = live.get(v.id);
    const st = stateOf(v);
    const lines = [];
    if (st === "working") lines.push(l?.step ? t("Estoy trabajando: {0}", l.step) : t("Estoy trabajando en {0}.", v.house.name));
    else if (st === "needs") lines.push(t("¡Te necesito! {0}", l?.message || t("Tengo una pregunta o un permiso esperando.")));
    else if (l?.at) lines.push(t("Terminé {0}. ¿Me das otro encargo?", ago(l.at)));
    else lines.push(t("Vivo en {0}. Mi último movimiento fue {1}.", v.house.name, ago(v.chat.at)));
    if (v.chat.lastPrompt) lines.push(t("Lo último que me pediste: «{0}»", short(v.chat.lastPrompt, 110)));
    if (l?.ctx) lines.push(t("Llevo {0} % de mi memoria (contexto).", l.ctx.pct));
    const home = el("button", "px", v.house.isPlaza ? t("Buscarme casa") : t("Ver mi casa"));
    home.onclick = () => (v.house.isPlaza ? showMove(v) : (closeDialog(), openHouse(v.house)));
    const move = el("button", "px alt", t("Mudarme…"));
    move.onclick = () => showMove(v);
    if (v.house.isPlaza) lines.push(t("Vivo en la plaza: todavía no tengo casa."));
    v.dir = player.x > v.x ? "right" : player.x < v.x - 2 ? "left" : player.y > v.y ? "down" : "up";
    showDialog(nameOf(v), lines.join("\n"), v.house.isPlaza ? [home] : [home, move]);
  }
  // Mudar un chat: a otra casa, a la plaza o a una casa nueva que nace con él. Queda guardado en aldea.json.
  function showMove(v) {
    const go = (to) => async () => { const r = await api.move(v.id, to).catch(() => null); if (r?.error === "broken") return showDialog(nameOf(v), t("No puedo: aldea.json tiene un error y no lo quiero pisar. Arréglalo o bórralo."), []); closeDialog(); await load(); };
    const targets = [hallHouse, ...houses].filter((h) => h && h !== v.house).map((h) => { const b = el("button", "px alt", h.isHall ? `Nimbo · ${h.name}` : h.name); b.onclick = go(h.id); return b; });
    if (!v.house.isPlaza) { const p = el("button", "px alt", t("Plaza (sin casa)")); p.onclick = go("plaza"); targets.push(p); }
    const fresh = el("button", "px", t("＋ Casa nueva"));
    fresh.onclick = () => {
      const input = el("input", "px-input");
      input.value = short(v.chat.title, 40);
      input.maxLength = 40;
      const ok = el("button", "px", t("Fundar"));
      ok.onclick = async () => { const r = await api.found(v.id, input.value).catch(() => null); if (r?.error === "broken") return showDialog(nameOf(v), t("No puedo: aldea.json tiene un error y no lo quiero pisar. Arréglalo o bórralo."), []); closeDialog(); await load(); };
      input.onkeydown = (e) => { if (e.key === "Enter") ok.click(); };
      showDialog(nameOf(v), t("¿Cómo se llama la casa nueva?"), [input, ok]);
      setTimeout(() => input.focus(), 30);
    };
    showDialog(nameOf(v), t("¿A dónde me mudo?"), [...targets, fresh]);
  }
  function hallTalk() {
    const busy = villagers.filter((v) => stateOf(v) === "working").length;
    const needs = villagers.filter((v) => stateOf(v) === "needs").length;
    if (hallHouse) { closeDialog(); return openHouse(hallHouse); }
    showDialog("Nimbo", [t("¡Bienvenido a la aldea, {0}! Aquí vive cada uno de tus chats de Claude Code.", NAME || t("Federico")),
      t("Hoy: {0} casas, {1} trabajando y {2} esperándote.", houses.length, busy, needs)].join("\n"), []);
  }

  // --- Cuadro de diálogo y casa ---
  function showDialog(name, text, buttons) {
    $("dlgName").textContent = name;
    $("dlgText").textContent = text;
    const close = el("button", "px alt", t("Cerrar"));
    close.onclick = closeDialog;
    $("dlgBtns").replaceChildren(...buttons, close);
    $("dialog").classList.remove("hidden");
  }
  const closeDialog = () => $("dialog").classList.add("hidden");
  function closeAll() { closeDialog(); $("house").classList.add("hidden"); $("lightbox").classList.add("hidden"); }
  $("houseClose").onclick = () => $("house").classList.add("hidden");
  $("house").onclick = (e) => { if (e.target === $("house")) $("house").classList.add("hidden"); };
  $("lightbox").onclick = () => $("lightbox").classList.add("hidden");

  const STATE_TEXT = { working: t("Trabajando"), needs: t("Te necesita"), finished: t("Terminó"), error: t("Falló"), idle: t("Tranquilo") };
  async function openHouse(h) {
    closeDialog();
    $("houseName").textContent = h.name;
    $("housePath").textContent = [h.tema, h.more ? t("y {0} chats más", h.more) : ""].filter(Boolean).join(" · ");
    $("houseBtns").replaceChildren();
    const projects = h.projects ?? [];
    $("houseGit").replaceChildren(...(projects.length ? projects.map((p) => {
      const box = el("div", "project");
      const head = el("div", "phead");
      head.append(el("b", "", p.name), el("span", "ppath", p.path));
      const git = el("div", "pgit");
      if (p.git) {
        git.append(t("Rama "), el("code", "", p.git.branch), " · ", t("último commit {0}: ", p.git.when ? ago(p.git.when) : ""), el("b", "", p.git.subject));
        if (p.git.changes) git.append(" · ", el("span", "", t("{0} cambios sin guardar", p.git.changes)));
      } else git.textContent = t("No es un repositorio de git (o no tiene commits).");
      const btns = el("div", "pbtns");
      const folder = el("button", "px", t("Abrir carpeta"));
      folder.onclick = () => api.open(h.id, "folder", p.i);
      btns.append(folder);
      if (p.git?.github) { const gh = el("button", "px alt", t("Ver en GitHub")); gh.onclick = () => api.open(h.id, "github", p.i); btns.append(gh); }
      box.append(head, git, btns);
      return box;
    }) : [el("div", "pgit", t("Esta casa no tiene carpetas: sus chats viven aquí por su título o porque los mudaste."))]));
    $("houseChats").replaceChildren(...h.chats.map((c) => {
      const v = villagers.find((x) => x.id === c.id);
      const row = el("div", "chatrow");
      const mini = document.createElement("canvas");
      mini.width = 14; mini.height = 20;
      const mg = mini.getContext("2d");
      person(mg, 7, 19, v?.pal ?? palette(c.id), "down", 0);
      const info = el("div", "ci");
      info.append(el("b", "", c.title), el("i", "", c.lastPrompt ? `«${c.lastPrompt}»` : ago(c.at)));
      const st = v ? stateOf(v) : "idle";
      const l = live.get(c.id);
      row.append(mini, info, el("span", `st ${st}`, STATE_TEXT[st] ?? st));
      if (l?.ctx) row.append(el("span", "st", t("contexto {0} %", l.ctx.pct)));
      return row;
    }));
    const box = $("housePhotos");
    box.replaceChildren(el("div", "none", t("Buscando fotos…")));
    $("house").classList.remove("hidden");
    const names = await api.photos(h.id).catch(() => []);
    if (!names.length) { box.replaceChildren(el("div", "none", t("No encontré imágenes en esta carpeta (busco capturas, portadas e imágenes del proyecto; no entro a node_modules ni a build)."))); return; }
    box.replaceChildren(...names.map((n, i) => {
      const fig = el("figure");
      const img = el("img");
      img.alt = n;
      fig.append(img, el("figcaption", "", n));
      api.photo(h.id, i).then((src) => { if (src) img.src = src; else fig.remove(); });
      fig.onclick = () => { if (!img.src) return; $("lightImg").src = img.src; $("lightCap").textContent = n; $("lightbox").classList.remove("hidden"); };
      return fig;
    }));
  }

  // --- Ratón: pasar por encima muestra el nombre; clic habla, entra o camina hasta ahí ---
  let hover = null;
  const worldAt = (e) => ({ x: e.clientX / SCALE + cam.x, y: e.clientY / SCALE + cam.y });
  function villagerAt(p) { return villagers.find((v) => !v.inside && Math.abs(v.x - p.x) < 7 && p.y < v.y + 2 && p.y > v.y - 20) ?? null; }
  canvas.addEventListener("mousemove", (e) => {
    const p = worldAt(e);
    hover = villagerAt(p) ?? (Math.hypot(player.x - p.x, player.y - 8 - p.y) < 10 ? "player" : null);
  });
  canvas.addEventListener("mouseleave", () => (hover = null));
  canvas.addEventListener("click", (e) => {
    const p = worldAt(e);
    const v = villagerAt(p);
    if (v) return talkTo(v);
    const tl = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
    const h = houseAt(tl.x, tl.y);
    if (h === "hall") return hallTalk();
    if (h) return openHouse(h);
    const from = tileOf(player);
    const path = route(from.x, from.y, tl.x, tl.y);
    if (path) player.path = path;
  });

  // --- HUD: pestañas (casas, o los aldeanos según lo que hacen) y la lista, que lleva la cámara (y a ti) a cada uno ---
  let hudKey = "";
  let hudTab = "houses";
  try { hudTab = localStorage.getItem("aldea-tab") || "houses"; } catch {}
  const groupOf = (v) => { const st = stateOf(v); return st === "working" || st === "needs" ? st : "free"; };
  const TABS = [["houses", t("Casas")], ["working", t("Trabajando")], ["needs", t("Esperándote")], ["free", t("Libres")]];
  function renderHud() {
    const busy = villagers.filter((v) => stateOf(v) === "working").length;
    $("hudStats").textContent = t("{0} casas · {1} aldeanos · {2} trabajando", houses.length + (hallHouse ? 1 : 0), villagers.length, busy);
    const count = { houses: houses.length + (hallHouse ? 1 : 0), working: 0, needs: 0, free: 0 };
    for (const v of villagers) count[groupOf(v)]++;
    const people = hudTab === "houses" ? [] : villagers.filter((v) => groupOf(v) === hudTab).sort((a, b) => b.chat.at - a.chat.at);
    const list = [...(hallHouse ? [hallHouse] : []), ...houses, ...(plazaHome?.chats.length ? [plazaHome] : [])];
    const key = hudTab + JSON.stringify(count) + (hudTab === "houses" ? list.map((h) => h.id + h.chats.length).join() + broken : people.map((v) => v.id).join());
    if (key === hudKey) return; // sin cambios no se redibuja: reemplazar los botones se comería el clic en curso
    hudKey = key;
    $("hudTabs").replaceChildren(...TABS.map(([id, name]) => {
      const b = el("button", `${id}${id === hudTab ? " on" : ""}`);
      b.type = "button";
      b.append(el("span", "", name), el("em", "", String(count[id])));
      b.onclick = () => { hudTab = id; try { localStorage.setItem("aldea-tab", id); } catch {} hudKey = ""; renderHud(); };
      return b;
    }));
    if (hudTab !== "houses") {
      const rows = people.map((v) => {
        const b = el("button");
        b.type = "button";
        const sw = el("i", `dot ${stateOf(v)}`);
        const l = live.get(v.id);
        const what = stateOf(v) === "working" ? l?.step : stateOf(v) === "needs" ? l?.message : v.chat.lastPrompt;
        const txt = el("span");
        txt.append(el("b", "", nameOf(v)), el("small", "", [v.house.isPlaza ? t("Plaza") : v.house.name, what ? short(what, 40) : ago(v.chat.at)].join(" · ")));
        b.append(sw, txt);
        b.onclick = () => { // ir hasta él y hablarle
          v.inside = false;
          player.x = v.x + 12; player.y = v.y; player.path = null; buddy.trail = [];
          talkTo(v);
          canvas.focus();
        };
        return b;
      });
      const empty = { working: t("Nadie está trabajando ahora."), needs: t("Nadie te está esperando."), free: t("Todos están ocupados.") }[hudTab];
      $("houseList").replaceChildren(...(rows.length ? rows : [el("div", "none", empty)]));
      return;
    }
    const rows = list.map((h) => {
      const b = el("button");
      b.type = "button";
      const sw = el("i");
      sw.style.background = h.isHall ? "#3a78c2" : h.isPlaza ? "#bdb6a7" : h.roof;
      b.append(sw, el("span", "", h.isHall ? `Nimbo · ${h.name}` : h.isPlaza ? t("Plaza (sin casa)") : h.name), el("em", "", String(h.chats.length)));
      b.onclick = () => { player.x = h.front.x * TILE + 8; player.y = (h.front.y + 1) * TILE + 12; player.path = null; buddy.trail = []; canvas.focus(); };
      return b;
    });
    const edit = el("button", "edit", broken ? t("⚠ aldea.json tiene un error (no lo toqué): abrirlo") : t("✎ Editar casas (aldea.json)"));
    edit.type = "button";
    edit.onclick = () => api.editConfig?.();
    $("houseList").replaceChildren(...rows, edit);
  }

  // --- Textos encima del mundo: carteles, globos, nombres ---
  const labels = $("labels");
  const pool = new Map();
  function label(key, cls, text, wx, wy) {
    let e = pool.get(key);
    if (!e) { e = el("div"); labels.append(e); pool.set(key, e); }
    if (e.className !== cls) e.className = cls;
    if (e.textContent !== text) e.textContent = text;
    e.style.left = `${Math.round((wx - cam.x) * SCALE)}px`;
    e.style.top = `${Math.round((wy - cam.y) * SCALE)}px`;
    e.dataset.used = "1";
  }
  function drawLabels(now) {
    for (const e of pool.values()) e.dataset.used = "";
    const hallVs = villagers.filter((v) => v.house === hallHouse);
    const hallCls = hallVs.some((v) => stateOf(v) === "needs") ? " needs" : hallVs.some((v) => stateOf(v) === "working") ? " busy" : "";
    label("hall", "sign-label home" + hallCls, hallHouse ? `Nimbo · ${short(hallHouse.name, 18)}` : "Nimbo", (HALL.x + HALL.w / 2) * TILE, HALL.y * TILE - 2);
    for (const h of houses) {
      const vs = villagers.filter((v) => v.house === h);
      const cls = vs.some((v) => stateOf(v) === "needs") ? " needs" : vs.some((v) => stateOf(v) === "working") ? " busy" : "";
      label("h" + h.id, "sign-label" + cls, short(h.name, 22), (h.x + HW / 2) * TILE, h.y * TILE - 6);
    }
    labels.style.setProperty("--s", SCALE);
    for (const v of villagers) {
      if (v.inside) continue;
      const st = stateOf(v);
      // Una luz que late debajo de quien trabaja (azul) o te espera (amarilla): del mismo tamaño en pantalla, se ve aun con la aldea lejos.
      if (st === "working" || st === "needs") label("l" + v.id, `beacon ${st}${(hudTab === "working" || hudTab === "needs") && hudTab !== st ? " dim" : ""}`, "", v.x, v.y - 7);
      if (v.bubble) label("b" + v.id, `bubble ${v.bubble.kind}`, v.bubble.text, v.x, v.y - 20 - v.jump);
      if (hover === v) label("n" + v.id, "name-tag", nameOf(v), v.x, v.y + 3);
    }
    if (hover === "player") label("np", "name-tag", NAME || t("Tú"), player.x, player.y + 3);
    for (const [k, e] of pool) if (!e.dataset.used) { e.remove(); pool.delete(k); }
  }

  // --- Cada cuadro ---
  const smoke = [];
  let last = performance.now(), lastDraw = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || !staticLayer || now - lastDraw < 1000 / 30 - 2) return; // 30 cuadros por segundo; nada si la ventana no se ve
    lastDraw = now;
    const dt = Math.min((now - last) / 1000, .1);
    last = now;
    updatePlayer(dt);
    for (const v of villagers) updateVillager(v, dt, now);
    maybeTalk(dt, now);
    updateCamera(dt);
    const cx = Math.round(cam.x), cy = Math.round(cam.y);
    ctx.clearRect(0, 0, VW, VH);
    ctx.drawImage(staticLayer, cx, cy, VW, VH, 0, 0, VW, VH);
    ctx.save();
    ctx.translate(-cx, -cy);
    // Humo de las chimeneas de las casas donde alguien trabaja
    for (const h of houses) if (villagers.some((v) => v.house === h && stateOf(v) === "working") && Math.random() < dt * 3) smoke.push({ x: h.chimney.x + Math.random() * 3, y: h.chimney.y, life: 1 });
    for (const s of smoke) { s.y -= dt * 9; s.x += Math.sin(s.y * .2) * .2; s.life -= dt * .45; }
    while (smoke.length && smoke[0].life <= 0) smoke.shift();
    for (const s of smoke) { ctx.globalAlpha = Math.max(0, s.life) * .7; ellipse(ctx, s.x, s.y, 2 + (1 - s.life) * 3, 2 + (1 - s.life) * 3, "#e8e8e8"); }
    ctx.globalAlpha = 1;
    // Agua de la fuente
    for (let k = 0; k < 3; k++) { const a = now / 300 + k * 2.1; R(ctx, FOUNTAIN.x + Math.cos(a) * 4, FOUNTAIN.y - 10 + Math.abs(Math.sin(a)) * 8, 1, 2, "#bfe4fb"); }
    // Personajes, de atrás hacia adelante
    const people = [...villagers.filter((v) => !v.inside).map((v) => ({ y: v.y, draw: () => person(ctx, v.x, v.y, v.pal, v.dir, v.walk, { tool: v.tool, jump: v.jump }) })),
      { y: player.y, draw: () => person(ctx, player.x, player.y, player.pal, player.dir, player.walk, { cap: "#d63a3a" }) },
      { y: buddy.y + 6, draw: () => cloud(ctx, buddy.x, buddy.y - 14 + Math.sin(now / 400) * 1.5) }];
    people.sort((a, b) => a.y - b.y).forEach((p) => p.draw());
    // Luz del día: tarde naranja, noche azul con ventanas encendidas
    const hr = new Date().getHours() + new Date().getMinutes() / 60;
    const tint = hr >= 21 || hr < 5.5 ? "rgba(18,26,70,.5)" : hr >= 19 ? "rgba(70,40,110,.3)" : hr >= 17 ? "rgba(255,140,60,.14)" : hr < 7 ? "rgba(255,170,120,.16)" : "";
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(cx, cy, VW, VH);
      if (hr >= 19 || hr < 6) {
        ctx.globalCompositeOperation = "lighter";
        // Un halo que se desvanece (no un disco plano): degradado radial centrado en la luz
        const glow = (x, y, rad, a) => { const gr = ctx.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(255,190,90,${a})`); gr.addColorStop(1, "rgba(255,190,90,0)"); ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
        const lit = (w) => { R(ctx, w.x, w.y, w.w, w.h, "rgba(255,200,90,.55)"); glow(w.x + w.w / 2, w.y + w.h / 2, w.w * 1.1, .22); };
        for (const h of houses) if (villagers.some((v) => v.house === h && (v.inside || stateOf(v) === "working"))) h.windows?.forEach(lit);
        HALL.windows?.forEach(lit); // la casa de Nimbo siempre tiene luz
        for (const d of deco) glow(d.x * TILE + 8, d.y * TILE - 8, 22, .3);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    // Zzz de las casas donde duermen
    for (const h of houses) if (villagers.some((v) => v.house === h && v.inside)) { const z = (now / 1500) % 1; ctx.globalAlpha = 1 - z; ctx.fillStyle = "#fff"; ctx.font = "bold 8px monospace"; ctx.fillText("z", h.chimney.x + 6 + z * 6, h.chimney.y - z * 10); ctx.globalAlpha = 1; }
    ctx.restore();
    drawLabels(now);
    if (now - hudAt > 2000) { hudAt = now; renderHud(); $("clock").textContent = new Date().toLocaleTimeString(LANG === "en" ? "en-US" : "es-CO", { hour: "numeric", minute: "2-digit" }); }
  }
  let hudAt = 0;

  // --- Datos: casas y chats (al abrir y cada minuto) y eventos de Claude Code en vivo ---
  let loading = null;
  let broken = false; // aldea.json está mal escrito: se avisa y no se toca
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const d = await api.data().catch(() => null);
      if (!d) return;
      NAME = d.name || "";
      broken = !!d.broken;
      const first = !staticLayer;
      for (const ev of d.events ?? []) applyHook(ev); // lo que pasó mientras la aldea estaba cerrada
      buildMap(d.houses ?? [], d.plaza ?? []);
      makeVillagers();
      if (first) { player.x = (HALL.x + 3) * TILE + 8; player.y = (HALL.y + HALL.h + 1) * TILE + 12; cam.x = player.x - VW / 2; cam.y = player.y - VH / 2; }
      $("empty").classList.toggle("hidden", homes().some((h) => h.chats.length));
      $("empty").textContent = t("Todavía no hay vecinos: abre un chat de Claude Code en una carpeta y aparecerá su casa aquí.");
      renderHud();
    })().finally(() => { loading = null; });
    return loading;
  }
  let refreshTimer = 0;
  const TOOLS = { Bash: t("ejecutando"), PowerShell: t("ejecutando"), Read: t("leyendo"), Write: t("escribiendo"), Edit: t("editando"), MultiEdit: t("editando"), Glob: t("buscando"), Grep: t("buscando"), WebSearch: t("buscando en la web"), WebFetch: t("leyendo una página"), Agent: t("con un ayudante"), Task: t("con un ayudante") };
  // "Claude está esperando tu mensaje" (el aviso que llega un minuto después de terminar) no es pedirte algo: ese chat queda libre.
  const IDLE_NOTE = /waiting for your input|esperando tu/i;
  function applyHook(h) {
    if (!h.session) return;
    const prev = live.get(h.session) ?? {};
    const at = h.at ?? Date.now();
    if (prev.at > at) return;
    const step = h.event === "PreToolUse" ? `${TOOLS[h.tool] ?? h.tool}${h.detail ? " " + short(h.detail, 34) : ""}` : h.event === "UserPromptSubmit" ? t("pensando en «{0}»", short(h.prompt, 34)) : prev.step;
    const idleNote = h.event === "Notification" && (h.kind === "idle_prompt" || IDLE_NOTE.test(h.message ?? ""));
    const state = idleNote ? "idle" : { UserPromptSubmit: "thinking", PreToolUse: "working", PostToolUse: "working", PostToolUseFailure: "working", Notification: "needs", Stop: "finished", StopFailure: "error", SessionEnd: "idle", SessionStart: "idle" }[h.event] ?? prev.state;
    live.set(h.session, { ...prev, state, step, at, ctx: h.context ?? prev.ctx, message: h.event === "Notification" ? h.message : prev.message, shown: prev.shown });
  }
  api.onHook((h) => {
    applyHook(h);
    if (h.session && !villagers.some((v) => v.id === h.session)) { clearTimeout(refreshTimer); refreshTimer = setTimeout(load, 2500); } // un chat nuevo: llega a la aldea
  });
  load();
  setInterval(load, 60_000);
  requestAnimationFrame(frame);
  canvas.tabIndex = 0;
  canvas.focus();
  window.__aldea = { live, villagers: () => villagers, houses: () => houses, player, talkTo, openHouse, hallTalk }; // para probar desde la consola
})();

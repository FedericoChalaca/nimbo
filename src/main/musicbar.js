// Barra flotante de música: una ventana pequeña e INDEPENDIENTE de la isla que aparece mientras Spotify tiene
// algo cargado y se puede mover a donde quieras. Muestra carátula, canción y artista, y deja pausar, cambiar de
// canción y buscar. Los datos y las órdenes son los mismos de la tarjeta de Spotify de la isla (media.js).
//
// Reglas: solo se ve si la función está activa, no estás en modo mini (jugando), Spotify tiene algo cargado y no
// la cerraste con la ✕ (vuelve sola con la siguiente canción). Pausada se queda, para poder reanudar.
// Su puente (player-preload.js) solo permite música, buscar y su propio tamaño: nada más de Nimbo.
const WIN_W = 392; // la tarjeta mide 380 y deja 6 px de margen a cada lado para su sombra
const H_MIN = 72;
const H_MAX = 400;

/** La posición más cercana en la que la ventana queda ENTERA dentro de la pantalla con la que más se cruza. */
function fitInto(b, areas) {
  let best = areas[0];
  let bestOverlap = -1;
  for (const a of areas) {
    const w = Math.max(0, Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x));
    const h = Math.max(0, Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y));
    if (w * h > bestOverlap) { best = a; bestOverlap = w * h; }
  }
  return {
    x: Math.round(Math.min(Math.max(b.x, best.x), best.x + best.width - b.width)),
    y: Math.round(Math.min(Math.max(b.y, best.y), best.y + best.height - b.height)),
  };
}
const trackKey = (m) => (m ? `${m.title}|${m.artist}` : "");
const shouldShow = ({ enabled, mini, media, dismissed }) => !!(enabled && !mini && media && !dismissed);
const clampHeight = (h) => Math.min(H_MAX, Math.max(H_MIN, Math.round(Number(h)) || H_MIN));

/**
 * @param page      () => dirección de la página de la barra (cambia con el idioma)
 * @param preload   ruta de player-preload.js
 * @param getPos    () => { x, y } guardada o null
 * @param setPos    ({ x, y }) => la guarda (al soltar la barra tras moverla)
 * @param enabled   () => ¿está activa la función?
 * @param mini      () => ¿modo mini?
 */
function createMusicBar({ page, preload, getPos, setPos, enabled, mini }) {
  const { app, BrowserWindow, screen, ipcMain } = require("electron"); // aquí y no arriba: así la autoprueba corre sin Electron
  let win = null;
  let media = null;
  let dismissed = false;
  let lastKey = "";
  let baseY = 0; // dónde está la barra cuando está compacta (crece hacia abajo, o hacia arriba si no cabe)

  function create() {
    const area = screen.getPrimaryDisplay().workArea;
    const saved = getPos();
    const start = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved
      : { x: area.x + area.width - WIN_W - 16, y: area.y + area.height - H_MIN - 16 };
    const at = fitInto({ ...start, width: WIN_W, height: H_MIN }, screen.getAllDisplays().map((d) => d.workArea));
    baseY = at.y;
    win = new BrowserWindow({
      width: WIN_W, height: H_MIN, x: at.x, y: at.y, show: false, frame: false, transparent: true, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, "floating");
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("did-finish-load", () => win?.webContents.send("media", media));
    // "moved" llega una vez, al soltar la barra después de arrastrarla.
    win.on("moved", () => { const [x, y] = win.getPosition(); baseY = y; setPos({ x, y }); });
    win.on("closed", () => { win = null; });
    win.loadURL(page());
  }

  function sync() {
    if (!app.isReady()) return; // el vigilante de música arranca antes que la app: main.js llama a sync() al estar lista
    const show = shouldShow({ enabled: enabled(), mini: mini(), media, dismissed });
    if (show && !win) create();
    if (!win) return;
    if (show && !win.isVisible()) win.showInactive(); // sin robarle el foco a lo que estés haciendo
    else if (!show && win.isVisible()) win.hide();
  }

  ipcMain.on("bar-size", (e, h) => {
    if (!win || e.sender !== win.webContents) return;
    const height = clampHeight(h);
    const b = win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    win.setBounds({ x: b.x, y: Math.min(baseY, area.y + area.height - height), width: WIN_W, height });
  });
  ipcMain.on("bar-close", (e) => { if (win && e.sender === win.webContents) { dismissed = true; sync(); } });

  return {
    /** Llegó lo que suena (o null: Spotify cerrado o sin nada cargado). Una canción nueva vuelve a mostrar la barra. */
    update(m) {
      media = m;
      const key = trackKey(m);
      if (key !== lastKey) { dismissed = false; lastKey = key; }
      win?.webContents.send("media", m);
      sync();
    },
    sync,
    /** Desde el menú: volver a mostrarla aunque la hayas cerrado. */
    reset() { dismissed = false; sync(); },
    reload() { win?.loadURL(page()); }, // cambió el idioma
    destroy() { win?.destroy(); win = null; },
  };
}

module.exports = { createMusicBar, fitInto, shouldShow, trackKey, clampHeight, WIN_W, H_MIN, H_MAX };

// Autoprueba (sin Electron): `node src/main/musicbar.js`
if (require.main === module) {
  const assert = require("assert");
  const one = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  const b = { width: 392, height: 72 };
  assert.deepStrictEqual(fitInto({ ...b, x: 100, y: 200 }, one), { x: 100, y: 200 }); // ya cabe: no se mueve
  assert.deepStrictEqual(fitInto({ ...b, x: 1800, y: 1000 }, one), { x: 1528, y: 968 }); // se salía por la derecha y abajo
  assert.deepStrictEqual(fitInto({ ...b, x: -500, y: -40 }, one), { x: 0, y: 0 });
  // Dos pantallas (la segunda a la izquierda, con coordenadas negativas): se queda en la que más se cruza.
  const two = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: 0, width: 1280, height: 984 }];
  assert.deepStrictEqual(fitInto({ ...b, x: -1000, y: 300 }, two), { x: -1000, y: 300 });
  assert.deepStrictEqual(fitInto({ ...b, x: -100, y: 300 }, two), { x: 0, y: 300 }); // a caballo (100 px en una, 292 en otra): se pega a la que más cubre
  // Una pantalla que se desconectó: la barra guardada allí vuelve a la que queda.
  assert.deepStrictEqual(fitInto({ ...b, x: -1000, y: 300 }, one), { x: 0, y: 300 });
  const m = { title: "a", artist: "b", playing: true };
  const base = { enabled: true, mini: false, media: m, dismissed: false };
  assert.ok(shouldShow(base));
  assert.ok(!shouldShow({ ...base, enabled: false }) && !shouldShow({ ...base, mini: true }) && !shouldShow({ ...base, media: null }) && !shouldShow({ ...base, dismissed: true }));
  assert.ok(shouldShow({ ...base, media: { ...m, playing: false } })); // en pausa se queda
  assert.strictEqual(trackKey(null), "");
  assert.notStrictEqual(trackKey(m), trackKey({ ...m, title: "c" }));
  assert.deepStrictEqual([clampHeight(10), clampHeight(200.4), clampHeight(9999), clampHeight("x"), clampHeight(undefined)], [H_MIN, 200, H_MAX, H_MIN, H_MIN]);
  console.log("musicbar.js ok");
}

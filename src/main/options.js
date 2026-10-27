// Ventana de opciones: una ventana aparte (no el menú chiquito) con cada ajuste explicado, por secciones, y las conexiones con su
// guía paso a paso. Los ajustes salen de la MISMA plantilla del menú de clic derecho (menuTemplate en main.js): la ventana solo
// pide "la lista" y "haz clic en tal id"; lo que hace cada opción vive en un solo lugar.
// Su puente (options-preload.js) solo expone eso y el panel de conexiones (setup / setup-do), que ya validan todo en main.

/** La plantilla del menú → datos que la página puede pintar (sin funciones). Las entradas sin id y los separadores no van. */
function serialize(template) {
  const item = (it) => ({
    id: it.id ?? "", label: String(it.label ?? ""), type: it.type ?? "normal", checked: it.checked === true,
    enabled: it.enabled !== false, visible: it.visible !== false,
    sub: Array.isArray(it.submenu) ? it.submenu.filter((x) => x.type !== "separator").map((x, i) => ({ ...item(x), i })) : null,
  });
  return template.filter((it) => it.id && it.type !== "separator").map(item);
}

/** Ejecuta el clic de una entrada (o de una opción de su submenú). Devuelve false si no existe o no se puede tocar. */
function clickItem(template, id, sub) {
  const top = template.find((it) => it.id === id);
  if (!top || top.enabled === false || top.visible === false) return false;
  let it = top;
  if (Number.isInteger(sub)) {
    it = (top.submenu ?? []).filter((x) => x.type !== "separator")[sub];
    if (!it || it.enabled === false) return false;
  }
  if (typeof it.click !== "function") return false;
  // El menú real le pasa al clic la entrada ya cambiada: una casilla llega con su valor NUEVO.
  it.click({ ...it, checked: it.type === "checkbox" ? !it.checked : true });
  return true;
}

function createOptions({ template, page, preload, icon, skip = [] }) {
  const { BrowserWindow, ipcMain } = require("electron"); // aquí: la autoprueba corre sin Electron
  let win = null;
  // Los botones de la barra propia. Solo para ESTA ventana.
  ipcMain.on("opt-win", (e, what) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (what === "min") win.minimize();
    else if (what === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (what === "close") win.close();
  });
  ipcMain.handle("opt-model", () => serialize(template()).filter((x) => !skip.includes(x.id)));
  ipcMain.handle("opt-click", (_e, id, sub) => {
    if (typeof id !== "string" || skip.includes(id)) return false;
    return clickItem(template(), id, Number.isInteger(sub) ? sub : undefined);
  });
  return {
    open() {
      if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
      win = new BrowserWindow({
        width: 880, height: 640, minWidth: 720, minHeight: 480, show: false, title: "Nimbo", backgroundColor: "#0b0c0e",
        autoHideMenuBar: true, icon, frame: false, // sin el marco de Windows: la página dibuja su propia barra (arrastrar, minimizar, cerrar)
        webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      win.setMenu(null);
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.once("ready-to-show", () => win.show());
      win.on("closed", () => { win = null; });
      win.loadURL(page());
    },
    /** Avisa a la ventana (si está abierta) que algo cambió: vuelve a pedir la lista. */
    refresh() { if (win && !win.isDestroyed()) win.webContents.send("opt-changed"); },
  };
}

module.exports = { createOptions, serialize, clickItem };

// Autoprueba: `node src/main/options.js`
if (require.main === module) {
  const assert = require("assert");
  const log = [];
  const tpl = () => [
    { id: "a", label: "Casilla", type: "checkbox", checked: false, click: (it) => log.push(["a", it.checked]) },
    { type: "separator" },
    { label: "sin id", click: () => log.push("no") },
    { id: "b", label: "Radio", submenu: [{ label: "x", type: "radio", checked: true, click: () => log.push("bx") }, { type: "separator" }, { label: "y", type: "radio", click: () => log.push("by") }] },
    { id: "c", label: "Apagada", enabled: false, click: () => log.push("c") },
  ];
  const m = serialize(tpl());
  assert.deepStrictEqual(m.map((x) => x.id), ["a", "b", "c"]);
  assert.deepStrictEqual(m[1].sub.map((x) => [x.label, x.checked, x.i]), [["x", true, 0], ["y", false, 1]]);
  assert.ok(!JSON.stringify(m).includes("function"));
  assert.ok(clickItem(tpl(), "a"));
  assert.ok(clickItem(tpl(), "b", 1));
  assert.ok(!clickItem(tpl(), "c")); // apagada: no
  assert.ok(!clickItem(tpl(), "zz") && !clickItem(tpl(), "b", 7));
  assert.deepStrictEqual(log, [["a", true], "by"]);
  console.log("options.js ok");
}

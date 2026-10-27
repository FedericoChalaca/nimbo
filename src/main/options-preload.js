// Puente de la ventana de opciones: la lista de ajustes, tocar uno, y el panel de conexiones. Nada más de Nimbo.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opt", {
  model: () => ipcRenderer.invoke("opt-model"),
  click: (id, sub) => ipcRenderer.invoke("opt-click", String(id), Number.isInteger(sub) ? sub : null),
  onChanged: (fn) => ipcRenderer.on("opt-changed", () => fn()),
  setup: () => ipcRenderer.invoke("setup"),
  setupDo: (action, value) => ipcRenderer.invoke("setup-do", String(action), value),
  version: () => ipcRenderer.invoke("app-version"),
  copy: (text) => ipcRenderer.send("opt-copy", String(text).slice(0, 20_000)), // copiar al portapapeles (las instrucciones para tu IA)
  win: (what) => ipcRenderer.send("opt-win", String(what)), // "min" | "max" | "close"
});

// Puente de la aldea: SOLO lo que necesita (sus datos, las fotos de una casa, abrir su carpeta o su GitHub y los eventos de los chats).
// La página nunca manda rutas: solo el id de una casa y el número de una foto (village.js valida todo).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aldea", {
  data: () => ipcRenderer.invoke("village-data"),
  photos: (house) => ipcRenderer.invoke("village-photos", String(house)),
  photo: (house, i) => ipcRenderer.invoke("village-photo", String(house), Number(i)),
  open: (house, what) => ipcRenderer.send("village-open", String(house), what === "github" ? "github" : "folder"),
  onHook: (fn) => ipcRenderer.on("village-hook", (_e, h) => fn(h)),
});

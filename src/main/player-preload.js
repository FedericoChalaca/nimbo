// Puente de la barra de música: SOLO lo que necesita (música, buscar y su tamaño). Nada del resto de Nimbo.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bar", {
  media: () => ipcRenderer.invoke("media"),
  onMedia: (fn) => ipcRenderer.on("media", (_e, m) => fn(m)),
  mediaDo: (order) => ipcRenderer.send("media-do", order), // "toggle" | "next" | "prev" (main valida)
  search: (query) => ipcRenderer.invoke("spotify-search", query),
  play: (uri) => ipcRenderer.invoke("spotify-play", uri),
  size: (height) => ipcRenderer.send("bar-size", height),
  close: () => ipcRenderer.send("bar-close"),
});

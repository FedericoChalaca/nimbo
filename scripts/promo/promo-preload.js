// API falsa para el video: guarda los manejadores que registra index.html (window.__cb) para
// que el guion los dispare, y responde con datos de mentira. Nada sale de esta ventana.
window.__cb = {};
const on = (name) => (fn) => { window.__cb[name] = fn; };
const later = (ms, value) => new Promise((r) => setTimeout(() => r(typeof value === "function" ? value() : value), ms));
const soon = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// Trello (formato actual): la lista de tableros y, de uno, sus tarjetas ya cargadas.
const BOARD = 'https://trello.com/b/AbCdEfGh/web-shop';
window.__trello = {
  at: new Date().toISOString(),
  boards: [{ name: 'Web Shop', url: BOARD }, { name: 'Brand', url: 'https://trello.com/b/IjKlMnOp/brand' }],
  byBoard: { [BOARD]: { at: new Date().toISOString(), cards: [
    { name: 'Dark mode at checkout', list: 'In progress', due: soon(5), url: '', done: false },
    { name: 'Payment retries', list: 'In progress', due: '', url: '', done: false },
    { name: 'Staging gateway', list: 'Blocked', due: '', url: '', done: false },
    { name: 'Seasonal banner', list: 'Review', due: soon(30), url: '', done: false },
    { name: 'New logo', list: 'Done', due: '', url: '', done: true }] } },
};

const api = {
  onHook: on("hook"), onCursor: on("cursor"), onMuted: on("muted"),
  onPermission: on("permission"), onPermissionDone: on("permissionDone"), decide() {},
  onMini: on("mini"), toggleMini() {}, chatOpen() {},
  ask: () => later(1900, () => window.__askReply ?? { text: "Listo.", dispatch: [], added: [] }),
  dispatch: () => later(3000, { text: "Agregué 3 reintentos con espera exponencial y una prueba; todo pasa.", project: "api-pagos" }),
  onTheme: on("theme"), onGithub: on("github"), openGithub() {}, openUrl() {},
  onName: on("name"), onAnchor: on("anchor"), dragStart() {}, dragEnd() {}, onDragAbort: on("dragAbort"),
  onWhatsapp: on("whatsapp"), openWhatsapp() {},
  trello: () => Promise.resolve(window.__trello), onTrello: on("trello"), onTrelloBusy: on("trelloBusy"), trelloRefresh() {}, trelloBoard() {},
  media: () => Promise.resolve(null), mail: () => Promise.resolve(null), aiProviders: () => Promise.resolve(null),
  reminders: () => Promise.resolve([]), onReminders: on("reminders"), onReminder: on("reminder"), reminderDone() {}, reminderSnooze() {},
  filePath: () => "", hitRects() {}, onHover: on("hover"), menu() {},
};
// Lo que index.html agregue después no rompe el video: un onAlgo desconocido se guarda en
// __cb.algo y cualquier otra llamada devuelve una promesa vacía.
window.nimbo = new Proxy(api, {
  get: (t, k) => (k in t ? t[k] : /^on[A-Z]/.test(k) ? on(k[2].toLowerCase() + k.slice(3)) : () => Promise.resolve(null)),
});

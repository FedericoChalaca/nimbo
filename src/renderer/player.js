// Barra flotante de música: lo que suena, sus botones y la búsqueda. Solo usa `window.bar` (player-preload.js).
const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";
const t = translator(LANG);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const ICON = { play: "M8 5v14l11-7z", pause: "M6 5h4v14H6zM14 5h4v14h-4z" };
let media = null;

$("prev").title = t("Anterior");
$("next").title = t("Siguiente");
$("find").title = t("Buscar");
$("close").title = t("Cerrar");
$("q").placeholder = t("Buscar canción…");

function render() {
  document.body.classList.toggle("playing", !!media?.playing);
  $("title").textContent = media?.title ?? "";
  $("artist").textContent = media?.artist ?? "";
  $("title").title = media ? `${media.title} · ${media.artist}` : "";
  // La carátula solo puede ser un data: de imagen (lo valida media.js); la CSP no deja cargar nada de fuera.
  if (media?.art) $("art").src = media.art; else $("art").removeAttribute("src");
  $("play").title = media?.playing ? t("Pausar") : t("Reproducir");
  $("playIcon").setAttribute("d", media?.playing ? ICON.pause : ICON.play);
  fit();
}
// La ventana mide lo que mide la tarjeta (crece al abrir la búsqueda).
function fit() { bar.size(Math.ceil($("card").getBoundingClientRect().height) + 12); }
new ResizeObserver(fit).observe($("card"));

bar.onMedia((m) => { media = m; render(); });
bar.media().then((m) => { media = m; render(); });

$("prev").onclick = () => bar.mediaDo("prev");
$("next").onclick = () => bar.mediaDo("next");
$("play").onclick = () => {
  bar.mediaDo("toggle");
  if (media) { media = { ...media, playing: !media.playing }; render(); } // responde ya; Windows confirma en ~1 s
};
$("close").onclick = () => bar.close();

// --- Búsqueda: con Premium es instantánea y la canción suena; sin Premium se abre su página en Spotify. ---
function openSearch(on) {
  $("search").hidden = !on;
  $("find").classList.toggle("on", on);
  if (on) { $("q").focus(); $("q").select(); } else $("results").replaceChildren();
}
$("find").onclick = () => openSearch($("search").hidden);
$("q").onkeydown = async (e) => {
  if (e.key === "Escape") return openSearch(false);
  if (e.key !== "Enter") return;
  const q = $("q").value.trim();
  if (!q) return;
  $("results").replaceChildren(el("div", "note", t("Buscando…")));
  const r = await bar.search(q).catch(() => null);
  if (!r || r.error) return $("results").replaceChildren(el("div", "note", t("No pude buscar en Spotify.")));
  if (r.connected === false) return $("results").replaceChildren(el("div", "note", t("Activa el conector de Spotify en claude.ai y vuelve a intentar.")));
  if (!r.tracks.length) return $("results").replaceChildren(el("div", "note", t("Sin resultados")));
  const rows = r.tracks.map((s) => {
    const row = el("div", "row");
    row.title = `${s.title} · ${s.artist}`;
    row.append(el("b", "", s.title), el("i", "", s.artist));
    row.onclick = async () => { await bar.play(s.uri).catch(() => null); openSearch(false); };
    return row;
  });
  $("results").replaceChildren(...rows, ...(r.plays ? [] : [el("div", "note", t("Se abrirá en Spotify."))]));
};
render();

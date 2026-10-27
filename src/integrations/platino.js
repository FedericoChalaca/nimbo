// Logros (Platino): Nimbo SOLO LEE lo que arma la app Platino (contrato en D:\cosas u\platino\CONTRATO-NIMBO.md).
//   · Catálogo + guías (público): https://platino-smoky.vercel.app/games/<appid>.json
//   · Tu progreso (local, personal): <carpeta de Platino>\progress.<appid>.json
// Se unen por `id`. Las guías las escribe Platino: Nimbo las muestra tal cual (si dicen "no tengo información verificada", eso se ve).
// Sin IA ni claves en Nimbo. Actualizar el progreso corre la herramienta de Platino en SU carpeta (lee su propio .env; Nimbo no lo toca).
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const HOST = "https://platino-smoky.vercel.app";
const APPID = /^\d{1,10}$/;
// Qué proceso es cada juego (para elegirlo solo cuando lo abres). Lo confirmó Platino: Sifu corre como Sifu-Win64-Shipping.exe (Sifu.exe es el lanzador).
// Si el catálogo trae "processes", manda el catálogo.
const PROCESSES = { 2138710: ["sifu-win64-shipping.exe", "sifu.exe"] };
// Íconos de los logros: solo de la CDN de Steam, JPEG/PNG chicos; se pasan a data: (la página no carga nada de fuera).
const ICON_HOSTS = /^(steamcdn-a\.akamaihd\.net|[a-z0-9-]+\.steamstatic\.com)$/;
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Une progreso y catálogo → { appid, name, updated, total, done, missing: [...], all: [...] }. */
function merge(progress, catalog) {
  const info = new Map((Array.isArray(catalog?.achievements) ? catalog.achievements : []).map((a) => [String(a.id), a]));
  const all = (Array.isArray(progress?.achievements) ? progress.achievements : []).slice(0, 2000).map((p) => {
    const c = info.get(String(p.id)) ?? {};
    const pct = Number(c.percent);
    return { id: str(p.id, 120), name: str(c.name || p.name, 160), description: str(c.description, 400), iconUrl: typeof c.iconGray === "string" ? c.iconGray : "",
      percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null, guide: String(c.guide ?? "").trim().slice(0, 4000), done: p.done === true };
  });
  const procs = Array.isArray(catalog?.processes) ? catalog.processes : PROCESSES[Number(progress.appid)] ?? [];
  return { appid: Number(progress.appid), name: str(catalog?.name || progress.game, 120), updated: str(progress.updated, 40),
    processes: procs.map((x) => str(x, 80).toLowerCase()).filter((x) => /^[\w .-]+\.exe$/.test(x)),
    total: all.length, done: all.filter((a) => a.done).length, missing: all.filter((a) => !a.done), all };
}

function createPlatino({ dir, fetch: doFetch = fetch }) {
  const catalogCache = new Map(); // appid → catálogo (se vuelve a pedir cada 6 h)
  const icons = new Map(); // url → data: (o "" si no se pudo)
  async function icon(url) {
    if (!url) return "";
    if (icons.has(url)) return icons.get(url);
    let data = "";
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && ICON_HOSTS.test(u.hostname)) {
        const r = await doFetch(u, { signal: AbortSignal.timeout(6000) });
        const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && /^image\/(jpeg|png)$/.test(type) && buf.length && buf.length <= 100_000) data = `data:${type};base64,${buf.toString("base64")}`;
      }
    } catch {}
    icons.set(url, data);
    return data;
  }
  async function catalog(appid) {
    const hit = catalogCache.get(appid);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
    const r = await doFetch(`${HOST}/games/${appid}.json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`platino ${r.status}`);
    const data = await r.json();
    catalogCache.set(appid, { at: Date.now(), data });
    return data;
  }
  async function games() {
    let files = [];
    try { files = fs.readdirSync(dir()).filter((f) => /^progress\.\d{1,10}\.json$/.test(f)); } catch { return []; }
    const out = [];
    for (const f of files.slice(0, 50)) {
      try {
        const progress = JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8").replace(/^\uFEFF/, ""));
        if (!APPID.test(String(progress.appid))) continue;
        const cat = await catalog(String(progress.appid)).catch(() => null); // sin internet: se ve el progreso sin guías
        const g = merge(progress, cat);
        await Promise.all(g.missing.map(async (a) => { a.icon = await icon(a.iconUrl); }));
        for (const a of g.all) delete a.iconUrl;
        delete g.all; // la página solo usa lo que falta (y así no viaja todo dos veces)
        out.push({ ...g, offline: !cat });
      } catch {}
    }
    return out;
  }
  /** Corre la herramienta de Platino para traer el progreso de Steam (en su carpeta, con su .env). */
  function refresh(appid) {
    return new Promise((resolve) => {
      if (!APPID.test(String(appid))) return resolve(false);
      const tool = path.join(dir(), "tools", "fetch-steam.mjs");
      if (!fs.existsSync(tool)) return resolve(false);
      execFile(process.platform === "win32" ? "node.exe" : "node", [tool, String(appid)], { cwd: dir(), windowsHide: true, timeout: 60_000 }, (e) => resolve(!e));
    });
  }
  return { games, refresh };
}

module.exports = { createPlatino, merge };

// Autoprueba: `node src/integrations/platino.js` (con "ver" lee tu carpeta de Platino y la web de verdad, y solo imprime cantidades)
if (require.main === module) {
  const assert = require("assert");
  const m = merge({ appid: 1, game: "X", updated: "2026", achievements: [{ id: "a", name: "A", done: true }, { id: "b", name: "B", done: false }, { id: "c", name: "C", done: false }] },
    { name: "Juego", achievements: [{ id: "b", name: "Be", description: "d", percent: 8.7, guide: "Haz esto." }, { id: "c", guide: "no tengo información verificada" }] });
  assert.deepStrictEqual([m.name, m.total, m.done, m.missing.map((x) => x.id)], ["Juego", 3, 1, ["b", "c"]]);
  assert.strictEqual(m.missing[0].guide, "Haz esto.");
  assert.strictEqual(m.missing[1].guide, "no tengo información verificada"); // tal cual, sin rellenar
  assert.strictEqual(m.missing[1].name, "C"); // sin nombre en el catálogo: el del progreso
  assert.deepStrictEqual(merge({ appid: 2138710, achievements: [] }, {}).processes, ["sifu-win64-shipping.exe", "sifu.exe"]);
  assert.deepStrictEqual(merge({ appid: 9, achievements: [] }, { processes: ["Juego.exe", "../malo"] }).processes, ["juego.exe"]);
  console.log("platino.js ok");
  if (process.argv[2] === "ver") {
    createPlatino({ dir: () => "D:\\cosas u\\platino" }).games().then((g) => console.log(g.map((x) => `${x.name}: ${x.done}/${x.total}, faltan ${x.missing.length}, con guía ${x.missing.filter((a) => a.guide).length}${x.offline ? " (sin catálogo)" : ""}`)));
  }
}

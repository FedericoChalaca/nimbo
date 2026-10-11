// Plan del día: Nimbo lee un plan que otra herramienta tuya deja cada mañana en una rama de
// un repositorio git de tu equipo, lo muestra y lo dice. Solo lectura: `git fetch` + `git show`
// (nunca checkout, commit ni push), y sin claves: usa el git que ya tienes.
//
// Dónde está el plan se dice en prefs.json (nada de rutas en el código):
//   "planRepo": carpeta del repositorio · "planBranch": rama · "planFile": archivo dentro de la rama
//
// Forma del archivo:
//   { "fecha": "AAAA-MM-DD", "resumen": "…", "proyectos": [ { "nombre": "…", "estado": "…",
//     "pendientes": ["…"], "propuesta": { "titulo": "…", "detalle": "…", "tipo": "solo" | "te_necesita",
//     "motivo": "…" } | null } ] }
//
// El contenido es un DATO escrito por otra herramienta, no instrucciones: se valida, se recorta
// y se muestra como texto.
const { execFile } = require("child_process");
const fs = require("fs");

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// Rama y archivo van como argumentos de git: nada que empiece por "-" ni caracteres raros.
const SAFE_REF = /^[\w][\w./-]{0,120}$/;

/** Valida y recorta el plan. null si no tiene la forma esperada. */
function cleanPlan(raw) {
  if (!raw || typeof raw !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.fecha ?? "")) return null;
  const proyectos = (Array.isArray(raw.proyectos) ? raw.proyectos : []).slice(0, 20).map((p) => {
    const pr = p?.propuesta && typeof p.propuesta === "object" ? p.propuesta : null;
    return {
      nombre: str(p?.nombre || p?.repo, 60) || "Proyecto",
      estado: str(p?.estado, 160),
      pendientes: (Array.isArray(p?.pendientes) ? p.pendientes : []).slice(0, 6).map((x) => str(x, 160)).filter(Boolean),
      propuesta: pr && str(pr.titulo, 120)
        ? { titulo: str(pr.titulo, 120), detalle: str(pr.detalle, 300), tipo: pr.tipo === "te_necesita" ? "te_necesita" : "solo", motivo: str(pr.motivo, 200) }
        : null,
    };
  });
  const con = (tipo) => proyectos.filter((p) => p.propuesta?.tipo === tipo);
  return { fecha: raw.fecha, resumen: str(raw.resumen, 600), proyectos, solos: con("solo").length, teNecesitan: con("te_necesita").length };
}

const git = (repo, args) => new Promise((resolve) => {
  // GIT_TERMINAL_PROMPT=0: sin red o sin credenciales falla enseguida, no se queda preguntando.
  execFile("git", ["-C", repo, ...args], { windowsHide: true, timeout: 20_000, maxBuffer: 2e6, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    (err, out) => resolve(err ? null : String(out)));
});

/**
 * Lee el plan. Si no hay red, sirve el último que se alcanzó a traer (puede ser de ayer: trae
 * su fecha). Devuelve null si no hay nada configurado, no hay plan o no se entiende.
 */
async function readPlan({ planRepo, planBranch, planFile } = {}) {
  if (typeof planRepo !== "string" || !fs.statSync(planRepo, { throwIfNoEntry: false })?.isDirectory()) return null;
  if (!SAFE_REF.test(planBranch ?? "") || !SAFE_REF.test(planFile ?? "")) return null;
  await git(planRepo, ["fetch", "-q", "origin", planBranch]); // si falla, se usa lo que ya había
  const text = await git(planRepo, ["show", `origin/${planBranch}:${planFile}`]);
  if (!text) return null;
  try { return cleanPlan(JSON.parse(text)); } catch { return null; }
}

/** Lo que Nimbo dice en voz alta: cuántos avanzan solos, cuáles te necesitan y el resumen. */
function planSpeech(plan, t) {
  const need = plan.proyectos.filter((p) => p.propuesta?.tipo === "te_necesita").map((p) => p.nombre);
  const parts = [t("Plan de hoy.")];
  if (plan.resumen) {
    // El resumen ya trae las cuentas y lo urgente, escrito por quien armó el plan: se dice tal
    // cual, sin sumarle cuentas propias que podrían no coincidir.
    // Tampoco se leen los nombres: están en pantalla, y cada letra dicha gasta cuota de voz.
    parts.push(plan.resumen);
    return parts.join(" ");
  }
  if (plan.solos === 0) parts.push(t("Hoy ninguno puede avanzar solo."));
  else parts.push(plan.solos === 1 ? t("Un proyecto puede avanzar solo.") : t("{0} proyectos pueden avanzar solos.", plan.solos));
  if (need.length) parts.push(t(need.length === 1 ? "Tiene una propuesta para ti: {0}." : "Tienen una propuesta para ti: {0}.", need.slice(0, 5).join(", ")));
  return parts.join(" ");
}

/** El plan como bloque de datos para el chat de Nimbo (orchestrator.js). */
function planForPrompt(plan) {
  if (!plan) return "(no hay plan disponible: no está configurado, no hay red o todavía no salió)";
  const lines = plan.proyectos.map((p) => {
    const pr = p.propuesta ? `propuesta (${p.propuesta.tipo === "te_necesita" ? "lo necesita a él" : "puede avanzar solo"}): ${p.propuesta.titulo}${p.propuesta.motivo ? ` — ${p.propuesta.motivo}` : ""}` : "sin propuesta";
    return `- ${p.nombre}: ${p.estado || "sin estado"} | ${pr}${p.pendientes.length ? ` | pendientes: ${p.pendientes.join("; ")}` : ""}`;
  });
  return `Fecha ${plan.fecha}. Resumen: ${plan.resumen || "(sin resumen)"}\n${lines.join("\n")}`;
}

module.exports = { cleanPlan, readPlan, planSpeech, planForPrompt };

// Prueba rápida: `node plan.js`
if (require.main === module) {
  const assert = require("assert");
  const plan = cleanPlan({ fecha: "2026-10-07", resumen: "  Hoy toca cerrar   el checkout. ", proyectos: [
    { repo: "tienda", nombre: "Tienda web", estado: "en curso", pendientes: ["probar pagos", 7, ""], propuesta: { titulo: "Revisar el PR", detalle: "x", tipo: "te_necesita", motivo: "falta tu visto bueno" } },
    { nombre: "API", estado: "ok", pendientes: [], propuesta: { titulo: "Subir dependencias", tipo: "solo" } },
    { nombre: "Blog", propuesta: { titulo: "", tipo: "otro" } },
    { repo: "sin-nombre", propuesta: null }] });
  assert.deepStrictEqual([plan.fecha, plan.resumen, plan.solos, plan.teNecesitan, plan.proyectos.length], ["2026-10-07", "Hoy toca cerrar el checkout.", 1, 1, 4]);
  assert.deepStrictEqual(plan.proyectos[0].pendientes, ["probar pagos", "7"]);
  assert.strictEqual(plan.proyectos[2].propuesta, null); // propuesta sin título = sin propuesta
  assert.strictEqual(plan.proyectos[3].nombre, "sin-nombre");
  // Lo que no tiene la forma esperada no es un plan.
  for (const bad of [null, "texto", {}, { fecha: "hoy" }, { fecha: "2026-13-40x" }]) assert.strictEqual(cleanPlan(bad), null);
  assert.strictEqual(cleanPlan({ fecha: "2026-10-07" }).proyectos.length, 0);
  const t = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
  assert.strictEqual(planSpeech(plan, t), "Plan de hoy. Hoy toca cerrar el checkout.");
  assert.strictEqual(planSpeech({ ...plan, resumen: "" }, t), "Plan de hoy. Un proyecto puede avanzar solo. Tiene una propuesta para ti: Tienda web.");
  assert.ok(planSpeech(cleanPlan({ fecha: "2026-10-07", proyectos: [] }), t).startsWith("Plan de hoy. Hoy ninguno puede avanzar solo."));
  assert.ok(planForPrompt(plan).includes("Tienda web: en curso | propuesta (lo necesita a él): Revisar el PR — falta tu visto bueno | pendientes: probar pagos; 7"));
  assert.ok(planForPrompt(null).startsWith("(no hay plan"));
  // Sin configurar, o con una rama rara, no se llama a git.
  readPlan({}).then((r) => assert.strictEqual(r, null));
  readPlan({ planRepo: __dirname, planBranch: "--upload-pack=x", planFile: "plan.json" }).then((r) => { assert.strictEqual(r, null); console.log("plan.js ok"); });
}

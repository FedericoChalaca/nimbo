// Nimbo siente el PC (idea de Coucou, «Mochi y el Mac»: suda con la CPU alta, se sonroja con el calor). Aquí: si la tarjeta de video
// va muy caliente o el procesador muy ocupado dos lecturas seguidas, Nimbo se sonroja y lo dice (una vez cada 10 min mientras dure).
// Cada 15 s: CPU por os.cpus() (diferencia entre dos lecturas; en Windows loadavg no sirve); GPU NVIDIA por nvidia-smi si existe (AMD/Intel:
// sin dato de GPU). Nada sale del PC y no se guarda nada. Dueño, 2026-11-01: la GTX 1650 iba a 94 °C con un juego y no se había dado cuenta.
const os = require("os");
const { execFile } = require("child_process");

const GPU_HOT = 88; // °C (las portátiles NVIDIA bajan la velocidad hacia los 87–93)
const CPU_HOT = 92; // %
const REPEAT = 10 * 60_000;

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  return { idle, total };
}
/** → { temp, util } de la primera GPU NVIDIA; undefined si no hay nvidia-smi (no volver a preguntar); rechaza si falló esta vez. */
function readNvidia() {
  return new Promise((resolve, reject) => {
    execFile("nvidia-smi", ["--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return err.code === "ENOENT" ? resolve(undefined) : reject(err);
      const [t, u] = String(out).trim().split("\n")[0].split(",").map((x) => Number(x.trim()));
      Number.isFinite(t) ? resolve({ temp: t, util: Number.isFinite(u) ? u : null }) : reject(new Error("nvidia-smi raro"));
    });
  });
}

/**
 * @param onChange ({ hot, say, cpu, gpuTemp, gpuUtil }) => void — al cambiar `hot` y cada vez que toque decirlo (`say`)
 */
// Cada 30 s (antes 15): `nvidia-smi` es un proceso nuevo cada vez; con dos lecturas seguidas el calor igual se avisa en ~1 min.
function createVitals({ onChange, every = 30_000, gpu = readNvidia, cpu = cpuTimes, now = Date.now }) {
  let timer = null, prev = cpu(), strikes = 0, lastSaid = -Infinity, wasHot = false, gpuMissing = false;
  async function sample() {
    const cur = cpu();
    const dT = cur.total - prev.total;
    const cpuPct = dT > 0 ? Math.round(100 * (1 - (cur.idle - prev.idle) / dT)) : 0;
    prev = cur;
    let g = null;
    if (!gpuMissing) {
      g = await gpu().catch(() => null);
      if (g === undefined) { gpuMissing = true; g = null; }
    }
    const hotNow = (g?.temp ?? 0) >= GPU_HOT || cpuPct >= CPU_HOT;
    strikes = hotNow ? strikes + 1 : 0;
    const hot = strikes >= 2; // un pico solo no cuenta
    const say = hot && now() - lastSaid >= REPEAT;
    if (say) lastSaid = now();
    if (hot !== wasHot || say) { wasHot = hot; onChange({ hot, say, cpu: cpuPct, gpuTemp: g?.temp ?? null, gpuUtil: g?.util ?? null }); }
  }
  return {
    start() { if (!timer) timer = setInterval(() => sample().catch(() => {}), every); },
    stop() { clearInterval(timer); timer = null; },
    sample, // para la autoprueba
  };
}

module.exports = { createVitals, readNvidia, GPU_HOT, CPU_HOT };

if (require.main === module) {
  const assert = require("assert");
  (async () => {
    const out = [];
    let t = 0, temps = [50, 95, 95, 95, 60, 60], cpuSeq = [[0, 100], [10, 200], [20, 300], [30, 400], [40, 500], [50, 600], [60, 700]];
    let i = 0;
    const v = createVitals({ onChange: (x) => out.push(x), gpu: async () => ({ temp: temps[Math.min(i++, temps.length - 1)], util: 100 }), cpu: () => { const [idle, total] = cpuSeq.shift() ?? [999, 9999]; return { idle, total }; }, now: () => t });
    await v.sample(); // 50 °C: nada
    await v.sample(); // 95: primer aviso, aún no (un pico solo no cuenta)
    assert.deepStrictEqual(out, []);
    await v.sample(); // 95 otra vez: caliente, y lo dice
    assert.strictEqual(out.length, 1); assert.strictEqual(out[0].hot, true); assert.strictEqual(out[0].say, true); assert.strictEqual(out[0].gpuTemp, 95); assert.strictEqual(out[0].cpu, 90);
    t += 60_000; await v.sample(); // sigue caliente, pero no lo repite antes de 10 min
    assert.strictEqual(out.length, 1);
    await v.sample(); // 60 °C: se enfrió → cambia a hot:false
    assert.strictEqual(out.length, 2); assert.strictEqual(out[1].hot, false); assert.strictEqual(out[1].say, false);
    // Sin nvidia-smi: la GPU deja de preguntarse y la CPU sola también cuenta
    let asks = 0;
    const out2 = [];
    const w = createVitals({ onChange: (x) => out2.push(x), gpu: async () => { asks++; return undefined; }, cpu: (() => { let n = 0; return () => ({ idle: 0, total: ++n * 100 }); })(), now: () => 0 });
    await w.sample(); await w.sample(); await w.sample();
    assert.strictEqual(asks, 1); assert.strictEqual(out2.length, 1); assert.strictEqual(out2[0].gpuTemp, null); assert.strictEqual(out2[0].cpu, 100);
    console.log("vitals.js ok");
  })().catch((e) => { console.error(e); process.exit(1); });
}

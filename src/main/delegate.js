// Encargos a otras IAs: Claude (el orquestador de Nimbo) puede PROPONER "pídele esto a Gemini" (una imagen, por ejemplo);
// el usuario lo ve en una tarjeta y decide. Aquí vive lo que se valida (sin Electron, para poder probarlo).
const path = require("path");

const KINDS = new Set(["image", "text"]);
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Los encargos que propuso el modelo, ya limpios: solo Gemini, solo imagen o texto, máximo 3 y con prompt. */
function cleanDelegates(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((d) => d?.ai === "gemini" && KINDS.has(d.kind) && str(d.prompt, 1500))
    .slice(0, 3)
    .map((d) => ({ ai: "gemini", kind: d.kind, prompt: str(d.prompt, 1500) }));
}

/** nimbo-20261014-153042.png */
function imageFileName(mime, date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `nimbo-${stamp}.${mime === "image/jpeg" ? "jpg" : "png"}`;
}

/** Un archivo solo se muestra en el explorador si está DENTRO de la carpeta de imágenes de Nimbo. */
function insideDir(file, dir) {
  const f = path.resolve(String(file ?? ""));
  const d = path.resolve(dir);
  return f.startsWith(d + path.sep);
}

module.exports = { cleanDelegates, imageFileName, insideDir };

// Autoprueba: `node src/main/delegate.js`
if (require.main === module) {
  const assert = require("assert");
  const ok = { ai: "gemini", kind: "image", prompt: "  A cloud   mascot, flat style  " };
  assert.deepStrictEqual(cleanDelegates([ok, { ...ok, kind: "text", prompt: "Resume esto" }, { ai: "openai", kind: "image", prompt: "x" }, { ai: "gemini", kind: "video", prompt: "x" },
    { ai: "gemini", kind: "image", prompt: "   " }, { ai: "gemini", kind: "image" }, null, "texto"]),
    [{ ai: "gemini", kind: "image", prompt: "A cloud mascot, flat style" }, { ai: "gemini", kind: "text", prompt: "Resume esto" }]);
  assert.strictEqual(cleanDelegates(Array.from({ length: 9 }, () => ok)).length, 3);
  assert.strictEqual(cleanDelegates([{ ...ok, prompt: "z".repeat(5000) }])[0].prompt.length, 1500);
  assert.deepStrictEqual(cleanDelegates("nada"), []);
  assert.strictEqual(imageFileName("image/png", new Date(2026, 9, 14, 15, 30, 42)), "nimbo-20261014-153042.png");
  assert.strictEqual(imageFileName("image/jpeg", new Date(2026, 0, 2, 3, 4, 5)), "nimbo-20260102-030405.jpg");
  const dir = path.join(path.sep, "pics", "Nimbo");
  assert.ok(insideDir(path.join(dir, "a.png"), dir));
  for (const bad of [path.join(dir, "..", "secreto.txt"), path.join(path.sep, "pics", "Nimbo-otro", "a.png"), dir, "", null, path.join(dir, "..", "..", "etc", "passwd")]) assert.ok(!insideDir(bad, dir), String(bad));
  console.log("delegate.js ok");
}

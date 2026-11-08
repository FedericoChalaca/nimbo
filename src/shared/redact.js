// Tapa lo que parece un secreto ANTES de que un texto salga del PC: lo que Nimbo le escribe a tu IA de WhatsApp en «De Nimbo» (y su aviso en el
// calendario), lo que manda a Telegram y lo que muestra en una notificación. Un chat de Claude puede pedir permiso para `curl -H "Authorization:
// Bearer sk-…"` o responder con una clave: eso no tiene por qué llegar a Google ni a otra IA. Se tapa, no se corta: el resto del texto sigue legible.
const MASK = "[secreto]";
// Formatos conocidos: Anthropic/OpenAI (sk-…), GitHub (ghp_/gho_/github_pat_), Google (AIza…, GOCSPX-…), Slack (xox…), AWS (AKIA…), bot de Telegram (123456789:AA…)
const KNOWN = /\b(?:sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[\w]{20,}|AIza[\w-]{30,}|GOCSPX-[\w-]{10,}|xox[abprs]-[\w-]{10,}|AKIA[A-Z0-9]{16}|\d{8,10}:AA[\w-]{30,})(?![\w-])/g;
// "clave = valor": bearer, token, password, secret, api key… (el nombre se deja; el valor se tapa)
const PAIR = /(\b(?:bearer|token|passw(?:or)?d|pwd|secret|api[_-]?key|client[_-]?secret|authorization|contraseña|clave)\b\s*[:=]?\s*["']?)(?!bearer\b|\[secreto\])([^\s"'&;,]{6,})/gi;
// Hexadecimal largo (40+): hashes de sesión, tokens, cookies. (Un SHA de git también se tapa: en un mensaje a otra IA no hace falta.)
const HEX = /\b[A-Fa-f0-9]{40,}\b/g;

/** El mismo texto con los secretos tapados. */
function redact(text) {
  return String(text ?? "").replace(KNOWN, MASK).replace(PAIR, `$1${MASK}`).replace(HEX, MASK);
}

module.exports = { redact, MASK };

// Autoprueba: `node src/shared/redact.js`
if (require.main === module) {
  const assert = require("assert");
  const r = redact;
  assert.strictEqual(r('curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop" https://x'), 'curl -H "Authorization: Bearer [secreto]" https://x');
  assert.strictEqual(r("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "export GITHUB_TOKEN=[secreto]");
  assert.strictEqual(r("la clave es AIzaSyA-1234567890abcdefghijklmnopqrstuv y ya"), "la clave es [secreto] y ya");
  assert.strictEqual(r("GOCSPX-abcdefghijklmnop"), "[secreto]");
  assert.strictEqual(r("bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"), "bot [secreto]");
  assert.strictEqual(r("password=hunter22 user=fede"), "password=[secreto] user=fede");
  assert.strictEqual(r("contraseña: miClave123"), "contraseña: [secreto]");
  assert.strictEqual(r("token 1234567890abcdef1234567890abcdef12345678"), "token [secreto]");
  // Lo normal no se toca: fechas, cifras, enlaces de Drive, palabras cortas tras "clave", ids de 32 hex
  for (const s of ["Compra D1: total $138.750, leche x3", "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd/edit", "la clave del examen es B", "id a037ff632b4700c2", "sk-corto", "pwd: 123"])
    assert.strictEqual(r(s), s, s);
  assert.strictEqual(r(null), "");
  console.log("redact.js ok");
}

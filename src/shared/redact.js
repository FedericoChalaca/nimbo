// Tapa lo que parece un secreto ANTES de que un texto salga del PC hacia un tercero: hoy, lo que Nimbo le escribe a tu IA de WhatsApp en
// «De Nimbo» (y su aviso en el calendario), que lee otra IA en Google. Un chat de Claude puede pedir permiso para `curl -H "Authorization:
// Bearer sk-…"` o responder con una clave: eso no tiene por qué llegar ahí. Se tapa, no se corta: el resto del texto sigue legible.
// (Telegram solo recibe el nombre del chat y de la herramienta, y la app del celular va por tu propio puente: no pasan por aquí.)
const MASK = "[secreto]";
const quoted = (v) => /^["']/.test(v);
// Formatos conocidos: Anthropic/OpenAI (sk-ant-, sk-proj-, sk-svcacct-, sk-admin-, sk-…), GitHub (ghp_/gho_/ghu_/ghs_/ghr_, github_pat_),
// Google (AIza…, GOCSPX-…), Slack (xox…), AWS (AKIA/ASIA…), bot de Telegram (123456789:AA…), Stripe (sk_live_/rk_live_), Supabase (sbp_),
// npm (npm_) y JWT (eyJ….….…).
const KNOWN = /(?<![A-Za-z0-9])(?:sk-ant-[\w-]{10,}|sk-(?:proj|svcacct|admin)-[\w-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AIza[\w-]{30,}|GOCSPX-[\w-]{10,}|xox[abprs]-[\w-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|\d{8,10}:AA[\w-]{30,}|[sr]k_live_\w{10,}|sbp_[a-f0-9]{20,}|npm_[A-Za-z0-9]{20,}|eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,})(?![\w-])/g;
// Usuario y contraseña dentro de un enlace: https://yo:clave@servidor → https://yo:[secreto]@servidor
const URL_CRED = /(\b[a-z][\w+.-]*:\/\/[^\/\s:@]+:)[^@\s\/]+(@)/gi;
// "Bearer xyz" / "Basic xyz" (encabezado de autorización)
const BEARER = /(\b(?:bearer|basic)\s+)(?!\[secreto\])[A-Za-z0-9._~+\/=-]{8,}/gi;
// "nombre: valor" o "nombre=valor" (también GITHUB_TOKEN=, DB_PASSWORD=, "token": "…"). Exige ":" o "=": así "la clave fundamental" o "el token
// expiró" no se tocan. El nombre puede ir pegado a otro con _ (OPENAI_API_KEY): por eso no \b sino «sin letra ni número antes».
const PAIR = /((?<![A-Za-z0-9])(?:token|passw(?:or)?d|pwd|secret|api[_-]?key|authorization|credentials?|contraseña|clave)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*)(?!(?:bearer|basic)\b|\[secreto\]|["']\[secreto\])("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"'&;,]{3,})/gi;
// Hexadecimal largo (40+): hashes de sesión, tokens, cookies. (Un SHA de git también se tapa: en un mensaje a otra IA no hace falta.)
const HEX = /\b[A-Fa-f0-9]{40,}\b/g;

/** El mismo texto con los secretos tapados. */
function redact(text) {
  return String(text ?? "")
    .replace(KNOWN, MASK)
    .replace(URL_CRED, `$1${MASK}$2`)
    .replace(BEARER, `$1${MASK}`)
    .replace(PAIR, (_m, name, val) => name + (quoted(val) ? val[0] + MASK + val[0] : MASK))
    .replace(HEX, MASK);
}

module.exports = { redact, MASK };

// Autoprueba: `node src/shared/redact.js`
if (require.main === module) {
  const assert = require("assert");
  const yes = [
    ['curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnop" https://x', 'curl -H "Authorization: Bearer [secreto]" https://x'],
    ["export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789", "export GITHUB_TOKEN=[secreto]"],
    ["export GITHUB_TOKEN=abc123sinprefijo", "export GITHUB_TOKEN=[secreto]"],
    ["OPENAI_API_KEY=algo-raro-777 y DB_PASSWORD=x9z", "OPENAI_API_KEY=[secreto] y DB_PASSWORD=[secreto]"],
    ["la clave es AIzaSyA-1234567890abcdefghijklmnopqrstuv y ya", "la clave es [secreto] y ya"],
    ["GOCSPX-abcdefghijklmnop", "[secreto]"],
    ["bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", "bot [secreto]"],
    ["password=hunter22 user=fede", "password=[secreto] user=fede"],
    ["pwd=abc12", "pwd=[secreto]"],
    ['password: "con espacios y todo"', 'password: "[secreto]"'],
    ['{"token": "corto1", "otra": 1}', '{"token": "[secreto]", "otra": 1}'],
    ["contraseña: miClave123", "contraseña: [secreto]"],
    ["token: 1234567890abcdef1234567890abcdef12345678", "token: [secreto]"],
    ["key sk-proj-abcdefghij_KLMNOPQRSTUVWXYZ012345", "key [secreto]"],
    ["sk-svcacct-abcdefghijklmnopqrstuvwxyz0", "[secreto]"],
    ["ghs_abcdefghijklmnopqrstuvwxyz0123456789 ghu_abcdefghijklmnopqrstuvwxyz0123456789 ghr_abcdefghijklmnopqrstuvwxyz0123456789", "[secreto] [secreto] [secreto]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c listo", "jwt [secreto] listo"],
    ["AKIAIOSFODNN7EXAMPLE y ASIAIOSFODNN7EXAMPLE", "[secreto] y [secreto]"],
    ["aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "aws_secret_access_key=[secreto]"],
    ["git clone https://fede:miClave99@github.com/x/y.git", "git clone https://fede:[secreto]@github.com/x/y.git"],
    ["postgres://admin:s3cr3t@db.local:5432/app", "postgres://admin:[secreto]@db.local:5432/app"],
    ["sk_live_abcdefghijklmnop y sbp_0123456789abcdef0123456789abcdef y npm_abcdefghijklmnopqrstuvwxyz0123", "[secreto] y [secreto] y [secreto]"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization: Basic [secreto]"],
  ];
  for (const [input, out] of yes) assert.strictEqual(redact(input), out, input);
  // Lo normal no se toca: fechas, cifras, enlaces, frases con "clave"/"token"/"authorization" sin ":" ni "=", ids cortos
  for (const s of ["Compra D1: total $138.750, leche x3", "https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd/edit",
    "la clave del examen es B", "la clave fundamental es practicar", "el token expiró ayer", "Authorization header missing", "id a037ff632b4700c2",
    "sk-corto", "el secreto está en la masa", "https://github.com/FedericoChalaca/nimbo", "Bearer de malas noticias"])
    assert.strictEqual(redact(s), s, s);
  assert.strictEqual(redact(redact("password=hunter22")), "password=[secreto]"); // aplicarlo dos veces no cambia nada
  assert.strictEqual(redact(null), "");
  console.log("redact.js ok");
}

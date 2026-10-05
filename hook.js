// Lo ejecuta Claude Code en cada evento: reenvía el JSON de stdin a Nimbo.
// Nunca bloquea ni falla: si Nimbo está cerrado, sale en silencio con código 0
// y Claude Code sigue como siempre.
//
// En PermissionRequest espera la decisión de Nimbo y la imprime en el formato
// que espera Claude Code. Sin decisión no imprime nada: pregunta la terminal.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const URL_BASE = "http://127.0.0.1:47823";

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  try {
    await main(input.replace(/^﻿/, ""));
  } catch {}
  process.exit(0);
});

/** Copia del objeto con cada texto recortado a 3000 caracteres. */
function trim(v) {
  if (typeof v === "string") return v.length > 3000 ? v.slice(0, 3000) + "…" : v;
  if (Array.isArray(v)) return v.slice(0, 50).map(trim);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]));
  return v;
}

async function main(body) {
  const token = fs.readFileSync(path.join(process.env.APPDATA, "nimbo", "token"), "utf8").trim();
  const mac = (msg) => crypto.createHmac("sha256", token).update(msg).digest("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const isPermission = JSON.parse(body).hook_event_name === "PermissionRequest";
  // Para la vista en vivo basta con un trozo: no hace falta mandar un archivo entero leído
  // o la salida completa de un comando en cada paso. (PermissionRequest va intacto.)
  if (!isPermission) body = JSON.stringify(trim(JSON.parse(body)));

  const res = await fetch(URL_BASE + (isPermission ? "/permission" : "/hook"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-nimbo-nonce": nonce, "x-nimbo-mac": mac(`req:${nonce}:${body}`) },
    body,
    signal: AbortSignal.timeout(isPermission ? 70_000 : 400),
  });
  if (!isPermission || !res.ok) return;

  const { decision, mac: answerMac } = await res.json();
  // Solo vale una respuesta firmada con el secreto: así nadie puede hacerse
  // pasar por Nimbo en ese puerto y aprobar comandos por ti.
  if (!["allow", "always", "deny"].includes(decision) || answerMac !== mac(`res:${nonce}:${decision}`)) return;

  const out = { behavior: decision === "deny" ? "deny" : "allow" };
  if (decision === "deny") out.message = "Denegado desde Nimbo";
  // "Siempre": se aplican las reglas que el propio Claude Code sugirió para esta petición.
  if (decision === "always") out.updatedPermissions = JSON.parse(body).permission_suggestions ?? [];
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: out } }));
}

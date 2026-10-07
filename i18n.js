// Traducciones al inglés. La CLAVE es el texto en español tal como aparece en el código:
// `t("Permitir")` devuelve "Allow" en inglés y "Permitir" en español. {0}, {1}… son valores.
// Lo carga la página (index.html, como script) y el proceso principal (require).
// Para agregar un texto: escríbelo en español con t("…") y pon aquí su traducción.
const NIMBO_EN = {
  // — Isla y estados —
  "¿En qué te ayudo?": "How can I help?",
  "Suéltalo sobre mí": "Drop it on me",
  "Buenos días": "Good morning",
  "Buenas tardes": "Good afternoon",
  "Buenas noches": "Good evening",
  "Hola 👋 · {0}": "Hi 👋 · {0}",
  "Pensando…": "Thinking…",
  "empezó": "started",
  "terminó": "finished",
  "falló": "failed",
  "te necesita": "needs you",
  "⚠ Falló · {0}": "⚠ Failed · {0}",
  "¡Listo! · {0}": "Done! · {0}",
  "Algo falló en {0} 😢": "Something failed in {0} 😢",
  "Ya, ya… 😵‍💫": "Okay, okay… 😵‍💫",
  // — Herramientas de Claude Code —
  "Ejecuta": "Runs",
  "Lee": "Reads",
  "Escribe": "Writes",
  "Edita": "Edits",
  "Busca": "Searches",
  "Busca en la web": "Searches the web",
  "Abre": "Opens",
  "Agente": "Agent",
  "Tareas": "To-dos",
  // — Chats y vista en vivo —
  "1 chat activo": "1 active chat",
  "{0} chats activos": "{0} active chats",
  "paso {0}": "step {0}",
  "listo": "done",
  "edita": "edit",
  "nuevo": "new",
  // — Permisos —
  "{0} quiere usar {1}": "{0} wants to use {1}",
  "una herramienta": "a tool",
  "Denegar": "Deny",
  "Siempre": "Always",
  "Permitir": "Allow",
  "Que te pregunte en la terminal": "Ask me in the terminal instead",
  "Permitir siempre: {0}": "Always allow: {0}",
  "\"Siempre\" aprobaría: {0}": "\"Always\" would approve: {0}",
  "Aprobado ✓": "Approved ✓",
  "Aprobado para siempre ✓": "Always approved ✓",
  "Denegado ✋": "Denied ✋",
  "Te pregunta en la terminal": "It will ask in the terminal",
  // — Chat y adjuntos —
  "Escríbele a Claude… (suelta archivos sobre mí)": "Message Claude… (or drop files on me)",
  "Adjuntar archivos o imágenes": "Attach files or images",
  "Ver mi pantalla: toma un pantallazo y lo adjunta": "See my screen: takes a screenshot and attaches it",
  "¿Qué necesitas de lo que ves en mi pantalla?": "What do you need from what is on my screen?",
  "Mira mi pantalla y dime qué ves.": "Look at my screen and tell me what you see.",
  "No pude tomar el pantallazo": "Could not take the screenshot",
  "Dictar: habla y se escribe aquí": "Dictate: speak and it types here",
  "Enviar": "Send",
  "Descartar": "Discard",
  "Quitar": "Remove",
  "(clic para quitar)": "(click to remove)",
  "\"{0}\" pesa más de 5 MB.": "\"{0}\" is larger than 5 MB.",
  "Me tragué \"{0}\" 📎": "Swallowed \"{0}\" 📎",
  "Me tragué {0} archivos 📎": "Swallowed {0} files 📎",
  "¿Qué ves en esta imagen?": "What do you see in this image?",
  "Revisa estos archivos.": "Take a look at these files.",
  "No pude hablar con Claude.": "Could not reach Claude.",
  "(sin respuesta)": "(no reply)",
  "  ⚠ abierto en la app: ahí no verás esto hasta reabrirlo": "  ⚠ open in the app: you won't see this there until you reopen it",
  "→ {0} trabajando…": "→ {0} working…",
  // — Dictado —
  "Descargando el oído": "Downloading Nimbo's ear",
  "Descargando el oído de Nimbo… {0}%": "Downloading Nimbo's ear… {0}%",
  "Oído: {0}": "Ear: {0}",
  "Te escucho… (clic en 🎤 para terminar)": "Listening… (click 🎤 to finish)",
  "No tengo micrófono: revisa Privacidad → Micrófono en Windows": "No microphone: check Privacy → Microphone in Windows",
  "Micrófono: {0}": "Microphone: {0}",
  // — Recordatorios —
  "Recordatorio": "Reminder",
  "Posponer 10 min": "Snooze 10 min",
  "Hecho": "Done",
  "✓ Hecho": "✓ Done",
  "⏰ Te aviso en 10 min": "⏰ I'll remind you in 10 min",
  "Pendientes": "Reminders",
  "tus recordatorios": "your reminders",
  "Marcar como hecho": "Mark as done",
  "sin fecha": "no date",
  "hoy {0}": "today {0}",
  "mañana {0}": "tomorrow {0}",
  // — Plan del día —
  "Plan": "Plan",
  "Plan de hoy": "Today's plan",
  "Plan de hoy.": "Today's plan.",
  "Hoy ninguno puede avanzar solo.": "None can move forward on its own today.",
  "Un proyecto puede avanzar solo.": "One project can move forward on its own.",
  "{0} proyectos pueden avanzar solos.": "{0} projects can move forward on their own.",
  "Tiene una propuesta para ti: {0}.": "It has a proposal for you: {0}.",
  "Tienen una propuesta para ti: {0}.": "They have a proposal for you: {0}.",
  "{0} solos · {1} con propuesta para ti": "{0} on their own · {1} with a proposal for you",
  "Para ti": "For you",
  "Solo": "On its own",
  "Escuchar": "Listen",
  "{0} sin propuesta hoy": "{0} with no proposal today",
  "hoy": "today",
  "No tengo el plan de hoy: no está configurado, no hay conexión o todavía no ha salido.": "I do not have today's plan: it is not set up, there is no connection, or it has not come out yet.",
  // — Trello, GitHub, WhatsApp —
  "nada pendiente": "nothing pending",
  "Actualizar": "Refresh",
  "Actualizando…": "Refreshing…",
  "Actualizado {0}": "Updated {0}",
  "Trello: \"{0}\" vence {1}": "Trello: \"{0}\" is due {1}",
  "vencida": "overdue",
  "{0} sin leer": "{0} unread",
  "Abrir WhatsApp": "Open WhatsApp",
  "Resumen de WhatsApp": "WhatsApp summary",
  "WhatsApp · resumiendo…": "WhatsApp · summarizing…",
  "Resumiendo…": "Summarizing…",
  "Aún sin resumir.": "Not summarized yet.",
  "Resumido por tu Claude.": "Summarized by your Claude.",
  "Resumido en tu equipo por {0}.": "Summarized on your PC by {0}.",
  "Resumir ahora": "Summarize now",
  "Visto": "Seen",
  "Ya lo leí: cerrar y no volver a mostrarlo": "I read it: close and do not show it again",
  "Copiar": "Copy",
  "Copiado ✓": "Copied ✓",
  "Copia la respuesta sugerida para pegarla en WhatsApp": "Copy the suggested reply to paste it into WhatsApp",
  "Guía": "Guide",
  "Trabajo": "Work",
  "Grupo": "Group",
  "Nuevo": "New",
  "Otro": "Other",
  "Urgente": "Urgent",
  "Ignorados: {0}": "Ignored: {0}",
  "Para ver quién escribe y qué es urgente: clic derecho en Nimbo > Leer mensajes de WhatsApp.": "To see who wrote and what is urgent: right-click Nimbo > Read WhatsApp messages.",
  "Falta permiso: Configuración de Windows > Privacidad > Notificaciones.": "Permission missing: Windows Settings > Privacy > Notifications.",
  "Sin vista previa: esos chats no dejaron notificación en Windows.": "No preview: those chats left no notification in Windows.",
  // — Conexiones y ajustes —
  "Conexiones": "Connections",
  "lo que Nimbo puede ver": "what Nimbo can see",
  "Listo": "Done",
  "Tu nombre": "Your name",
  "Para saludarte.": "To greet you.",
  "No lo encontré en este equipo.": "Not found on this PC.",
  "Cómo instalarlo": "How to install",
  "Conectado: ve tus chats y te pasa los permisos.": "Connected: sees your chats and brings you permission requests.",
  "Desconectar": "Disconnect",
  "La conexión apunta a otra carpeta.": "The connection points to another folder.",
  "Reconectar": "Reconnect",
  "No pude leer `~/.claude/settings.json`: revisa que sea JSON válido.": "Could not read `~/.claude/settings.json`: check that it is valid JSON.",
  "Conéctalo para ver tus chats en vivo y aprobar permisos.": "Connect it to watch your chats live and approve permissions.",
  "Conectar": "Connect",
  "Conectado con tu sesión de gh.": "Connected through your gh session.",
  "Abre una terminal y escribe `gh auth login`.": "Open a terminal and run `gh auth login`.",
  "Opcional: avisa de tus notificaciones.": "Optional: alerts you about your notifications.",
  "Instalar GitHub CLI": "Install GitHub CLI",
  "Conectado: {0} pendiente.": "Connected: {0} pending.",
  "Conectado: {0} pendientes.": "Connected: {0} pending.",
  "Opcional: activa el conector de Trello en claude.ai y pulsa Probar (tarda 1 min).": "Optional: enable the Trello connector on claude.ai, then press Test (takes 1 min).",
  "Probar": "Test",
  "Resume quién te escribió y avisa lo urgente.": "Summarizes who wrote and flags what is urgent.",
  "Lo resume tu propio Claude. Con Ollama lo haría un modelo local, sin gastar tokens.": "Summarized by your own Claude. With Ollama, a local model would do it at no token cost.",
  "Lo resume un modelo local ({0}): nada sale de tu equipo.": "Summarized by a local model ({0}): nothing leaves your PC.",
  "Reglas": "Rules",
  "Apagar": "Turn off",
  "Opcional: tu propio Claude resume tus mensajes. Nada pasa por Nimbo ni por su autor.": "Optional: your own Claude summarizes your messages. Nothing goes through Nimbo or its author.",
  "Activar": "Turn on",
  "Iniciar con Windows": "Start with Windows",
  "Nimbo arranca al prender el equipo.": "Nimbo starts when you log in.",
  "Que Nimbo arranque solo al prender el equipo.": "Have Nimbo start when you log in.",
  "No se pudo: {0}": "Failed: {0}",
  // — Menú y notificaciones (main.js) —
  "Conexiones y ajustes…": "Connections & settings…",
  "Modo mini  ({0})": "Mini mode  ({0})",
  "Esquina del modo mini": "Mini mode corner",
  "Arriba a la izquierda": "Top left",
  "Arriba a la derecha": "Top right",
  "Abajo a la izquierda": "Bottom left",
  "Abajo a la derecha": "Bottom right",
  "Apariencia": "Look",
  "Nube": "Cloud",
  "Actualizar Trello": "Refresh Trello",
  "Leer mensajes de WhatsApp (los resume tu Claude)": "Read WhatsApp messages (summarized by your Claude)",
  "Reglas de WhatsApp…": "WhatsApp rules…",
  "Nueva conversación": "New conversation",
  "Silenciar sonidos": "Mute sounds",
  "Opciones de Nimbo": "Nimbo options",
  "Leer las respuestas en voz alta": "Read replies aloud",
  "Voz": "Voice",
  "Lee sus respuestas en voz alta.": "Reads its replies aloud.",
  "Que Nimbo lea sus respuestas en voz alta.": "Have Nimbo read its replies aloud.",
  "Opcional: pon en prefs.json la dirección de un servicio de voz (`ttsUrl`).": "Optional: set a text-to-speech service address in prefs.json (`ttsUrl`).",
  "Nube. Cada apariencia tiene su propia voz.": "Cloud. Each look has its own voice.",
  "JARVIS. Cada apariencia tiene su propia voz.": "JARVIS. Each look has its own voice.",
  "Salir": "Quit",
  "Nimbo · recordatorio": "Nimbo · reminder",
  "WhatsApp urgente · {0}": "WhatsApp urgent · {0}",
  // — Orquestador (orchestrator.js) —
  "No encontré claude.exe. Instala Claude Code o define NIMBO_CLAUDE con su ruta.": "claude.exe not found. Install Claude Code or set NIMBO_CLAUDE to its path.",
  "Ese chat ya no está en la lista.": "That chat is no longer in the list.",
};

/** translator("en")("Hola 👋 · {0}", "api") → "Hi 👋 · api". Sin traducción, queda el español. */
const translator = (lang) => (s, ...a) => (lang === "en" ? NIMBO_EN[s] ?? s : s).replace(/\{(\d)\}/g, (_, i) => a[i]);

if (typeof module !== "undefined") module.exports = { NIMBO_EN, translator };

// Prueba rápida: `node i18n.js` revisa que todo t("…") del código tenga su traducción.
if (typeof module !== "undefined" && require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const missing = [];
  for (const file of ["index.html", "main.js", "voice.js", "orchestrator.js", "plan.js"]) {
    const code = fs.readFileSync(path.join(__dirname, file), "utf8");
    // t("clave"…  y también  t(cond ? "clave uno" : "clave dos"…
    for (const m of code.matchAll(/\bt\((?:[^"()]*\? )?"((?:\\.|[^"\\])*)"(?: : "((?:\\.|[^"\\])*)")?/g)) {
      for (const raw of [m[1], m[2]].filter(Boolean)) {
        const key = JSON.parse(`"${raw}"`);
        if (!(key in NIMBO_EN)) missing.push(`${file}: ${key}`);
      }
    }
  }
  if (missing.length) {
    console.error("Sin traducción:\n" + missing.join("\n"));
    process.exit(1);
  }
  const ok = translator("en")("Hola 👋 · {0}", "api") === "Hi 👋 · api" && translator("es")("paso {0}", 3) === "paso 3";
  if (!ok) {
    console.error("translator() no devuelve lo esperado");
    process.exit(1);
  }
  console.log("i18n.js ok");
}

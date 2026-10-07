# Nimbo

Compañero flotante de Claude Code para Windows (Electron). Vive arriba al centro de la
pantalla, reacciona a lo que hacen las sesiones de Claude Code (varias a la vez, con el título
de cada chat), deja aprobar permisos, chatear con Claude (imágenes, archivos soltados encima y
dictado), avisa de notificaciones de GitHub y tiene personalidad: saludo, gestos y sonidos.
Solo Windows 10/11. Interfaz en español. Instalación y uso para personas: `README.md`.

## Arrancar
- `npm start` (o el acceso directo `Nimbo.lnk` en la carpeta Inicio de Windows, que arranca
  `node_modules\electron\dist\electron.exe "<carpeta de nimbo>"` al iniciar sesión).
- Hooks de Claude Code: `npm run install-hooks` / `npm run uninstall-hooks`. Escribe en
  `~/.claude/settings.json` con backup fechado `settings.json.bak-*`. Si se mueve la carpeta,
  hay que reinstalarlos (guardan la ruta de `hook.js`).

## Archivos
| Archivo | Qué hace |
|---|---|
| `main.js` | Proceso principal: ventana, protocolo `nimbo://`, servidor de hooks, permisos, menú, modo mini, zonas tocables, permiso de micrófono. |
| `preload.js` | Puente IPC (`window.nimbo`). Todo lo que la página usa de `api.*` sale de aquí. |
| `index.html` | Personaje (tema Nube en SVG), estados, chat, tarjeta de permisos, propuestas del orquestador, barra de desplazamiento propia. |
| `jarvis.js` | Tema JARVIS: esfera de puntos conectados en canvas; `Jarvis.setState/setLevel/look/poke/setActive`. |
| `orchestrator.js` | Chat y orquestador vía `claude.exe -p`; lista de chats leída de `~/.claude/projects`. |
| `voice.js` | Dictado 🎤 (micrófono → Whisper → texto en el cuadro). |
| `stt-worker.js` | Worker con Whisper (`onnx-community/whisper-base`, CPU/wasm q8, 4 hilos). |
| `hook.js` | Lo ejecuta Claude Code en cada evento: firma y reenvía el JSON a Nimbo. |
| `install-hooks.js` | Instala/quita los 10 hooks (PermissionRequest con timeout 75 s, el resto 5 s). |
| `i18n.js` | Traducciones al inglés y `translator(lang)`; lo usan la página y el proceso principal. |
| `plan.js` | Plan del día: lo lee de una rama git (solo lectura), lo valida y arma lo que se dice (`node plan.js` = autoprueba). |
| `tts.js` | Voz: limpia y recorta el texto y pide el mp3 al servicio de `prefs.ttsUrl` (`node tts.js` = autoprueba). |
| `reminders.js` | Recordatorios en JSON (`node reminders.js` = autoprueba). |
| `trello.js` | Tarjetas pendientes vía el conector de Trello de tu `claude` (solo lectura). |
| `whatsapp.js` + `wa-watch.ps1` | WhatsApp de escritorio en solo lectura (`node whatsapp.js` = autoprueba). |

## Flujos
**Hooks → personaje.** Claude Code ejecuta `node hook.js` en SessionStart, SessionEnd,
UserPromptSubmit, Pre/PostToolUse, PostToolUseFailure, Notification, Stop, StopFailure y
PermissionRequest. `hook.js` hace POST a `http://127.0.0.1:47823/hook` (o `/permission`)
firmado con HMAC. Si Nimbo está cerrado, sale en ≤0,4 s con código 0: nunca bloquea a Claude.

**Permisos.** En PermissionRequest, Nimbo muestra una tarjeta (Permitir / Denegar / Terminal).
`hook.js` imprime `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow|deny"}}}`.
Sin decisión en 60 s, en modo mini o con otra tarjeta abierta → no imprime nada y pregunta la terminal.
Cada petición cierra solo su propia tarjeta (había un bug en el que el `close` tardío de una
respuesta cerraba la tarjeta de la siguiente).

**Chat / orquestador (`orchestrator.js`).**
- `ask`: lanza `claude.exe -p` (sin shell) con `--input-format/--output-format stream-json`,
  `--append-system-prompt` (lista de chats + reglas), `--json-schema` (`{reply, dispatch[]}`),
  `--add-dir <prefs.vault>` (si hay) y `--tools Read,Glob,Grep --strict-mcp-config`: lista CERRADA,
  el orquestador solo lee archivos (ni web, ni conectores, ni terminal). Conversación propia en `%APPDATA%\nimbo\chat` (`--resume`).
- Lista de chats: transcripciones `~/.claude/projects/*/*.jsonl` (título = `customTitle`/`agentName`,
  carpetas extra donde trabaja = raíces de `file_path` fuera del cwd). Excluye `scratch-workspaces`
  y corridas `sdk-cli`. Si hay `prefs.vault`, su chat siempre entra.
- Cada propuesta es un ENCARGO con cuatro partes fijas (regla en `systemPrompt`): Objetivo, Contexto, Terminado
  cuando (criterios comprobables) y Fuera de alcance. `DISPATCH_RULES` le pide al otro chat respetar el fuera de
  alcance y responder criterio por criterio. Un encargo por chat; si una parte depende de otra, solo la primera.
- `dispatch` (botón Enviar en la propuesta): `claude.exe -p --resume <id> --permission-mode auto
  --add-dir <carpetas> --append-system-prompt <reglas: hazlo tú, 2 frases, sin código>`.
- Imágenes: Ctrl+V o 📎, van dentro del mensaje stream-json (base64), sin archivos temporales.

**Interacción con el mouse.** La ventana ignora el mouse (`setIgnoreMouseEvents(true)`) salvo
cuando el cursor está sobre una zona tocable. La página reporta cada 200 ms sus rectángulos
(`#hit` y `.solid`) y `main.js`, que ya consulta el cursor cada 33 ms para los ojos, activa los
clics al entrar. NO usar `{ forward: true }`: en este equipo dejó de reenviar eventos y Nimbo
no se podía tocar.

**Varios chats.** `main.js` agrega `payload.title` (título del chat leído de `transcript_path`,
solo dentro de `~/.claude/projects`, caché 1 min). La página guarda cada sesión (`sessions`: estado,
paso, hora); la etiqueta dice "<chat> · <paso>" y, tras un "¡Listo!", `settle()` vuelve a lo que
esté haciendo otro chat. Al pasar el mouse por Nimbo aparece el panel de chats activos (+ GitHub).

**Archivos.** Soltar sobre Nimbo (abre la boca, se lo traga y abre el chat), 📎 o Ctrl+V. Imágenes
≤5 MB van en base64 dentro del mensaje; el resto va por ruta (`webUtils.getPathForFile` en preload)
y el orquestador lo lee con Read: se valida que exista y se agrega `--add-dir` de su carpeta.

**GitHub.** `main.js` corre `gh api notifications` cada 5 min (usa la sesión de `gh`; Nimbo no guarda
claves). Si llega una nueva: gesto + etiqueta. Fila en el panel; clic → github.com/notifications.

**Personalidad.** Saludo al arrancar ("Buenas noches, <prefs.name>"), JARVIS con secuencia de encendido y
barrido de radar en reposo. Clic = abre/cierra chat (espera 280 ms); 2 clics = cariño (corazones);
5 = mareo. En reposo mira alrededor o bosteza (si llevas >1 min sin usarlo). Gestos: `emote(nombre, ms)`
(hello, love, dizzy, yawn, gulp) en la nube (clases `emote-*`) y en JARVIS (`Jarvis.emote`).
Sonidos sintetizados con WebAudio en `SOUNDS` (sin archivos).

**La isla (diseño).** Todo vive en una isla negra que cuelga del borde de arriba (`#wrap` > `#island`,
con `.ear` = esquinas invertidas que la funden con el borde). `layout()` calcula el tamaño: compacta =
personaje + texto medido con `#measure` + puntitos de chats (como una isla dinámica; dormido = píldora
de 96 px); abierta (si alguna tarjeta de `#content` está visible) = 420 px × alto del contenido. Crecer
usa transición con rebote (.52 s, `cubic-bezier(.32,1.22,.42,1)`); encoger, `.closing` (.34 s, sin
rebote). Tarjetas `.box` entran desenfocadas → nítidas con desfase de 35 ms; el panel de chats solo
anima sus filas al abrirse (`.fresh`), si no cada evento las re-animaría y se verían borrosas.
Color del estado en `--sc` (aura `#glow`, brillo inferior de la isla y tarjetas, insignia `#badge`,
puntitos). La etiqueta cambia con `setLabel()` (el texto viejo sube y se apaga) y brilla mientras
trabaja. Parpadeo 70+130 ms cada 2,2–5,4 s con 22 % doble; mirada con `tanh`; al pasar el mouse
parpadea, agranda los ojos y a los 1,9 s se pone cariñoso. Sonidos: `tone()`/`whoosh()` (WebAudio,
volumen maestro 0.12, reverb generada; abrir/cerrar la isla hacen whoosh).
Técnicas tomadas del código MIT de Coucou (github.com/Louis-CFM/coucou); su personaje Mochi, sonidos e
imágenes NO se pueden copiar (LICENSE-ASSETS.md): solo física, tiempos y estructura.

**Recordatorios** (`reminders.js`, autoprueba: `node reminders.js`). Se crean hablando con Nimbo: el
orquestador recibe la hora actual y los pendientes, y devuelve `reminders` (text + due ISO con zona, o
vacío = sin fecha) y `complete` (ids). Se guardan en `%APPDATA%
imboeminders.json`; `main.js` revisa
cada 15 s (`takeDue`) y avisa con tarjeta en la isla (Posponer 10 min / Hecho) + notificación de Windows
(`app.setAppUserModelId("Nimbo")`). Los pendientes salen en el panel al pasar el mouse.

**Vista en vivo** (`#live`, al pasar el mouse): últimos 4 pasos del chat más reciente (✓ / girando / ✕) y
vista previa del paso actual: diff de Edit/MultiEdit (rojo tachado / verde tecleado), Write o terminal de
Bash con la salida de PostToolUse. `hook.js` recorta los textos a 3000 caracteres (no PermissionRequest).

**Archivos soltados**: el personaje sigue al cursor al arrastrar; al soltar, cada archivo vuela a la boca
(`swallow()`, WAAPI con anticipación + aceleración de embudo), traga y mastica. Barra `#progress` mientras
Claude responde (curva rápida→lenta→espera en 92 %, verde al terminar).

**Permiso "Siempre"**: si el payload trae `permission_suggestions`, aparece el botón; `hook.js` responde
`allow` + `updatedPermissions` con esas reglas.

**Panel al pasar el mouse = solo una fila de píldoras** (`appsList`): Chats, Trello, GitHub, WhatsApp y
Pendientes, y solo las que tienen algo (cuenta > 0). El detalle se abre al tocar una, de a una
(`openApp`): "Chats" muestra la lista de chats + vista en vivo; las demás, `#appview`. No volver a
mostrar todo junto al pasar el mouse: abrumaba. `renderApps` no redibuja si nada cambió (se comía clics).
**Apps (píldoras)**: Trello, GitHub, WhatsApp y Pendientes, cada una con mini nube de su color
(`<symbol id="mini">`, `miniCloud()`) y vista propia (`renderAppView`, `--c` = color de marca).
**Trello** (`trello.js`, prueba manual `node trello.js`): no usa claves. Le pide a tu `claude` (que trae el
conector de Trello de claude.ai) las tarjetas pendientes, con `--tools ""` (sin herramientas propias),
`--allowedTools` solo de LECTURA y las de escritura en `--disallowedTools`. Tarda ~50 s: corre 90 s después
de arrancar y cada 30 min (o menú "Actualizar Trello"); caché en `%APPDATA%\nimbo\trello.json`. Avisa si
una tarjeta vence en < 24 h.
**WhatsApp** (`whatsapp.js` + `wa-watch.ps1`), solo lectura, dos niveles:
1. Siempre: el TÍTULO de la ventana de WhatsApp de escritorio (`(3) WhatsApp` → 3 chats sin leer).
2. Opcional (`prefs.whatsappRead`, menú "Leer mensajes de WhatsApp", apagado por defecto): las
   notificaciones de WhatsApp que siguen en el centro de notificaciones de Windows, con la API oficial
   `UserNotificationListener` (PowerShell 5.1 + WinRT). Se agrupan por chat y tu `claude` (modelo haiku,
   ~17 s) las clasifica: trabajo / personal / grupo, `ignore` y `urgent`, según
   `%APPDATA%\nimbo\whatsapp-reglas.txt` (texto libre del usuario; menú "Reglas de WhatsApp").
   Urgente → `.wa-urgent` (isla roja que late, 3 avisos, mensaje 12 s) + notificación de Windows.
- El clasificador corre con `--tools "" --strict-mcp-config --setting-sources project
  --no-session-persistence`: el texto de un mensaje es de un tercero y no debe poder nada (probado con un
  mensaje "ignora tus instrucciones…": lo marcó como spam). `--setting-sources project` además evita que
  dispare los hooks de Nimbo.
- Nada de mensajes en disco. Windows/WhatsApp quitan notificaciones de chats que siguen sin leer, así que
  `remember()` las conserva en memoria hasta que el contador del título llega a 0 (con 1 min de gracia) o
  pasan 24 h. Solo se ve lo que dejó notificación (chats silenciados o con WhatsApp en primer plano no).
- Probado de punta a punta con un mensaje real (2026-10-05): visto a los 2 s, clasificado a los 23 s.
- Quién resume (`brain()`): si Ollama responde en `127.0.0.1:11434` y tiene un modelo de TEXTO pequeño
  (`pickLocal`: llama3.2, qwen, gemma, phi, mistral; el más liviano, < 6 GB), lo hace ese modelo local: sin
  tokens y sin que el texto salga del equipo. Si no, el Claude del usuario (Haiku por el CLI: ~9 s y
  ~3.100 tokens de entrada + ~900 de salida por llamada, casi todo es el andamiaje del CLI). `prefs.waModel`
  lo fuerza ("claude" o un nombre de modelo). Los modelos de visión (minicpm-v, moondream) no sirven:
  minicpm-v ni respondió en 4 min en una GTX 1650.
- Solo se manda al modelo lo NUEVO (`mergeChats` une con lo ya clasificado); ya no hay "headline".
- Los chats los arma el CÓDIGO (`groupChats`: título de la notificación; "Persona @ Grupo" → grupo) y el
  modelo solo devuelve el veredicto de cada uno (`summary`, `kind`, `ignore`, `urgent`; `label()` lo valida).
  Al modelo local se le pregunta un chat por llamada; a Claude, todos numerados en una. No volver a pedirle
  al modelo que agrupe o que devuelva nombres/ids: llama3.2:3b mezclaba chats y marcaba todo urgente.
- Medido el 2026-10-05 con 12 casos inventados (`wa-eval` en el historial): llama3.2:3b en una GTX 1650 →
  urgencia 12/12, todo correcto 10/12, ~1 s por chat (9 s el primero, mientras carga); Haiku → 12/12, 21 s.
- Que se VEA (el usuario creía que no resumía): botón propio en la barra (`#waBtn`: chats que esperan, gira
  mientras resume, rojo si hay urgente; clic = abre el resumen), etiqueta "WhatsApp · resumiendo…" mientras
  trabaja y, al terminar, el resumen sale solo 7 s (`state.busy` / `state.last` / `state.brain`). En la vista:
  quién resumió y "Resumir ahora" (`wa.refresh()`).
- Lo ya visto no vuelve: `dismiss()` (botón "Visto", "Abrir WhatsApp", o cerrar el resumen tras ≥ 2 s a la
  vista: `waViewed()`) guarda los ids en `%APPDATA%
imbowhatsapp-vistos.json` (solo números, sin texto;
  también los ids cuya alarma ya sonó). Al arrancar, lo que seguía pendiente se resume en silencio
  (`state.quiet`). Con lectura activa, el botón y la píldora cuentan chats con resumen sin ver, no el título.
- Respuesta sugerida: campo `reply` del veredicto (va al FINAL del JSON: primero decide, después redacta;
  puesto antes, el modelo local dejaba de respetar los grupos ignorados). Se muestra con "Copiar"
  (`clipboard` en main). Nimbo nunca escribe en WhatsApp.
- `labeled` distingue "Nuevo" (sin resumir) de "Otro" (resumido como otro). `NIMBO_DEBUG=1` imprime el tipo
  de error de Ollama (nunca texto).
- Al depurar, NO imprimir `label.textContent` ni capturar la isla con datos reales: ahí sale el resumen de un
  mensaje privado. Para ver la interfaz, inyectar un estado inventado con `onWhatsapp({...})`.
- En modo mini no se clasifica (el modelo local ocuparía la tarjeta de video mientras se juega); al salir,
  `wa.poke()` se pone al día. El modelo se descarga de memoria a los 3 min (`keep_alive`).
- Las llamadas a `claude -p` de WhatsApp y Trello llevan `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`: sin
  eso, aun con `--no-session-persistence`, cada llamada dejaba un "chat" con título en `~/.claude/projects`
  (y gastaba otra llamada al modelo para titularlo). El usuario lo veía como "cada mensaje se manda a un chat".
- Privacidad, no negociable: sigue APAGADO hasta que el usuario lo active (un clic, sin diálogos extra). Lo
  único que ve los textos es el `claude` del propio usuario; Nimbo no tiene servidores ni telemetría.
  Al depurar, imprimir solo estructura (cuántos chats, tipo, urgente), nunca nombres ni textos.
- Nunca envía, ni marca como leído, ni toca la sesión. Nada de puentes no oficiales tipo
  whatsapp-web.js/Baileys: arriesgan el bloqueo del número. No pasar estos resúmenes al orquestador.
Enlaces: `open-url` solo abre https de trello.com y github.com.
Ojo: los estilos/selectores del personaje van con `#char svg`, no `svg` a secas (hay otros svg en la página).

**Arrastrar por el borde de arriba.** Se agarra de la barra de la isla (no del contenido); < 6 px sigue
siendo clic. La página avisa `drag-start` (ancho de la isla y punto de agarre) y `drag-end`; el bucle del
cursor de `main.js` mueve la ventana y manda `anchor` = `prefs.pos` (0 izquierda … 1 derecha), que la página
pone en `--f`: la isla se alinea dentro de la ventana según `--f`, dejando siempre 14 px a cada lado para sus
esquinas invertidas (`left: 14px + f·(100% − 28px)`; la fórmula del arrastre en `main.js` usa lo mismo).
Animación: se inclina según la velocidad (`--lean`), estela (`#island::after`), cara de emoción y rebote al
soltar. El final del arrastre tiene varias redes (pointerup/mouseup en `document`, move con `buttons === 0`,
`lostpointercapture`, `blur` y un corte a los 30 s en main → `drag-abort`): con una sola se quedaba pegado.

**Plan del día** (`plan.js`): `readPlan` hace `git fetch` + `git show origin/<rama>:<archivo>` en el repo de
`prefs.planRepo/planBranch/planFile` (solo lectura; rama y archivo validados para que no puedan ser opciones de
git; `GIT_TERMINAL_PROMPT=0`). Si no hay red sirve lo último traído. `cleanPlan` valida y recorta: el plan es un
DATO de otra herramienta. `main.js` lo revisa 7 s después de arrancar, cada 30 min y al salir de mini; si la fecha
es distinta de `prefs.planSeen`, lo anuncia (`fresh`): etiqueta + voz, una vez por plan. Píldora "Plan" con
primero lo que tiene propuesta para el usuario. "dame el plan de hoy" (`PLAN_ASK`) se responde en la página al
instante con el plan en memoria, sin llamar a Claude; el chat recibe el plan en el system prompt
(`planForPrompt`) para preguntas de seguimiento. Se dice "Plan de hoy." + el resumen TAL CUAL (el resumen y la
lista a veces no coinciden en las cuentas: el 2026-10-07 el resumen decía 5 y había 3 propuestas `te_necesita`).

**Voz en textos largos.** `speechParts` parte lo que pasa de 140 letras en frases de ~110 y las dice en orden,
pidiendo cada una mientras suena la anterior (nunca todas a la vez: el proveedor respondió 401 un rato tras
varias llamadas simultáneas): el servicio tarda ~25 ms por letra (8 s para 300), así empieza a los 2 o 3 s. Cada
parte se pide una vez; si una falla, ahí se calla. Ojo con la cuota del proveedor: cada letra dicha cuenta (el
plan diario son ~220 letras). Cuando la cuota se acaba el servicio responde 502 y Nimbo sigue en silencio.
Para probar el orden de las partes sin gastar cuota, un servicio de mentira que devuelva un WAV.

**Ver la pantalla** (botón 🖥 del chat → IPC `screenshot` en `main.js`): UN pantallazo de la pantalla donde
está el cursor (`desktopCapturer`, reducido a 1568 px de lado, JPEG ~80 KB, ~1,3 s). Vuelve a la página como
una imagen más (`images`, con `screen: true`) y viaja por el mismo camino que una imagen pegada; no se manda
hasta que el usuario envía. `setContentProtection(true)` durante la captura saca a Nimbo de su propia foto
(probado pintando la ventana de rojo: 25 píxeles rojos de 1 millón). Nada automático ni en vivo, y así debe
seguir: nunca capturar por palabras del mensaje ni por temporizador. Con una captura, el orquestador puede
responder hasta en 5 pasos (regla en `systemPrompt`). Al probar, no abrir la imagen: es la pantalla del usuario.

**Voz** (`tts.js`, `speak()`/`stopSpeaking()` en `index.html`): Nimbo dice su respuesta corta (`r.text` en
`askAndShow`; nunca los prompts de `dispatch`). La página pide el audio por IPC (`tts`) y `main.js` hace el
POST a `prefs.ttsUrl` con `{text}` o `{text, voz: "nube"}` según `prefs.theme` EN ESE MOMENTO, así que
cambiar de tema cambia la voz sin reiniciar. Devuelve el mp3 y la página lo reproduce desde un blob (el CSP
ya permite `media-src blob:`; la página no llama a nadie). Interruptor `prefs.speak` (menú y Conexiones).
Se corta (`stopSpeaking`) con: otra pregunta o respuesta, empezar a dictar (`voice.js`), cambio de tema, voz
apagada (`voice`), sonidos silenciados. null = silencio: voz apagada, modo mini, sin `ttsUrl`, HTTP distinto de
200, respuesta que no es audio, sin conexión o más de 10 s. Una llamada por respuesta, sin reintentos.
`speechText` quita emojis/formato y corta en un punto hasta 1500 caracteres. La dirección del servicio va en
`prefs.json`, NUNCA en el código (repo público: sería la cuota de voz del autor y los textos de otros
pasarían por su servidor). Probado el 2026-10-05 con un servicio de mentira (503, 502, 413, no-audio, colgado,
apagado) y con el servicio real en los dos temas; no se puede comprobar por código que las voces suenen
distintas: el servicio no es determinista, hay que oírlo.
`examples/tts-service/` es un servicio de ejemplo (función de Vercel → ElevenLabs, claves por variables de
entorno) con el mismo contrato; su autoprueba no usa red. No va dentro del instalador.
La fila "Apariencia" de Conexiones cambia de tema (`setup-do theme`): sirve también para probar por CDP.

**Tamaños.** La isla nunca pasa de `MAX_W` = 412 (ventana 440 − dos esquinas invertidas de 14): más ancha, la
ventana la recorta y pierde las curvas (pasó al agrandar el personaje). Personaje 120×70 (`#char`), barra de 68 px (`BAR_H` en JS y `#bar`/`#content` en CSS: van
juntos). El modelo ocupa ~60 % de su caja: por eso la caja es más alta que la barra.

**Opciones sin clic derecho.** `buildMenu()` arma el menú en el momento; sale con clic derecho, con el botón ⋮
del extremo derecho de la barra (`#menuBtn`, visible al pasar el mouse) y con el icono de la bandeja (`createTray`,
`assets/icon.png`; Windows 11 lo deja en el desbordamiento, la flechita). `NIMBO_DEBUG=1` imprime dónde quedó.

**Firma del instalador.** Sin firmar, Windows muestra SmartScreen; no hay atajo. Camino elegido: SignPath
Foundation (gratis para código abierto; el certificado sale a nombre de ellos). Requisitos ya cubiertos: licencia
MIT, compilación automática (`.github/workflows/build.yml`: al publicar una versión arma el instalador y lo
adjunta), nombre y versión en el ejecutable, `PRIVACY.md` y la sección "Firma del instalador" del README. Falta
lo que solo puede hacer el autor: activar la verificación en dos pasos en GitHub y enviar la solicitud. Al
aprobarla se agrega el paso de firma al workflow y la frase de atribución que ellos exigen. Azure Artifact
Signing no sirve: para personas solo está en EE. UU. y Canadá.

**Modo mini** (Ctrl+Alt+N o menú): 100×60 en la esquina elegida (se guarda), sin sonidos ni
tarjetas; tocarlo lo devuelve. **Temas**: JARVIS (por defecto) o Nube, en el menú.

**Conexiones y ajustes** (`#setup`, menú o primera vez con `prefs.onboarded` en false): una fila por conexión
(Claude Code, nombre, GitHub, Trello, WhatsApp, iniciar con Windows) con punto verde/ámbar y su botón.
`main.js`: `setup` devuelve el estado y `setup-do` ejecuta UNA acción de una lista fija (la página nunca manda
URLs ni rutas; "Guía" abre la sección "Conectar todo" del README en el idioma de la interfaz). Los hooks se instalan desde ahí con `install-hooks.js` (`status/install/uninstall`).

**Instalador** (`npm run dist`, electron-builder, NSIS por usuario → `dist/Nimbo-Setup.exe`, sin firmar).
`asar: false`: `hook.js` tiene que ser un archivo real y el código queda editable. La app instalada no exige
Node: `hookCommand()` escribe `%APPDATA%\nimbo\hook.cmd`, que corre `hook.js` con el propio `Nimbo.exe` en modo
Node (`ELECTRON_RUN_AS_NODE=1`); en desarrollo el hook es `node hook.js`. Si la ruta cambió, el panel dice
"Reconectar" (`hooks: "stale"`). Al DESINSTALAR (no al actualizar), `build/installer.nsh` corre
`install-hooks.js --uninstall` con el propio exe: sin eso Claude Code quedaba llamando a un programa borrado.
Probado en real el 2026-10-05: instalar en silencio (`/S`), conectar, recibir eventos, desinstalar; los datos
de `%APPDATA%
imbo` se conservan. El instalador se sube como asset del release de GitHub.

**Video y GIF** (`promo/`): `npm run promo` (mp4 con textos) y `npm run promo:gif` (el GIF del README). Cargan el
`index.html` REAL en una ventana fuera de pantalla con una API falsa (`promo-preload.js`, un Proxy: lo que se
agregue a `preload.js` no los rompe) y un guion. No muestran ventanas ni tocan `%APPDATA%\nimbo`.
README en inglés (`README.md`) y español (`README.es.md`): al cambiar uno, cambiar el otro.

**Idiomas (español / inglés).** Los textos van en ESPAÑOL en el código, envueltos en `t("…")`; `i18n.js` trae
el inglés con el texto en español como clave (`{0}`, `{1}` = valores). Idioma = `prefs.lang` (menú "Idioma /
Language") o, si no hay, el de Windows. `main.js` se lo pasa a la página en la URL (`?lang=en`); cambiarlo
recarga la página. El HTML fijo (botones, títulos) se traduce solo al cargar y los dos textos del CSS llegan
como variables (`--t-ask`, `--t-drop`). También siguen el idioma: el dictado (Whisper), las respuestas del
orquestador, los resúmenes de WhatsApp y sus reglas de ejemplo. Al agregar un texto: `t("en español")` + su
línea en `i18n.js`; `node i18n.js` (parte de `npm test`) falla si falta alguna. Los videos de `promo/` cargan
la página sin `?lang` (español).

## Seguridad (no deshacer)
- Servidor solo en `127.0.0.1`, y solo acepta `Host: 127.0.0.1:47823` (corta DNS rebinding). Cada
  mensaje va firmado con HMAC-SHA256 y un nonce que se acepta una sola vez; la respuesta de permiso
  también va firmada y `hook.js` la verifica (nadie puede suplantar a Nimbo en el puerto).
  Secreto aleatorio por arranque en `%APPDATA%\nimbo\token`; una segunda instancia sale antes de pisarlo.
- La tarjeta de permiso muestra TODO lo que se aprueba (comando completo con scroll, contenido de
  Write/Edit, y las reglas que dejaría "Siempre"). No volver a recortarla: con 4 líneas, una cola
  maliciosa quedaba oculta. La decisión viaja con el id de su tarjeta (`rid`).
- `claude.exe` y PowerShell se lanzan directo (sin `shell: true`); el texto del usuario va por stdin.
- Todo `claude -p` que lee texto de terceros lleva lista cerrada de herramientas: orquestador
  `Read,Glob,Grep` sin MCP; Trello sin herramientas propias y conector en lectura; WhatsApp sin nada.
  Solo `dispatch` (con clic del usuario) puede cambiar cosas.
- Protocolo `nimbo://` solo sirve archivos dentro de esta carpeta (bloquea `../`).
- Ventana: `contextIsolation`, `sandbox`, sin `nodeIntegration`; navegación y `window.open` bloqueados.
  En la página no se usa `innerHTML`: todo texto externo entra con `textContent`/`el()`.
- Permisos del navegador: solo micrófono (audio); cámara y lo demás, denegados.
- Nimbo no guarda claves ni tokens de nadie: GitHub vía `gh`, Trello vía el conector de `claude`.
- Pendiente conocido: el script va en línea en `index.html`, así que el CSP lleva `'unsafe-inline'`.

## Estado en disco
`%APPDATA%\nimbo\`: `token`, `prefs.json` (`corner`, `theme`, `pos`, `name`, `vault`, `lang`, `whatsappRead`, `waModel`, `onboarded`, `speak`, `ttsUrl`, `planRepo`, `planBranch`, `planFile`, `planSeen`), `reminders.json`, `trello.json`, `whatsapp-reglas.txt`, `chat\` (cwd del orquestador),
caché del modelo Whisper (Cache Storage del origen `nimbo://app`, ~76 MB).

## Lecciones (cosas que ya fallaron)
- `file://` no permite workers de tipo módulo → por eso el protocolo `nimbo://` (+ COOP/COEP para hilos).
- `transformers.web.min.js` importa paquetes por nombre; usar `transformers.min.js` (autocontenido).
- npm puede dejar `onnxruntime-web` dentro de `@huggingface/transformers/node_modules`; el worker
  busca el runtime en ambas rutas.
- En un worker de módulo, nada de `await` suelto al inicio: los mensajes que llegan antes de
  definir `onmessage` se pierden y el dictado se cuelga.
- Electron en Windows no expone las voces del sistema a `speechSynthesis` (lista vacía).
- WebGPU solo ve la GPU Intel; forzar la NVIDIA (`--force_high_performance_gpu`) fue más lento.
- Medidas (frase de 4 s, PC libre): whisper-base CPU ~2,5 s; whisper-small 8,5 s (GPU Intel) / 13,5 s (CPU).
  Con un juego abierto todo es 3–4× más lento.
- `--permission-mode auto` en chats despachados: lanzarlo desde otra sesión de Claude Code lo
  bloquea el clasificador; desde Nimbo lo lanza el usuario con su clic.
- En SVG, `display:none` en un grupo NO detiene las animaciones de sus hijos: las de una sola vez
  (estrellitas, corazones) se activan con la clase del estado/gesto, si no ya terminaron al cargar.
- En `#island` va `overflow: clip`, no `hidden`: con hidden, enfocar el campo del chat desplazaba la isla y la
  nube desaparecía.
- Para esconder la cara en un gesto se usa `#nimbo:where(...)`: con más especificidad que las reglas
  que muestran la cara del gesto, la cara desaparecía entera.
- `location.reload()` puede servir archivos viejos del protocolo `nimbo://` (aunque haya `no-cache`):
  para probar cambios, reiniciar Electron completo.
- Al parchear con `String.replace(a, b)`, un `$'` o `$&` dentro de `b` es un patrón especial (duplicó medio
  `main.js`): usar siempre `replace(a, () => b)`.
- Las pruebas por CDP del arrastre mueven la ventana hacia el cursor REAL (main usa
  `screen.getCursorScreenPoint()`), y cambian `prefs.pos`: restaurarlo al terminar.
- Al escribir rutas de Windows en `prefs.json` desde un script, ojo con las barras: `"D:…"` sin escapar
  guardó un tabulador vertical y el vault estuvo roto sin avisar. Verificar con `fs.existsSync`.
- Nada personal en el código: nombre, vault y rutas van en `prefs.json`. El repo es público.
- Se quitaron: modo conversación por voz, Piper/voz de Windows y whisper-small (lentos en este equipo).

## Limitación conocida del orquestador
`dispatch` escribe en la transcripción del chat con `claude -p --resume`, pero la **app de
escritorio no muestra esos turnos** en una ventana abierta, y si el usuario sigue escribiendo
ahí, la conversación continúa desde su último punto (rama aparte; ese Claude no "sabe" lo que
hizo Nimbo, aunque los cambios en disco sí están). Los chats de la app que viven en
`scratch-workspaces` no aparecen en la lista. La forma nativa de que los
mensajes se vean en vivo es la mensajería entre sesiones de la propia app, que solo puede usar
una sesión que corre dentro de la app (no Nimbo). Por eso el orquestador "de verdad" es un chat
de la app en su propia carpeta, que reparte con `ListAgents`/`SendMessage`; el chat de Nimbo queda
para preguntas rápidas, recordatorios y el vault.

## Probar cambios
1. `taskkill /F /IM electron.exe`, luego `npx electron . --remote-debugging-port=9477` y evaluar
   en la página por CDP (`Runtime.evaluate`).
2. Al terminar, cerrar esa instancia y relanzar con `Nimbo.lnk`: el puerto 9477 NO debe quedar
   abierto y no hay que dejar estilos de prueba (fondo oscuro, zoom) en la ventana del usuario.
   El puerto de depuración NO puede ser 9333 ni 9222: otra sesión de Claude que automatiza un navegador se
   conectó a ese puerto y navegó la ventana de Nimbo a su propia página. Usar uno raro (9477) y cerrarlo.
3. No mover el mouse ni hacer clics reales del usuario sin preguntar (puede estar jugando).
4. Tras tocar `orchestrator.js`, probar `ask` sin variables `CLAUDE*`/`ANTHROPIC*` del entorno
   (si no, `claude` usa la cuenta de la sesión que lo lanzó).

# Nimbo

Compañero flotante de Claude Code para Windows (Electron). Vive arriba al centro de la
pantalla, reacciona a lo que hacen las sesiones de Claude Code (varias a la vez, con el título
de cada chat), deja aprobar permisos, chatear con Claude (imágenes, archivos soltados encima y
dictado), avisa de notificaciones de GitHub y tiene personalidad: saludo, gestos y sonidos.
Solo Windows 10/11. Interfaz en español. Instalación y uso para personas: `README.md`.

## Estado y siguiente paso (2026-10-14)
Si existe `HANDOFF.md` (local, no se sube a GitHub), léelo PRIMERO: trae el contexto del dueño y lo que está abierto.
- **Publicado:** 0.8.0 (release de GitHub con instalador compilado por CI). La rama `multiplataforma` (Linux y macOS en vista previa, GIF nuevo, prueba de humo) está subida y probada en el CI pero NO fusionada ni publicada.
- **Hecho:** hooks y permisos, chat y orquestador, recordatorios, GitHub, Trello por tableros, WhatsApp de solo lectura, voz, plan del día, ver la pantalla, Spotify (tarjeta, búsqueda, Premium), barra flotante de música, entrenador de entrevistas, Telegram (chat, bandeja, avisos), otras IAs (Ollama de un clic, Gemini, OpenAI), correo de Gmail a pedido (botón ✉), chats en Sonnet, instalador, CI, español e inglés.
- **Sin verificar con uso real:** el instalador instalado (último probado de verdad: 0.3.2), la bandeja de Windows y el botón ⋮, arrastrar la barra de música y que recuerde su sitio, dictado/chat/WhatsApp en inglés, el sonido de las dos voces, `scripts/promo/promo-main.js`; las otras IAs con un modelo REAL (el Ollama del dueño no tiene ninguno y él pidió no descargarlo), y los avisos al celular, `/pendiente` con el PC apagado y `/correo` con su bot real (probados con un Telegram de mentira).
- **Abierto:** firma del instalador (SignPath la RECHAZÓ el 2026-10-13: ver "Firma del instalador"); `app.js` tiene ~1.830 líneas y conviene partirlo por piezas y probando; regenerar el GIF y el video del README con la interfaz nueva.
- **Ideas para después:** aprobar permisos de Claude Code desde Telegram, copiloto de reuniones y clases (audio del sistema con `setDisplayMediaRequestHandler` `audio: "loopback"` + el Whisper de `stt-worker.js`; SIN modo oculto para entrevistas reales), vigilar otros agentes (Codex, Cursor, Gemini CLI), uso del plan de Claude, atajos editables, más idiomas, web app para iPhone sobre Tailscale (no hay Mac). Wazend/WhatsApp automático: DESCARTADO (cuesta).

## Convenciones del dueño
- Nada de claves ni datos personales en el repo (es público); lo suyo va en `%APPDATA%\nimbo\prefs.json`.
- **Cada cambio se guarda Y se sube** (decisión del dueño, 2026-10-27): commit + `git push` a la rama `multiplataforma` tras cada cambio que funcione,
  para no perder nada. Versión 0.9.x (0.9.1, 0.9.2…, se sube el número en `package.json`); **NUNCA pasar a 1.0 ni publicar un release** hasta que él lo diga.
  Commits con el correo noreply de GitHub.
- Nunca reescribir `prefs.json` ni `package.json` con PowerShell 5.1 (`Get-Content`/`Set-Content` cambian la codificación: un BOM dejó a Nimbo de fábrica y
  borró sus ajustes; las tildes de `package.json` se dañaron). Editar con Node o con la herramienta de edición.
- Trabajo fácil con Sonnet, difícil con Opus: avisarle ANTES de empezar lo difícil. Cuidar el costo de las pruebas que llaman
  a `claude -p` con datos reales (una consulta con Opus costó ~1 USD).
- No mover el mouse ni hacer clics reales en su PC sin preguntar.

## Arrancar
- `npm start` (o el acceso directo `Nimbo.lnk` en la carpeta Inicio de Windows, que arranca
  `node_modules\electron\dist\electron.exe "<carpeta de nimbo>"` al iniciar sesión).
- Hooks de Claude Code: `npm run install-hooks` / `npm run uninstall-hooks`. Escribe en
  `~/.claude/settings.json` con backup fechado `settings.json.bak-*`. Si se mueve la carpeta,
  hay que reinstalarlos (guardan la ruta de `hook.js`).

## Carpetas
```
hook.js              lo ejecuta Claude Code. SE QUEDA EN LA RAÍZ: su ruta está escrita en ~/.claude/settings.json
                     de cada usuario (y en hook.cmd); moverlo dejaría a todos desconectados.
src/main/            proceso principal: main.js, preload.js, orchestrator.js, install-hooks.js, reminders.js, plan.js, tts.js
src/integrations/    conexiones: whatsapp.js + wa-watch.ps1, trello.js, spotify.js, spotify-api.js, media.js + media-watch.ps1
src/renderer/        la isla: index.html (solo el HTML), styles.css, app.js, jarvis.js, voice.js, stt-worker.js
src/shared/          i18n.js (lo usan la página y el proceso principal)
scripts/promo/       generadores del video y el GIF (no van en el instalador)
docs/media/          el GIF y el video del README
assets/ build/ examples/ .github/
```
- En el resto de este documento los archivos se nombran sin carpeta (`main.js`, `trello.js`…); la carpeta es la de arriba.
  Las autopruebas se corren con su ruta: `node src/integrations/trello.js` (o todas con `npm test`).
- `ROOT` (en `main.js`) es la carpeta de Nimbo. El protocolo `nimbo://app/` sirve desde `ROOT` (la página necesita
  `node_modules` para Whisper), así que la página es `nimbo://app/src/renderer/index.html`. El origen sigue siendo
  `nimbo://app`: la caché del modelo de voz no se pierde.
- Lo que el código de la página era un `<script>` en línea ahora es `app.js`, UN solo archivo a propósito: partirlo en
  varios `<script>` cambia el orden de carga (las funciones dejan de estar disponibles entre archivos y pueden llegar
  eventos de `main` entre uno y otro). Si se parte, hacerlo por piezas que solo declaren cosas y probar cada una.
- Reordenado el 2026-10-11 (0.7.0 → siguiente). Probado: autopruebas, app en desarrollo (página, dictado, hooks de punta
  a punta, Spotify, Trello, plan) y la app EMPAQUETADA (`electron-builder --dir`, arrancada con `--user-data-dir` aparte).

## Archivos
| Archivo | Qué hace |
|---|---|
| `main.js` | Proceso principal: ventana, protocolo `nimbo://`, servidor de hooks, permisos, menú, modo mini, zonas tocables, permiso de micrófono. |
| `preload.js` | Puente IPC (`window.nimbo`). Todo lo que la página usa de `api.*` sale de aquí. |
| `index.html` + `styles.css` + `app.js` | La isla: el HTML (con el SVG del tema Nube), sus estilos y su código: estados, chat, tarjeta de permisos, propuestas del orquestador, vistas de cada píldora. Donde este documento dice "en `index.html`" para código, hoy es `app.js`. |
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
| `trello.js` | Tableros y tarjetas de Trello vía el conector de tu `claude` (solo lectura, bajo demanda). |
| `spotify.js` | Buscar canciones vía el conector de Spotify de tu `claude` (solo búsqueda). |
| `spotify-api.js` | Spotify con Premium (opcional): Web API con PKCE para buscar al instante y poner a sonar la canción elegida. |
| `platform.js` | Lo que cambia por sistema operativo: carpeta de datos, dónde están `claude` y `ollama`, PATH. |
| `ai.js` | Otras IAs en el chat: Ollama, Gemini, OpenAI con un solo adaptador (+ imágenes de Gemini). |
| `delegate.js` | Encargos de Claude a Gemini: validación y carpeta de imágenes. |
| `claude-api.js` | Motor API de Claude (SDK oficial): salida estructurada, adjuntos, errores; lo usan el chat y los resúmenes de WhatsApp si eliges ese motor. |
| `mail.js` | Correo importante de tu Gmail por el conector de tu `claude` (solo lectura). |
| `alerts.js` | Avisos al celular por Telegram (filtrados: trabajos largos, lejos del PC). |
| `remote-api.js` | API para Nimbo en el iPhone (la app del asistente, por su puente): estado de los chats, permiso pendiente, pendientes, hablar con Nimbo y mandar sus encargos (`node remote-api.js` = autoprueba). |
| `options.js` + `options-preload.js` + `options.html/css` + `options-page.js` | Ventana de opciones (⋮ y clic en el icono del reloj; clic derecho sigue siendo el menú rápido): secciones con cada ajuste explicado y conexiones con guía paso a paso. Los ajustes salen de `menuTemplate()` (cada entrada con `id`), así menú y ventana nunca se desincronizan; las conexiones usan `setup`/`setup-do`. |
| `media.js` + `media-watch.ps1` | Lo que suena en CUALQUIER reproductor (Spotify primero; Apple Music, navegador…), sus botones, en qué segundo va (`time:`) y saltar (`seek:<s>`), con los controles multimedia de Windows. |
| `lyrics.js` | Letra sincronizada de LRCLIB, solo al tocar «Letra» (`node lyrics.js live` pregunta de verdad). |
| `volume.js` + `volumen.cs` | Volumen de la app que suena (el del mezclador de Windows, no el general); el ayudante lo compila `windows.js` con el csc de Windows. |
| `platino.js` | Pastilla «Logros»: lee la app Platino (contrato en `<prefs.platinoDir>\CONTRATO-NIMBO.md`): catálogo y guías de `platino-smoky.vercel.app/games/<appid>.json` + progreso local `progress.<appid>.json`, unidos por `id`. Solo lectura; las guías se muestran tal cual. «Actualizar» corre `tools/fetch-steam.mjs` en la carpeta de Platino. |
| `google.js` | Tu Google directo (no los conectores de Claude, que son de otra cuenta): OAuth de app de escritorio con PKCE y vuelta a `127.0.0.1:47823/google`. Proyecto de Google Cloud del dueño `nimbo-512907` (en prueba, él es usuario de prueba: el permiso puede vencer a los 7 días hasta publicar la app). ID en `prefs.googleClientId`; secreto + token de renovación cifrados en `google.bin`. Permisos: `drive.file` (solo lo que crea Nimbo) y `calendar.events`. Pastilla «Agenda» y carpeta «Nimbo e Instinct» (`prefs.googleBridge`). |
| `instinct.js` | Instinct ↔ Nimbo por la carpeta de Drive: «Para Nimbo» (Instinct escribe `2026-10-27 [tarea] texto`; etiquetas nota/idea/tarea/calendario/pedido) y «De Nimbo» (Nimbo escribe, solo con clic). SIN revisar cada tanto: Drive `files.watch` avisa a un tema de ntfy.sh con nombre aleatorio (`prefs.instinctTopic`) y Nimbo escucha ese tema con una conexión quieta; el aviso se renueva una vez al día. Pastilla «Instinct»: a pendientes, pasárselo a Claude (al chat, tú lo envías), listo, y escribirle a Instinct. |
| Isla de música (`app.js`, `musicMode`) | Botón ⤢ o «Letra» en la tarjeta de música: Nimbo se minimiza y queda solo la música (avance, letra, volumen); se arrastra y un clic en ella devuelve a Nimbo. Reemplazó a la barra flotante de música (musicbar.js, borrada en 0.9.7). |
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
- **Rendimiento (2026-10-14; el dueño se quejaba de que Nimbo "se quedaba quieto")**: (1) Las transcripciones llegan a 125 MB y se leían ENTERAS en el proceso
  principal (`listSessions` en cada pregunta y `sessionTitle` cada minuto desde cada hook): ~0,8 s congelados cada vez, y con ellos el bucle del cursor, el
  servidor de hooks y la isla. Ahora `listSessions` es async, lee solo cabeza (128 KB) y cola (1 MB) (medido: cwd a <53 KB del principio; título y último pedido a <31 KB
  del final), recuerda lo ya leído por mtime+tamaño, y las carpetas extra (`dirs`) se cuentan sobre TODO el archivo pero en trozos de 1 MB cediendo el turno y de forma
  incremental (`scanDirs`: solo lo agregado; resultado idéntico al de leer todo, comprobado con tus transcripciones reales). `sessionTitle` lee solo los últimos 256 KB.
  Peor pausa del hilo ahora: ~26 ms. Autoprueba: `node src/main/orchestrator.js`. (2) `ask` lleva `--setting-sources project`: sin tus plugins/hooks/habilidades una
  pregunta tarda ~7 s en vez de ~14 s (medido en la app real). Consecuencia: esas preguntas ya NO disparan los hooks de Nimbo, así que `askAndShow` pone
  los gestos de la isla (pensando, "¡Listo!", error). NO usar `--setting-sources project` en Trello/correo/Spotify: sin tus ajustes de usuario el `claude` NO ve los
  conectores de claude.ai (probado: Spotify respondió `connected:false`). (3) Mientras se espera, la caja muestra "Pensando… / Sigue trabajando… N s" y un botón
  **Cancelar** (`ask-cancel` → `orchestrator.cancel()` mata el `claude -p`); `runClaude` tiene `timeoutMs` (pregunta 3 min, entrevista y Spotify 2 min, correo 4,
  Trello 5, WhatsApp 3; por defecto 10) y devuelve un mensaje claro si vence.

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
**Trello** (`trello.js`, autoprueba `node trello.js`; con datos reales `node trello.js live [haiku|default]`, ojo: CUESTA, con
`default` ~0,85 USD): no usa claves. Dos consultas a tu `claude` (conector de Trello de claude.ai; `--tools ""`, solo
lectura, los demás conectores fuera): `refreshBoards()` = lista de tableros (Haiku, ~19 s, ~0,06 USD; sola una vez al
día: `refreshTrelloIfStale` a los 90 s de arrancar y y cada 15 min si lo último pasa de 20 h; si falla, 3 intentos seguidos y luego espera 6 h. El 2026-10-13 la consulta del arranque no dejó nada, probablemente sin red recién encendido el PC; y si `claude mcp list` no responde, trello.js NO llama (no podría excluir los demás conectores)) y
`refreshBoard(url)` = TODAS las tarjetas abiertas de ese tablero (Haiku, ~53 s, ~0,11 USD, al tocarlo; la dirección debe
estar en la lista conocida y cumplir `BOARD_URL`). El modelo solo copia: qué es pendiente lo decide el código
(`isDoneList`: Hecho/Done/Completado/Probadas/Épicas/Guía…; `done` por tarjeta). Antes una sola consulta pedía "las 8
pendientes" y el resultado cambiaba entre corridas (35, 52 y 15 tarjetas para el mismo tablero) y costaba ~1,30 USD con
el modelo por defecto; Haiku elegía peor. Caché `%APPDATA%\nimbo\trello.json` `{at, boards, byBoard}` (el formato viejo se
descarta). En la página: píldora con los tableros → lista → tablero (volver, Actualizar); `trello-busy` manda las claves
en curso. El aviso de "vence en < 24 h" solo mira tableros ya abiertos. El video/GIF de `scripts/promo/` usa el formato viejo
(`window.__trello`): al regenerarlos, actualizar ese dato.
**Linux y macOS** (vista previa, 2026-10-14; Windows sigue siendo el sistema principal): `src/main/platform.js` concentra lo que cambia por sistema (carpeta de datos = la
MISMA que `app.getPath("userData")`, dónde está `claude` y `ollama`, PATH ampliado en macOS/Linux porque una app gráfica arranca con un PATH mínimo). Lo exclusivo de Windows
queda desactivado, no roto: WhatsApp (lee las notificaciones de Windows; `wa.watch` no hace nada y el panel dice "solo Windows"). Música: Windows = PowerShell/SMTC;
Linux = `playerctl -p spotify`; macOS = AppleScript (`osascript`, pide permiso de Automatización). El poller (`pollingWatcher`) está probado con piezas falsas; la carátula se
baja solo de hosts de Spotify, PNG/JPEG ≤ 400 KB. Hooks: `hook.cmd` (Windows) / `hook.sh` (macOS y Linux: el .app y el .deb tienen ruta fija y corren hook.js con su
ejecutable en modo Node; un AppImage se monta en otra carpeta cada vez, así que copia hook.js a la carpeta de datos y usa el `node` del sistema). `hook.js` calcula
la carpeta del token con `platform.userDataDir()`. Linux: autoinicio con un `.desktop` en `~/.config/autostart`; el AppImage arranca con `--no-sandbox` (Ubuntu 24.04
bloquea el sandbox sin SUID). macOS: `LSUIElement` (sin Dock), `setVisibleOnAllWorkspaces`, firma ad hoc en `build/after-pack.js` (sin ella los Mac con chip Apple dicen
"dañada"; con ella dicen "desarrollador no identificado": clic derecho → Abrir). Empaquetado: AppImage + deb (nombres fijos `Nimbo-linux-x64.*`) y dmg x64 + arm64 (`Nimbo-mac-<arch>.dmg`);
el icono de 512 px (`build/icon-512.png`) es el de 256 agrandado: conviene rehacerlo con más resolución.
**Probar en otros sistemas SIN tenerlos:** `.github/workflows/build.yml` corre en `windows-latest`, `ubuntu-latest` (con xvfb) y `macos-latest`: `npm test`, `scripts/smoke.js` (arranca la
app de verdad, comprueba la página, el panel, el servidor de hooks y que un evento REAL de hook llegue a la isla) y el empaquetado; en Linux y Mac también contra el paquete
INSTALADO (.deb, .app). `NIMBO_SMOKE_EXE` apunta al ejecutable instalado; en el CI (`CI=true`) usa las carpetas normales, en tu PC datos temporales (y cierra Nimbo antes: usa el puerto 47823).
Para probar una rama sin publicar: subirla y `gh workflow run build.yml --ref <rama>`. SIN probar con uso real: arrastre y transparencia en escritorios Linux, `playerctl`, los permisos de macOS,
el Dock/Spaces, y que Gatekeeper deje abrir el .dmg descargado.
**Otras IAs** (`src/integrations/ai.js`, `node src/integrations/ai.js` = autoprueba con servidores de mentira en tu PC): UN solo adaptador del protocolo
"chat/completions" de OpenAI para Ollama (`http://127.0.0.1:11434/v1`, sin clave, modelo = `pickLocal` o `prefs.aiModels.ollama`), Gemini
(`.../v1beta/openai`, modelo por defecto `gemini-2.5-flash`) y OpenAI (`gpt-4o-mini`): los nombres de modelo envejecen, se cambian en `prefs.aiModels`.
`prefs.chatProvider` elige cuál habla; el selector del chat (`#ai`) aparece cuando hay más de uno y `ask` (main) enruta: con adjuntos SIEMPRE va a
Claude; sin ellos, a la IA elegida (historial solo en memoria, 12 mensajes, se borra con "Nueva conversación"). Solo conversación: ni archivos, ni
recordatorios, ni `dispatch`. Las claves de Gemini/OpenAI van cifradas con `safeStorage` en `ai-keys.bin` (JSON), se verifican con `GET /models` antes de
guardarse y nunca salen en un error. Probado con el adaptador y servidores falsos, la UI y rechazo de claves; **Ollama de un clic para quien llega nuevo** (fila "Otras IAs"): sin Ollama → "Instalar Ollama" (abre ollama.com/download, nunca ejecuta nada); instalado y cerrado → "Abrir Ollama" (`ollama app.exe` en `%LOCALAPPDATA%\Programs\Ollama`); sin modelo → "Descargar modelo gratis (≈2 GB)": `pullModel` (`POST /api/pull`, avance en NDJSON, % en el panel, cancelable) SOLO con el clic y SOLO el modelo `RECOMMENDED` = llama3.2:3b (el nombre lo fija main, nunca la página). Probado el protocolo con un servidor falso y contra el Ollama real con un modelo inexistente (entiende el error, no descarga). SIN probar una descarga completa ni una respuesta de un modelo real: el Ollama del dueño NO tiene ningún modelo (ya no está llama3.2:3b: los resúmenes de WhatsApp caen a Claude) y no hay claves; él pidió NO descargarlo por él.
**Ideas de Coucou aplicadas** (2026-10-22; Coucou ya tiene versión para Windows/Linux/Android, 14 idiomas, GitLab/Gitea, WhatsApp por GOWA — un puente NO oficial, por eso NO se copia —, "recap" semanal, reloj opcional, Conductor y chats de Claude Desktop; su código es MIT, su Mochi, sonidos e imágenes no):
(1) **Versiones nuevas** (`src/main/updates.js`, autoprueba con un GitHub de mentira y probado contra la API real: GitHub ya publica el `digest` sha256 de cada archivo): `prefs.updateCheck` (undefined = se pregunta UNA vez con un cuadro nativo; en el CI y en
`NIMBO_SMOKE_EXE` no se pregunta), consulta `releases/latest` a los 45 s y cada 6 h, tarjeta "Nimbo X ya salió" con las notas (`showUpdate`), "Más tarde" calla un día (`prefs.updateLater`), menú (⬆ Actualizar, Buscar actualizaciones, Avisarme). `update-install`: en Windows con la app
empaquetada baja `Nimbo-Setup.exe` SOLO de `github.com/FedericoChalaca/nimbo/releases/download/vX.Y.Z/`, verifica el SHA-256 (sin digest o dirección rara: abre la página y no instala nada; hash distinto: borra el archivo) y lo abre (NSIS `oneClick` reemplaza y vuelve a abrir); desde el código o en
Linux/macOS abre la página. `prefs.lastVersion` + `showWhatsNew`: tras actualizar, tarjeta con las notas de la versión. NO probado con un instalador real publicado (todavía no hay una 0.9.0).
(2) **Silencio si estoy mirando** (`src/main/foreground.js`, `prefs.quietWhenWatching`, activado por defecto): en el evento `Stop`, después de contestar el hook, se pregunta qué proceso tiene el foco (PowerShell con `GetForegroundWindow`, ~0,5 s; `osascript`; `xdotool`) y, si es una terminal, un editor o `claude`
(app de escritorio), `payload.watching = true` y la página no suena (solo cambia de estado, 2,5 s). Es por proceso, no por la ventana exacta de la sesión. (3) La tarjeta de permisos pone `plan` (ExitPlanMode) como texto principal. Pendiente de Coucou que NO se hizo: reloj en la isla, resumen semanal ("recap"), más idiomas, GitLab/Gitea,
"alertas de todas las píldoras", chats de Claude Desktop (Accesibilidad).
**Motor API de Claude** (`src/integrations/claude-api.js`, autoprueba `node src/integrations/claude-api.js` con un servidor de mentira + el bloque final de `node src/main/orchestrator.js`; 2026-10-21; el dueño tiene
Claude Max 20x con 200 USD/mes en créditos de API, que hay que vincular a una organización de la Consola): `prefs.engine` = "" (Suscripción: `claude -p`, lo de siempre) o "api" (menú "Motor de Nimbo"; solo se puede elegir con la clave guardada).
Usa el SDK OFICIAL `@anthropic-ai/sdk` (1.x; manda la clave como `Authorization: Bearer`, el servidor de mentira acepta eso y `x-api-key`). La clave va en `ai-keys.bin` con id `"anthropic"` (la fila "Otras IAs" tiene la opción
"Claude (API)"; `verify` = `models.list`, no gasta). Dónde actúa: (1) el chat del orquestador (`askApi` en `orchestrator.js`; ahí también entran Telegram y la API del celular porque todos pasan por `askNimbo`): Sonnet 5.5
(`chatModelId(prefs.chatModel)`: "haiku" → Haiku 5.5, "opus" → Opus 5.5, si no Sonnet), `output_config.format` json_schema con el MISMO `SCHEMA` (con `additionalProperties:false`: `strictSchema`), `effort: "low"`, SIN `thinking` ni
`temperature` (400 en 5.5), historial solo de texto en memoria (24 mensajes, "Nueva conversación" lo borra), `systemPrompt(..., { api: true })` cambia la parte del vault ("no tienes herramientas"); ve imágenes, texto/código ≤100 KB y PDF ≤10 MB adjuntos
(`userContent`), el resto lo avisa; Cancelar usa `AbortController`. (2) los resúmenes de WhatsApp (`askApi` en `whatsapp.js`, Haiku 5.5, salida estructurada `SCHEMA_MANY`; `brain()` devuelve "api" si `waModel` está en automático y el motor es api).
NO cambia de motor solo si falla (créditos agotados → mensaje claro). Trello, correo, Spotify y el entrenador siguen con `claude -p` (los conectores solo existen ahí). Se omitió `fallbacks` (reintento en otro modelo tras un rechazo
de seguridad): un `stop_reason: "refusal"` sale como "Claude no quiso responder eso". Precios del caché de la skill (2026-10-06): Sonnet 5.5 2/10 USD por millón, Haiku 5.5 0,10/0,50 → un resumen de WhatsApp ≈ 0,0005 USD. NO probado con una clave real
(el dueño todavía no vincula la organización): lo probado es el módulo, el orquestador y WhatsApp con servidores falsos y la interfaz.
**Encargos a otras IAs** (`src/main/delegate.js`, autoprueba `node src/main/delegate.js`; 2026-10-14): el orquestador devuelve `delegate: [{ai:"gemini", kind:"image"|"text", prompt}]`
(SCHEMA + regla "OTRAS IAs" en `systemPrompt`; `cleanDelegates` deja solo Gemini, imagen/texto, ≤3, prompt ≤1500). Probado con Sonnet real: "genérame un logo…" → un encargo
`image` con prompt en inglés; "¿cuánto es 15 por 4?" → ninguno. La página lo muestra con `delegateCard` (como `proposal`): **Abrir en Gemini** (IPC `delegate-open`: copia el
prompt y abre gemini.google.com/app; sirve con la licencia de estudiante, SIN clave) y **Generar aquí** (`delegate-run`: texto por `ai.chat("gemini")`; imagen por `ai.image`, API
NATIVA `models/<modelo>:generateContent` con `responseModalities`, clave en el encabezado `x-goog-api-key`, modelo `gemini-2.5-flash-image` o `prefs.aiModels.geminiImage`;
se guarda en `Imágenes\Nimbo` y `delegate-show` solo muestra archivos dentro de esa carpeta). `delegateResult` pinta el resultado y **Dárselo a Claude** lo adjunta (imagen ≤5 MB) o lo
pone en la caja. Errores entendidos: key, limit, billing (Google exige facturación para imágenes con clave gratis: SIN verificar con una clave real), blocked, model, offline.
Telegram solo avisa que hay encargos (no los ejecuta). NO probado con una clave real de Gemini (el dueño solo tiene la licencia de estudiante, que es la app, no la API).
Ideas: ChatGPT/OpenAI como segundo destino (`gpt-image-1`), guardar y reutilizar resultados, que Gemini devuelva el resultado a Claude sin clic.
**Bandeja de pendientes de Telegram:** `/pendiente <texto>` (o `/p`, `/anotar`, `/tarea`; `parseInbox` en telegram.js) agrega a `reminders` sin fecha (la píldora
Pendientes); `/pendientes` lista y `/hecho <n>` completa. Con Nimbo apagado Telegram guarda los mensajes 24 h; al arrancar `prime()` los lee TODOS (hasta 500):
las notas `/pendiente` de la cuenta vinculada se anotan (`onBacklog`) y se confirma; el resto se descarta (sigue la regla de no ejecutar nada viejo) y se avisa.
**Avisos al celular** (`src/main/alerts.js`, autoprueba `node src/main/alerts.js`): los hooks que llegan al servidor local pasan por `alerts.onHook`: "terminó" solo
si el trabajo duró ≥ 1 min (se mide desde `UserPromptSubmit`), permiso/necesita (un permiso dispara PermissionRequest y Notification: un solo aviso por chat en 90 s)
y fallos; `notify` sirve a recordatorios, correo y WhatsApp urgente (APAGADO por defecto). Por defecto solo avisa con ≥ 120 s sin tocar el PC
(`powerMonitor.getSystemIdleTime`). A Telegram solo va el título del chat y el nombre de la herramienta (validado con regex), nunca comando ni texto.
Se configura en el menú "Avisos al celular (Telegram)" → `prefs.telegramAlerts`.
**Correo** (`src/integrations/mail.js`, autoprueba sin red; `... live` revisa tu Gmail de verdad y solo imprime cantidades, CUESTA ~0,05 USD): como Trello pero con
Gmail. Al `claude -p` solo se le permite `search_threads` (ya devuelve remitente, asunto y vista previa: nunca se abre el cuerpo) y se prohíben por nombre las otras
27 herramientas de Gmail (enviar, responder, reenviar, borrar, etiquetar, borradores); los demás conectores se excluyen con `connectors()`; Haiku, `--effort low`, tope
0,15 USD. `prefs.mailRead` (apagado hasta activarlo en Conexiones; al activar se revisa de verdad 15–60 s). SOLO cuando lo pides (decisión del dueño, 2026-10-14: no hay revisión automática): botón ✉ de la barra (`#mailBtn`, visible mientras `mailRead`; tocarlo ES pedirlo y vuelve a revisar si pasaron 2 min), "revisa mi correo", entrada "Revisar correo" del menú, `/correo` y "Revisar ahora" en Conexiones. Importantes nuevos → `alerts.notify("mail")` (la primera revisión al activar no avisa). `mail-open` abre
`https://mail.google.com/mail/u/0/#inbox/<id>` solo con un id hexadecimal. Apagar borra `mail.json`. Probado con Gmail real: 6 sin leer, 3 importantes, 47–56 s.
**Barra flotante de música** (`src/main/musicbar.js` + `player-preload.js` + `src/renderer/player.{html,css,js}`; `node src/main/musicbar.js` = autoprueba
sin Electron): una SEGUNDA ventana (sin marco, transparente, siempre arriba en nivel "floating", `showInactive` para no robar el foco)
que sale mientras `media` (lo que suena, media.js) no sea null, `prefs.musicBar` esté activo y no haya modo mini; en pausa se queda; la ✕
la esconde hasta que cambie la canción (`trackKey`). Se mueve agarrándola (`-webkit-app-region: drag`; botones y búsqueda son `no-drag`) y
al soltar guarda `prefs.musicBarPos` (`fitInto` la devuelve a una pantalla que exista). Crece al buscar: la página mide su tarjeta y
manda `bar-size` (el alto se limita a 72–400 y sube si no cabe abajo). Su puente (`window.bar`) solo tiene música, buscar y tamaño: NO
tiene `window.nimbo`; reutiliza los IPC `media`, `media-do`, `spotify-search` y `spotify-play` (con Premium busca al instante y la canción
suena; sin Premium busca por el conector y abre la página). OJO: `media.js` arranca ANTES de que la app esté lista, por eso `sync()`
no hace nada hasta `app.isReady()` y `whenReady` lo llama. Probado en la app real: aparece con la canción y la carátula, pausa/reanuda,
busca (6 resultados), reproduce y la ventana crece de 74 a 308 px y vuelve. SIN probar con mouse real: arrastrarla y que recuerde el sitio.
**Telegram** (`src/integrations/telegram.js`, `node src/integrations/telegram.js` = autoprueba con un Telegram de mentira): hablar con
Nimbo desde el celular, SIN servidor ni puerto: `getUpdates` con espera larga de 25 s (saliente). El dueño crea un bot con @BotFather,
pega el token en Conexiones (`setup-do telegram-token`: se valida con `getMe` y se guarda cifrado con `safeStorage` en
`%APPDATA%\nimbo\telegram.bin`; el token NUNCA va en prefs, errores ni logs) y se vincula con un código de 6 cifras (10 min, 5
intentos; `telegram-pair`). Solo atiende UNA cuenta (`prefs.telegramChat`), solo chats privados de personas; lo demás se ignora SIN
responder. Al arrancar descarta lo pendiente (`prime`) y avisa si era suyo. Los mensajes van a `askNimbo` (la MISMA conversación que
la isla; una cola evita dos `ask` a la vez) y /plan se contesta desde `plan`. Los `dispatch` (encargos a otros chats) NO se envían
desde Telegram: solo se listan. `prefs.chatModel` (defecto "sonnet" desde 2026-10-14; "" = el modelo de su `claude`, Opus en este equipo, el más caro; "haiku") rige TODO el chat de Nimbo (isla y Telegram). Las extracciones (WhatsApp, Trello, correo, búsqueda de Spotify) siguen en Haiku. Telegram ve el texto (los
bots no tienen cifrado de punta a punta): está en PRIVACY.md. Probado: autoprueba (incluye mutación: sin el filtro de cuenta ajena
falla), la fila de Conexiones en sus 3 estados, rechazo de tokens mal formados y de uno falso (401 real). SIN probar con un bot real:
hace falta que el dueño cree uno.
**Entrenador de entrevistas** (`src/main/interview.js`, `node src/main/interview.js` = autoprueba; `... live` hace 2 turnos de verdad y
CUESTA centavos): en el chat, "entrenar entrevista para <puesto>" / "interview me for …" (`INTERVIEW_START` en `app.js`; si falta el
puesto lo pregunta). Mientras `interview` (variable de la página) está activo, lo que se escribe es la respuesta; "terminar" sale
con promedio y consejos, "siguiente" pasa a otra pregunta. Cada turno es una llamada `claude -p` SIN estado: puesto + últimas 6
preguntas recortadas + la respuesta; `--model sonnet` (`prefs.interviewModel` lo cambia; Sonnet es el defecto desde 2026-10-14), `--tools ""`, `--strict-mcp-config`,
`--setting-sources project`, `--effort low` y `--max-budget-usd 0.10`. Medido con Sonnet el 2026-10-14: pregunta ~5 s y ~0,008 USD; evaluación ~11 s y ~0,017 USD.
Con Haiku (2026-10-13) variaba mucho: 14–70 s y 0,009–0,05 USD (sin `--effort low` llegó a 71 s y 0,052: "pensaba" de más), y salía MÁS caro y lento que Sonnet. El modelo devuelve
`{feedback, tip, score, better, next}` y `cleanTurn` lo valida; "better" conserva los hechos del candidato y deja [dato] donde falta.
Solo se dice en voz alta la pregunta (la cuota de voz se paga por letra). Decisión del dueño: es práctica; NO se construye ningún
modo oculto para entrevistas reales. El dictado existente (🎤) sirve para contestar hablando.
**Conectores de más = tokens de más.** Cada `claude -p` carga las herramientas de TODOS los conectores del
usuario: con 9 conectores eran 355.000 tokens por llamada (y Haiku respondía "Prompt is too long"). Por eso
`connectors()` (`orchestrator.js`, lee `claude mcp list`, ~4 s, sin modelo, caché 10 min) da los prefijos
`mcp__…` y Trello y Spotify pasan los que no usan en `--disallowedTools`: quedan 25.000 tokens.
**Spotify** (`spotify.js`, `node spotify.js` = autoprueba; `node spotify.js "queen"` busca de verdad): sin claves.
En el chat, "spotify <canción>", "reproduce <canción>" o "pon <canción> en spotify" (`MUSIC_ASK`) no van al
orquestador: `searchSpotify` le pide la búsqueda a tu `claude` (Haiku, `--tools ""`, solo `search`
del conector de Spotify de claude.ai; crear listas y tocar la biblioteca van en `--disallowedTools`). Si el
conector no está en `claude mcp list`, responde `connected: false` al instante, sin llamar al modelo. La lista
sale en la caja de respuesta; tocar una canción manda su URI a `spotify-play`, que solo abre
`spotify:track:<22 letras>` (`TRACK_URI`; `cleanTracks` normaliza enlaces e ids y descarta lo demás). El conector
no tiene "reproducir" y abrir el URI NO hace que suene (probado el 2026-10-07, también con `:play` y `?autoplay=true`):
Spotify solo muestra la página de la canción. Arrancar una canción concreta solo se puede con la Web API de Spotify,
que exige Premium, una app de desarrollador por usuario (máximo 5 personas) y guardar un token: decisión del autor.
La búsqueda real tarda ~25 s. Las herramientas del conector hoy: `search`, `get_currently_playing`,
`generate_playlist`, `save_to_library`, `remove_from_library`.
**Spotify con Premium** (`spotify-api.js`, `node spotify-api.js` = autoprueba sin red, con un Spotify de mentira): opcional,
para que la canción elegida SUENE y la búsqueda sea instantánea. Web API con PKCE (sin client secret). El Client ID es
de la app de developer.spotify.com de CADA usuario (`prefs.spotifyClientId`, nunca en el código: Spotify limita cada
app a 5 personas y exige Premium al dueño). Dirección de vuelta fija: `http://127.0.0.1:47823/spotify`, una ruta GET
del servidor de hooks que solo vale con una entrada en curso y su `state` (un solo uso, 5 min). Permisos:
`user-modify-playback-state user-read-playback-state` (la pantalla de Spotify suma siempre el perfil público; Nimbo no lo lee).
El enlace de permiso se abre en el navegador por defecto Y se copia: el usuario puede tener su sesión en otro navegador. Única excepción a "Nimbo no guarda tokens": el token de
renovación va en `%APPDATA%\nimbo\spotify.bin` cifrado con `safeStorage` (DPAPI); sin cifrado no se guarda; el de
acceso vive en memoria. `invalid_grant` al renovar = se borra y el panel vuelve a pedir "Conectar". Con sesión,
`spotify-search` usa la API (`plays: true`) y `spotify-play` hace `PUT /me/player/play`; con 404 (ningún equipo
activo) elige uno con `pickDevice` (este equipo → el activo → un computador) y reintenta; si no suena, abre el URI.
Probado con Spotify real el 2026-10-11: búsqueda 0,4–0,9 s y la canción elegida suena; `spotify.bin` pesa 162 bytes y no
tiene texto legible. Límites de la API desde 2026: búsqueda máximo 10 resultados. Panel: `setup-do` `spotify-id` / `spotify-login` (no
espera: al volver el navegador main manda `spotify` a la página) / `spotify-logout`.
**Lo que suena** (`media.js` + `media-watch.ps1`, `node media.js` = autoprueba; `node media.js ver` mira 9 s en vivo):
controles multimedia de Windows (SMTC, sesión cuyo id contiene "spotify"), sin cuenta ni claves. El script mira cada
2 s y emite `media:{title, artist, album, playing, art}` solo cuando cambia; recibe `toggle`/`next`/`prev` por stdin
(tras una orden mira cada 250 ms durante 2 s: el botón se confirma en ~1 s; la página además lo voltea al instante).
La carátula (PNG 300 px, ~130 KB) va como data: URI; `cleanMedia` solo acepta PNG/JPEG en base64. Píldora "Spotify"
(♪ / ❚❚) y tarjeta con carátula y botones. Trampas de PowerShell 5.1: `[Console]::In.ReadLineAsync()` BLOQUEA (se lee
el flujo crudo con StreamReader) y el flujo de la carátula hay que convertirlo por reflexión (`AsStreamForRead`).
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
- Detección (2026-10-14, "a veces no detecta los mensajes"): el lector de PowerShell ahora mira cada 1 s (antes 3) y el número de cada notificación es
  `creación_ms × 1000 + id % 1000`: el id de Windows es corto (en `whatsapp-vistos.json` se ven 2021…5038) y puede repetirse tras reiniciar, y como los "vistos" se guardan
  en disco un mensaje NUEVO con un número viejo parecía ya visto y se ignoraba. Además `watch()` ahora SUPERVISA al proceso: si PowerShell se cierra se relanza a los 3 s,
  si no escribe nada en 25 s se mata y se relanza, y tras una suspensión del equipo (`powerMonitor "resume"`) se reinicia; antes un lector muerto no volvía hasta reiniciar Nimbo.
  No verificado con un mensaje real nuevo (el lector sí se probó: arranca, responde con `access: true` y revive tras matarlo).
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
Foundation (gratis para código abierto; el certificado sale a nombre de ellos). **RECHAZADO el 2026-10-13**: piden señales públicas (estrellas,
forks, menciones, actividad sostenida) y el proyecto tenía 8 días; invitan a volver a solicitar o a una suscripción de pago. Opciones: reintentar con más
visibilidad, la Microsoft Store (registro único de unos 19 USD, a verificar) o seguir con el aviso de SmartScreen. Requisitos que ya estaban cubiertos: licencia
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

**Video y GIF** (`scripts/promo/`; el GIF sale en `docs/media/nimbo.gif`): `npm run promo` (mp4 con textos) y `npm run promo:gif` (el GIF del README). Cargan el
`index.html` REAL en una ventana fuera de pantalla con una API falsa (`promo-preload.js`, un Proxy: lo que se
agregue a `preload.js` no los rompe) y un guion. No muestran ventanas ni tocan `%APPDATA%\nimbo`.
README en inglés (`README.md`) y español (`README.es.md`): al cambiar uno, cambiar el otro.

**Idiomas (español / inglés).** Los textos van en ESPAÑOL en el código, envueltos en `t("…")`; `i18n.js` trae
el inglés con el texto en español como clave (`{0}`, `{1}` = valores). Idioma = `prefs.lang` (menú "Idioma /
Language") o, si no hay, el de Windows. `main.js` se lo pasa a la página en la URL (`?lang=en`); cambiarlo
recarga la página. El HTML fijo (botones, títulos) se traduce solo al cargar y los dos textos del CSS llegan
como variables (`--t-ask`, `--t-drop`). También siguen el idioma: el dictado (Whisper), las respuestas del
orquestador, los resúmenes de WhatsApp y sus reglas de ejemplo. Al agregar un texto: `t("en español")` + su
línea en `i18n.js`; `node i18n.js` (parte de `npm test`) falla si falta alguna. Los videos de `scripts/promo/` cargan
la página sin `?lang` (español).

## Seguridad (no deshacer)
- Servidor solo en `127.0.0.1`, y solo acepta `Host: 127.0.0.1:47823` (corta DNS rebinding). Cada
  mensaje va firmado con HMAC-SHA256 y un nonce que se acepta una sola vez; la respuesta de permiso
  también va firmada y `hook.js` la verifica (nadie puede suplantar a Nimbo en el puerto).
  Secreto aleatorio por arranque en `%APPDATA%\nimbo\token`; una segunda instancia sale antes de pisarlo.
- La tarjeta de permiso muestra TODO lo que se aprueba (comando completo con scroll, contenido de
  Write/Edit, y las reglas que dejaría "Siempre"). No volver a recortarla: con 4 líneas, una cola
  maliciosa quedaba oculta. La decisión viaja con el id de su tarjeta (`rid`).
- API del celular (`remote-api.js`, puerto 47824): otro servidor, NO el de hooks. Solo `127.0.0.1` y `Host: 127.0.0.1:47824`,
  token propio en `%APPDATA%\nimbo\remote-token` (no reutiliza el HMAC de los hooks) y cuerpos de 16 KB. Nunca se publica por
  Tailscale: lo llama el puente del asistente (`D:\hobby\asistente\bridge\nimbo.js`), que es lo único que ve el teléfono. El
  estado lleva título del chat, estado y nombre de la herramienta, nunca comandos; el permiso pendiente sí va COMPLETO (misma
  regla que la tarjeta) y se decide con un id aleatorio propio (`remoteId`), solo allow/deny. Los encargos de Nimbo quedan
  guardados ahí: el celular manda solo su id, nunca el texto ni el chat. Si Nimbo está en mini o ya hay una tarjeta, el permiso
  va a la terminal como siempre y el celular no lo ve.
- `claude.exe` y PowerShell se lanzan directo (sin `shell: true`); el texto del usuario va por stdin.
- Todo `claude -p` que lee texto de terceros lleva lista cerrada de herramientas: orquestador
  `Read,Glob,Grep` sin MCP; Trello sin herramientas propias y conector en lectura; WhatsApp sin nada.
  Solo `dispatch` (con clic del usuario) puede cambiar cosas.
- Protocolo `nimbo://` solo sirve archivos dentro de esta carpeta (bloquea `../`).
- Ventana: `contextIsolation`, `sandbox`, sin `nodeIntegration`; navegación y `window.open` bloqueados.
  En la página no se usa `innerHTML`: todo texto externo entra con `textContent`/`el()`.
- Permisos del navegador: solo micrófono (audio); cámara y lo demás, denegados.
- Nimbo no guarda claves ni tokens de nadie: GitHub vía `gh`, Trello vía el conector de `claude`. Excepciones, opcionales y
  cifradas por Windows (`safeStorage`): el token de renovación de Spotify Premium (`spotify.bin`), el token del bot de Telegram
  (`telegram.bin`) y las claves de Gemini/OpenAI/Claude API (`ai-keys.bin`).
- El CSP ya no permite JavaScript en línea (`script-src 'self' 'wasm-unsafe-eval' blob:`): el código de la página está en
  `app.js`. Los estilos sí llevan `'unsafe-inline'` (el código pone variables CSS con `style`).

## Estado en disco
`%APPDATA%\nimbo\`: `token`, `prefs.json` (`corner`, `theme`, `pos`, `name`, `vault`, `lang`, `whatsappRead`, `waModel`, `onboarded`, `speak`, `ttsUrl`, `spotifyClientId`, `interviewModel`, `chatModel`, `telegramChat`, `musicBar`, `musicBarPos`, `chatProvider`, `aiModels`, `telegramAlerts`, `mailRead`, `engine`, `planRepo`, `planBranch`, `planFile`, `planSeen`), `reminders.json`, `trello.json`, `whatsapp-reglas.txt`, `chat\` (cwd del orquestador),
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

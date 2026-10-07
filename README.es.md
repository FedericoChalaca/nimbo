# Nimbo ☁️

[English](README.md) · **Español**

Un compañero flotante para [Claude Code](https://claude.com/claude-code) en Windows. Vive en el borde de arriba de tu pantalla, te muestra qué está haciendo cada uno de tus chats y te deja aprobar permisos sin ir a la terminal.

No necesita API key: usa el `claude` que ya tienes instalado y con sesión iniciada.

[![Mira la intro de 10 segundos](promo/nimbo-intro.jpg)](promo/nimbo-intro.mp4)

*▶ Haz clic para ver la intro (10 s). Es un video conceptual generado con IA; la interfaz real es la de abajo.*

![Nimbo en acción](promo/nimbo.gif)

## Instalar

1. Descarga **[Nimbo-Setup.exe](https://github.com/FedericoChalaca/nimbo/releases/latest/download/Nimbo-Setup.exe)** y ábrelo.
2. Windows puede mostrar "Windows protegió su PC" porque el instalador no está firmado. Elige **Más información → Ejecutar de todas formas**.
3. Nimbo se abre y muestra el panel **Conexiones**. Pulsa **Conectar** junto a Claude Code y listo.

No necesitas Node.js. Sí necesitas Claude Code instalado y con sesión iniciada (`claude` en una terminal).

Para quitarlo, desinstala Nimbo desde Configuración de Windows → Aplicaciones. El desinstalador también quita los hooks de Nimbo de Claude Code; tus ajustes en `%APPDATA%\nimbo` se conservan.

> Nimbo usa el idioma de tu Windows (español o inglés). Cámbialo cuando quieras: clic derecho → **Idioma / Language**.

## Conectar todo

Todo se conecta desde un solo lugar: clic derecho en Nimbo → **Conexiones y ajustes** (la primera vez se abre solo). Cada fila tiene un punto y un botón:

- 🟢 verde: conectado y funcionando
- 🟠 ámbar: falta un paso tuyo
- ⚪ gris: opcional, sin configurar

Solo Claude Code es obligatorio. Lo demás es opcional y lo puedes agregar cuando quieras.

### 1. Claude Code (obligatorio)

Qué te da: tus chats en vivo en la isla y los permisos como tarjetas.

1. Comprueba que Claude Code funciona: abre una terminal, escribe `claude` e inicia sesión si te lo pide.
2. En el panel Conexiones de Nimbo, pulsa **Conectar**.
3. Escribe cualquier mensaje en una sesión de Claude Code (terminal, app de escritorio o editor). La isla muestra el nombre del chat y lo que está haciendo.

Si no aparece nada, cierra y vuelve a abrir la sesión de Claude Code que ya tenías abierta: toma la conexión al arrancar.

Qué hace **Conectar**: agrega los hooks de Nimbo a `~/.claude/settings.json`. Antes hace una copia con fecha y no toca los hooks que ya tuvieras. **Desconectar** los quita.

### 2. Tu nombre

Escríbelo en la casilla para que Nimbo te salude por tu nombre.

### 3. GitHub (opcional)

Qué te da: una píldora morada con tus notificaciones de GitHub sin leer, y un aviso cuando llega una nueva.

1. Instala [GitHub CLI](https://cli.github.com):

```bash
winget install --id GitHub.cli
```

2. Inicia sesión:

```bash
gh auth login
```

3. Vuelve a abrir el panel Conexiones: la fila de GitHub queda en verde. Nimbo consulta cada 5 minutos con esa sesión; nunca ve tu contraseña ni tu token.

### 4. Trello (opcional)

Qué te da: una píldora azul con tus tarjetas pendientes, y un aviso cuando una vence en menos de 24 horas. Solo lectura: Nimbo no puede crear, mover ni borrar tarjetas.

1. Abre [claude.ai → Ajustes → Conectores](https://claude.ai/settings/connectors), busca **Trello**, pulsa **Conectar** y autoriza tu cuenta de Trello. Usa la misma cuenta de Claude que usas en Claude Code.
2. En el panel Conexiones de Nimbo, pulsa **Probar**. La primera lectura tarda cerca de un minuto.
3. La fila queda en verde con el número de pendientes. Se actualiza cada 30 minutos, o al momento con clic derecho → **Actualizar Trello**.

Una tarjeta cuenta como pendiente si está abierta y tiene fecha de vencimiento sin completar, o está en una lista como Por hacer, En proceso, Bloqueado o Inbox.

### 5. WhatsApp (opcional, solo lectura)

Tiene dos niveles. El primero no te pide nada.

**Nivel 1: cuántos chats sin leer.** Abre WhatsApp de escritorio (la app de Microsoft Store). Nimbo lee el número del título de la ventana y lo muestra en la píldora de WhatsApp.

**Nivel 2: quién escribió y qué es urgente.** Apagado hasta que lo actives.

1. En el panel Conexiones, en la fila de WhatsApp, pulsa **Activar**.
2. Comprueba que Windows muestra las notificaciones de WhatsApp con su texto: Configuración de Windows → Sistema → Notificaciones → WhatsApp activado, y en WhatsApp → Ajustes → Notificaciones, la vista previa del mensaje activada. Nimbo lee esas notificaciones; sin notificación no hay resumen.
3. Dile qué te importa: pulsa **Reglas** (o clic derecho → **Reglas de WhatsApp**). Es un archivo de texto; escríbelo con tus palabras y guarda. Por ejemplo:

```text
Trabajo: Laura (mi jefa), Andrés (cliente), el grupo "Equipo Rocket".
Grupos que no me importan: Fútbol los jueves, Vecinos del edificio.
Urgente: algo de trabajo que pide respuesta hoy, un cliente molesto, un pago, algo caído, o una emergencia de familia.
```

4. Recomendado: que sea 100 % local. Instala [Ollama](https://ollama.com) y descarga un modelo pequeño (2 GB, una sola vez):

```bash
ollama pull llama3.2:3b
```

Deja Ollama abierto. La fila de WhatsApp dirá "Lo resume un modelo local": cerca de un segundo por chat, sin gastar tokens, y los mensajes no salen de tu PC. Sin Ollama lo hace tu propio Claude (Haiku): entre 10 y 20 segundos por tanda, y cuenta contra tu uso de Claude.

Qué vas a ver:

| En la isla | Qué significa |
|---|---|
| Botón verde con un número | Chats con resumen que no has visto. Tócalo para abrirlo. |
| El botón gira, "WhatsApp · resumiendo…" | El modelo está leyendo los mensajes nuevos. |
| "WhatsApp · Laura: pide el informe" | El resumen, que sale unos segundos cuando está listo. |
| Isla roja que late, tres avisos | Algo urgente según tus reglas. |
| ↩ una línea debajo de cada chat, con **Copiar** | Una respuesta sugerida. Cópiala y pégala en WhatsApp si te sirve; Nimbo nunca envía nada. |
| **Visto** (dentro del resumen) | Ya lo leíste: se cierra y esos mensajes no vuelven a salir. También pasa solo al cerrar el resumen. |
| **Resumir ahora** (dentro del resumen) | Pedirlo otra vez, por ejemplo tras cambiar tus reglas. |

Ten en cuenta:

- Las respuestas son sugerencias de un modelo pequeño: léelas antes de pegar. Puedes describir tu estilo en el archivo de reglas ("contesto corto e informal").
- Lo que ya viste no se vuelve a resumir ni a anunciar, aunque reinicies Nimbo. Solo vuelve a avisar cuando llega un mensaje nuevo.
- Los chats silenciados, y los mensajes que llegan con la ventana de WhatsApp al frente, no dejan notificación, así que Nimbo no los ve.
- Los grupos que marcaste como sin importancia se cuentan, pero nunca suenan.
- En modo mini los resúmenes se pausan y se ponen al día al salir.
- Para forzar uno u otro, pon `waModel` en `%APPDATA%\nimbo\prefs.json` con `"claude"` o con el nombre de un modelo de Ollama.

**Privacidad.** Nimbo no tiene servidores ni telemetría: nada llega al autor de Nimbo ni a nadie más. Lee las notificaciones que Windows ya te mostró, con la API oficial de Windows; no abre tu sesión de WhatsApp, no usa librerías no oficiales, y nunca envía ni marca nada como leído en WhatsApp. Con un modelo local el texto se queda en tu PC. Sin él, el texto de esas notificaciones (escrito por otras personas) va a Anthropic a través de **tu** cuenta de Claude, igual que cualquier cosa que le escribes a Claude. Nimbo guarda los mensajes solo en memoria, nunca en disco (en disco solo quedan los números internos de las notificaciones que ya viste, sin texto).

### 6. Iniciar con Windows

Pulsa **Activar** y Nimbo arranca al prender el equipo.

### 7. Tus notas (opcional)

Si tienes tus notas en una carpeta (un vault de Obsidian, por ejemplo), el chat de Nimbo puede leerlas para responder cosas como "¿qué proyectos tengo en pausa?". Agrega la carpeta en `%APPDATA%\nimbo\prefs.json` y reinicia Nimbo:

```json
{ "vault": "D:\\mis-notas" }
```

### 8. Voz (opcional)

Nimbo puede leer sus respuestas en voz alta, con una voz distinta para cada apariencia (nube y JARVIS). Lee solo su respuesta corta, nunca los prompts que propone para otros chats.

Nimbo no habla con ningún proveedor de voces ni guarda claves. Manda el texto a un servicio de texto a voz que tú eliges y reproduce el audio que vuelve:

¿Aún no tienes un servicio? [examples/tts-service](examples/tts-service) es uno listo para desplegar con ElevenLabs: le pones tu propia clave y los ids de las dos voces que te gusten.

1. Pon la dirección de tu servicio en `%APPDATA%\nimbo\prefs.json` y reinicia Nimbo:

```json
{ "ttsUrl": "https://tu-servicio.example/api/tts" }
```

2. En el panel Conexiones, en la fila Voz, pulsa **Activar** (o clic derecho → **Leer las respuestas en voz alta**).

El servicio recibe `POST {"text": "..."}` para la apariencia JARVIS y `POST {"text": "...", "voz": "nube"}` para la nube, y debe responder con `audio/mpeg`. Los textos se cortan en un punto para que quepan en 1500 caracteres.

Se calla cuando llega otra respuesta, cuando empiezas a dictar, cuando cambias de apariencia o cuando apagas la voz o todos los sonidos. Si el servicio está caído, tarda más de 10 segundos o no hay internet, Nimbo sigue en silencio: una sola petición por respuesta, sin reintentos y sin errores en pantalla.

Ten en cuenta que el texto de cada respuesta se envía a ese servicio.

### 9. Plan del día (opcional)

Si otra herramienta tuya deja cada día un plan como archivo JSON en una rama de un repositorio git de tu PC, Nimbo puede mostrarlo, decirlo en voz alta la primera vez que lo abres cada día y dártelo cuando escribes "dame el plan de hoy". Solo lee (`git fetch` y `git show`), con el git que ya tienes. Dile dónde está el plan en `%APPDATA%\nimbo\prefs.json`:

```json
{ "planRepo": "D:\\mi-repo", "planBranch": "plan-diario", "planFile": "plan.json" }
```

El formato del archivo está explicado al inicio de [plan.js](plan.js).

### Si algo no funciona

| Problema | Qué revisar |
|---|---|
| La isla no reacciona a mis chats | Conexiones → Claude Code debe estar en verde. Luego reinicia la sesión de Claude Code. |
| La fila de Claude Code dice "apunta a otra carpeta" | Moviste o reinstalaste Nimbo. Pulsa **Reconectar**. |
| Falta una píldora | Las píldoras solo aparecen cuando tienen algo: con cero notificaciones o cero tarjetas se ocultan. |
| WhatsApp dice "Sin vista previa" | Esos chats no dejaron notificación en Windows. Mira el paso 2 de WhatsApp. |
| Los resúmenes de WhatsApp tardan | Estás usando Claude. Instala Ollama y un modelo pequeño (paso 4 de WhatsApp). |
| El dictado no hace nada la primera vez | Descarga el modelo de voz una sola vez (unos 76 MB). La isla muestra el avance. |

## Qué hace

- **Ve tus chats en vivo.** Reacciona a cada sesión de Claude Code (varias a la vez): pensando, trabajando, esperándote, listo o error. Muestra el paso actual y el diff o la terminal del chat activo.
- **Aprueba permisos desde la isla.** Permitir, Denegar, Siempre o mandarlo a la terminal. La tarjeta muestra el comando completo.
- **Chatea con tu Claude.** Escribe, dicta (Whisper local, el audio no sale de tu PC), pega imágenes o suéltale archivos encima.
- **Ve tu pantalla cuando se lo pides.** Pulsa 🖥 en el chat: toma un pantallazo, te muestra la miniatura y le preguntas lo que necesites ("¿qué significa este error?", "¿dónde hago clic para exportar?"). No hay vista en vivo ni nada automático: una sola foto, solo cuando pulsas el botón, y se envía a tu Claude solo cuando mandas el mensaje.
- **Orquesta.** Conoce tus chats: si pides algo que le toca a otro proyecto, redacta el prompt para ese chat y lo envía solo cuando tú confirmas.
- **Recordatorios.** "Recuérdame mañana a las 9 enviar la factura": avisa en la isla y con una notificación de Windows.
- **Dos apariencias.** Una nube con cara o una esfera de puntos estilo JARVIS.
- **Modo mini.** `Ctrl+Alt+N` lo encoge a una esquina para cuando juegas.
- **Se mueve.** Arrástralo por el borde de arriba; recuerda dónde lo dejaste.

## Usarlo

| Acción | Qué pasa |
|---|---|
| Pasar el mouse | Aparecen las píldoras (Chats, Trello, GitHub, WhatsApp, Pendientes). Toca una para ver su detalle. |
| Un clic | Abre o cierra el chat. |
| Clic en el botón verde | Abre el resumen de WhatsApp. |
| 🖥 en el chat | Toma un pantallazo de la pantalla donde está el cursor y lo adjunta. Toca la miniatura para quitarlo. |
| Clic derecho | Menú: conexiones, idioma, apariencia, modo mini, WhatsApp, voz, silenciar, salir. |
| ⋮ en el extremo derecho de la isla | El mismo menú, sin clic derecho. Aparece al pasar el mouse. |
| Icono de Nimbo junto al reloj | El mismo menú otra vez. Windows puede dejarlo detrás de la flechita (^) de la barra de tareas. |
| Arrastrar la barra | Lo mueve por el borde de arriba. |
| Soltar un archivo encima | Se lo "come" y lo adjunta al chat. |
| `Ctrl+Alt+N` | Modo mini. |

## Seguridad

Nimbo se sienta entre tú y los permisos de Claude Code, así que esto importa:

- El servidor local solo escucha en `127.0.0.1` y solo acepta mensajes firmados (HMAC-SHA256) por `hook.js` con un secreto que cambia en cada arranque. Una página web u otro programa no puede aprobar comandos por ti.
- La tarjeta de permiso muestra el comando o el cambio completo. Lee antes de permitir.
- El chat de Nimbo solo puede leer archivos. Para cambiar algo en un proyecto, te propone un prompt y lo envía únicamente cuando haces clic.
- Los resúmenes de Trello y WhatsApp corren sin herramientas: un texto ajeno no puede hacer que un modelo ejecute nada.
- Nimbo no guarda contraseñas, tokens ni API keys. GitHub usa tu sesión de `gh`; Trello, el conector de tu Claude.

Si encuentras un problema de seguridad, abre un issue.

## Firma del instalador

El instalador **todavía no está firmado**. Esa es la única razón por la que Windows muestra "Windows protegió su PC" al abrirlo: no conoce al autor. Firmarlo requiere un certificado de una autoridad reconocida, y ya lo solicitamos a la [SignPath Foundation](https://signpath.org), que firma gratis proyectos de código abierto.

Mientras tanto, hay dos cosas que te permiten confiar en lo que descargas:

- El instalador de cada versión lo arma [GitHub Actions](.github/workflows/build.yml) directamente desde este repositorio, sin pasos manuales.
- Puedes saltarte el instalador y [correrlo desde el código](#correrlo-desde-el-código).

Política de firma de código:

- Autores, revisores y aprobadores: [@FedericoChalaca](https://github.com/FedericoChalaca). Los cambios de cualquier otra persona se revisan antes de aceptarlos.
- Privacidad: en [PRIVACY.md](PRIVACY.md) está cada caso en el que Nimbo se conecta a la red.

## Correrlo desde el código

Requiere [Node.js](https://nodejs.org) 20 o superior.

```bash
git clone https://github.com/FedericoChalaca/nimbo.git
```

```bash
cd nimbo
```

```bash
npm install
```

```bash
npm start
```

Después conecta Claude Code desde el panel Conexiones (o con `npm run install-hooks`).

Otros comandos: `npm test`, `npm run dist` (arma el instalador), `npm run promo` (graba el video de demostración), `npm run promo:gif` (regenera el GIF de arriba).

Tus ajustes viven en `%APPDATA%\nimbo\`, nunca en la carpeta del proyecto. Los textos de la interfaz están en `i18n.js` (español en el código, inglés en ese archivo). `CLAUDE.md` explica la arquitectura, los flujos y las lecciones aprendidas (sirve tanto a personas como a Claude Code).

Si tu `claude.exe` no está donde lo dejan npm o el instalador nativo, define la variable de entorno `NIMBO_CLAUDE` con su ruta.

## Créditos

La idea y varias técnicas de la interfaz de isla vienen de [Coucou](https://github.com/louis-cfm/coucou) de Louis Raillé (MIT), un compañero para la muesca del Mac. Nimbo es una implementación independiente para Windows, con su propio personaje, sonidos y código.

## Licencia

MIT. Ver [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).

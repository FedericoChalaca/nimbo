# Privacy / Privacidad

**English** · [Español](#español)

Nimbo has no servers, no accounts, and no telemetry. Its author receives nothing from your computer. Everything it knows stays in `%APPDATA%\nimbo` on your PC.

It does connect to the network in the cases below. Each one uses a session or a service that is already yours.

| When | Where it connects | What is sent |
|---|---|---|
| You use the chat, or it summarizes Trello or WhatsApp with Claude | Anthropic, through your own `claude` command | Your message, attached images or screenshots, and what Claude needs to answer |
| GitHub is connected (`gh` installed and signed in) | GitHub, through your own `gh` session, every 5 minutes | A request for your unread notifications |
| The Trello connector is enabled in your Claude | Trello, through your Claude, every 30 minutes | A read-only request for your open cards |
| You turn on "Read WhatsApp messages" | Local model (Ollama) if you have one: nothing leaves the PC. Otherwise Anthropic, through your `claude` | The text of WhatsApp notifications Windows already showed you |
| You turn on the voice and set `ttsUrl` | The text-to-speech service **you** configured | The text of each reply |
| You dictate for the first time | Hugging Face | Nothing about you: it downloads the speech model once. Your audio is transcribed on your PC |
| You click a link or "Guide" | Your browser opens GitHub, Trello, claude.ai, or the page you chose | Nothing from Nimbo |

Screenshots are taken only when you press the screen button, and are sent only when you send the message.

Nimbo stores no passwords, tokens, or API keys.

Questions or concerns: open an issue in this repository.

---

## Español

Nimbo no tiene servidores, cuentas ni telemetría. Su autor no recibe nada de tu computador. Todo lo que sabe se queda en `%APPDATA%\nimbo`, en tu PC.

Sí se conecta a la red en los casos de abajo. En cada uno usa una sesión o un servicio que ya es tuyo.

| Cuándo | A dónde se conecta | Qué se envía |
|---|---|---|
| Usas el chat, o resume Trello o WhatsApp con Claude | Anthropic, con tu propio comando `claude` | Tu mensaje, las imágenes o pantallazos adjuntos y lo que Claude necesita para responder |
| GitHub está conectado (`gh` instalado y con sesión) | GitHub, con tu propia sesión de `gh`, cada 5 minutos | La consulta de tus notificaciones sin leer |
| El conector de Trello está activo en tu Claude | Trello, a través de tu Claude, cada 30 minutos | Una consulta de solo lectura de tus tarjetas abiertas |
| Activas "Leer mensajes de WhatsApp" | Un modelo local (Ollama) si lo tienes: nada sale del PC. Si no, Anthropic, con tu `claude` | El texto de las notificaciones de WhatsApp que Windows ya te mostró |
| Activas la voz y configuras `ttsUrl` | El servicio de voz que **tú** configuraste | El texto de cada respuesta |
| Dictas por primera vez | Hugging Face | Nada tuyo: descarga el modelo de voz una vez. Tu audio se transcribe en tu PC |
| Haces clic en un enlace o en "Guía" | Tu navegador abre GitHub, Trello, claude.ai o la página que elegiste | Nada de Nimbo |

Los pantallazos se toman solo cuando pulsas el botón de pantalla, y se envían solo cuando mandas el mensaje.

Nimbo no guarda contraseñas, tokens ni claves de API.

Dudas o inquietudes: abre un issue en este repositorio.

# Privacy / Privacidad

**English** · [Español](#español)

Nimbo has no servers, no accounts, and no telemetry. Its author receives nothing from your computer. Everything it knows stays in `%APPDATA%\nimbo` on your PC.

It does connect to the network in the cases below. Each one uses a session or a service that is already yours.

| When | Where it connects | What is sent |
|---|---|---|
| You use the chat, or it summarizes Trello or WhatsApp with Claude | Anthropic, through your own `claude` command | Your message, attached images or screenshots, and what Claude needs to answer |
| You accept version alerts (asked once; right-click → Tell me about new versions) | GitHub (api.github.com and github.com), a couple of times a day | A request for Nimbo's latest release. Nothing of yours is sent. If you press "Update now", the installer is downloaded from github.com and checked against the SHA-256 GitHub publishes |
| You turn on “Hey Nimbo” (off by default) | Your own PC: the microphone stays open for Windows' offline speech recognizer (System.Speech), which only recognizes the wake phrase | Nothing is recorded, stored or sent. After the wake phrase, what you say goes to the local Whisper dictation and then, as a normal chat message, to your Claude |
| A job finishes (Claude Code "Stop" event) | Your own PC: Nimbo asks Windows which program is in front (PowerShell, `osascript` or `xdotool`) to stay quiet when it is a terminal, editor or the Claude app | Nothing leaves your PC and the answer is not stored |
| GitHub is connected (`gh` installed and signed in) | GitHub, through your own `gh` session, every 5 minutes | A request for your unread notifications |
| The Trello connector is enabled in your Claude | Trello, through your Claude: your board list once a day, and a board's cards when you open it | A read-only request for your boards, and for the open cards of the board you opened |
| You search for a song in the chat (Spotify connector enabled in your Claude) | Spotify, through your Claude | The words you searched for |
| You press **Generate here** on a request card (Gemini; optional) | Google (Gemini), with the key you pasted | The text of that request. Images are saved in `Pictures\Nimbo` on your PC. **Open in Gemini** sends nothing: it copies the text and opens the Gemini website |
| You choose the Claude API engine (right-click → Nimbo engine; optional, off by default) | Anthropic, through its API with the key you pasted (same company as your `claude`) | What you write to Nimbo (also from Telegram), images and text/PDF files you attach, your reminders and the plan of the day, and, if WhatsApp reading is on, the WhatsApp notification text to summarize. Keys stay on your PC, encrypted by Windows |
| You use another AI in the chat (Ollama, Gemini or OpenAI; optional) | Ollama: your own PC. Gemini / OpenAI: the provider you chose, with the key you pasted | What you write and the last few messages of that conversation. Attachments never go there; they go to Claude. Keys stay on your PC, encrypted by Windows |
| You turn on Email (optional) | Gmail, through your own Claude and its Gmail connector, read-only | Sender, subject and a preview of your recent unread emails, which Anthropic processes to summarize them. Nimbo never opens a message body. What it keeps (`mail.json`) is deleted when you turn it off |
| You connect Telegram (optional, your own bot) | Telegram (api.telegram.org), directly from your PC, asking for new messages every few seconds | What you write to your bot and Nimbo's replies, which Telegram can read (bot chats are not end-to-end encrypted). The bot token stays on your PC, encrypted by Windows. With phone alerts on, Telegram also receives the title of a Claude Code chat, a tool name, reminder texts, and the sender and subject of important emails (urgent WhatsApp: only the chat name, and off by default) |
| You connect Spotify with Premium (optional, your own Spotify app) | Spotify, directly from your PC | The words you search for and the song you pick. A refresh token stays on your PC, encrypted by Windows |
| You tap Lyrics on the music card | LRCLIB (lrclib.net, a free community lyrics library), directly from your PC | The title, artist, album and length of the song playing |
| You turn on "Read WhatsApp messages" | Local model (Ollama) if you have one: nothing leaves the PC. Otherwise Anthropic, through your `claude` | The text of WhatsApp notifications Windows already showed you |
| You turn on the voice and set `ttsUrl` | The text-to-speech service **you** configured | The text of each reply |
| You dictate for the first time | Hugging Face | Nothing about you: it downloads the speech model once. Your audio is transcribed on your PC |
| You click a link or "Guide" | Your browser opens GitHub, Trello, claude.ai, or the page you chose | Nothing from Nimbo |

Screenshots are taken only when you press the screen button, and are sent only when you send the message.

Nimbo stores no passwords, tokens, or API keys, with one optional exception: if you connect Spotify with Premium or Telegram, their token is kept on your PC, encrypted by Windows, until you click Disconnect.

Questions or concerns: open an issue in this repository.

---

## Español

Nimbo no tiene servidores, cuentas ni telemetría. Su autor no recibe nada de tu computador. Todo lo que sabe se queda en `%APPDATA%\nimbo`, en tu PC.

Sí se conecta a la red en los casos de abajo. En cada uno usa una sesión o un servicio que ya es tuyo.

| Cuándo | A dónde se conecta | Qué se envía |
|---|---|---|
| Usas el chat, o resume Trello o WhatsApp con Claude | Anthropic, con tu propio comando `claude` | Tu mensaje, las imágenes o pantallazos adjuntos y lo que Claude necesita para responder |
| Aceptas el aviso de versiones nuevas (se pregunta una vez; clic derecho → Avisarme de versiones nuevas) | GitHub (api.github.com y github.com), un par de veces al día | La consulta de la última versión de Nimbo. No se envía nada tuyo. Si pulsas "Actualizar ahora", el instalador se descarga de github.com y se comprueba contra el SHA-256 que publica GitHub |
| Activas «Oye Nimbo» (apagado por defecto) | Tu propio PC: el micrófono queda abierto para el reconocedor de voz de Windows sin internet (System.Speech), que solo reconoce la frase de activación | No se graba, guarda ni envía nada. Después de la frase, lo que dices pasa por el dictado local (Whisper) y luego, como un mensaje normal del chat, a tu Claude |
| Termina un trabajo (evento "Stop" de Claude Code) | Tu propio PC: Nimbo le pregunta a Windows qué programa está al frente (PowerShell, `osascript` o `xdotool`) para callarse si es una terminal, un editor o la app de Claude | Nada sale de tu PC y la respuesta no se guarda |
| GitHub está conectado (`gh` instalado y con sesión) | GitHub, con tu propia sesión de `gh`, cada 5 minutos | La consulta de tus notificaciones sin leer |
| El conector de Trello está activo en tu Claude | Trello, a través de tu Claude: tu lista de tableros una vez al día, y las tarjetas de un tablero cuando lo abres | Una consulta de solo lectura de tus tableros y de las tarjetas abiertas del tablero que abriste |
| Buscas una canción en el chat (conector de Spotify activo en tu Claude) | Spotify, a través de tu Claude | Las palabras que buscaste |
| Pulsas **Generar aquí** en una tarjeta de encargo (Gemini; opcional) | Google (Gemini), con la clave que pegaste | El texto de ese encargo. Las imágenes se guardan en `Imágenes\Nimbo` en tu PC. **Abrir en Gemini** no envía nada: copia el texto y abre la web de Gemini |
| Eliges el motor API de Claude (clic derecho → Motor de Nimbo; opcional, apagado por defecto) | Anthropic, por su API con la clave que pegaste (la misma empresa de tu `claude`) | Lo que le escribes a Nimbo (también desde Telegram), imágenes y archivos de texto o PDF que adjuntes, tus recordatorios y el plan del día, y, si la lectura de WhatsApp está activa, el texto de las notificaciones de WhatsApp a resumir. Las claves quedan en tu PC, cifradas por Windows |
| Usas otra IA en el chat (Ollama, Gemini u OpenAI; opcional) | Ollama: tu propio PC. Gemini / OpenAI: el proveedor que elegiste, con la clave que pegaste | Lo que escribes y los últimos mensajes de esa conversación. Los adjuntos nunca van ahí; van a Claude. Las claves quedan en tu PC, cifradas por Windows |
| Activas el correo (opcional) | Gmail, a través de tu propio Claude y su conector de Gmail, solo lectura | Remitente, asunto y una vista previa de tus correos sin leer recientes, que Anthropic procesa para resumirlos. Nimbo nunca abre el cuerpo de un mensaje. Lo que guarda (`mail.json`) se borra al apagarlo |
| Conectas Telegram (opcional, con tu propio bot) | Telegram (api.telegram.org), directo desde tu PC, preguntando por mensajes nuevos cada pocos segundos | Lo que le escribes a tu bot y las respuestas de Nimbo, que Telegram puede leer (los chats con bots no están cifrados de punta a punta). El token del bot queda en tu PC, cifrado por Windows. Con los avisos al celular activos, Telegram también recibe el título de un chat de Claude Code, el nombre de una herramienta, el texto de los recordatorios y el remitente y asunto de correos importantes (WhatsApp urgente: solo el nombre del chat, y apagado por defecto) |
| Conectas Spotify con Premium (opcional, con tu propia app de Spotify) | Spotify, directo desde tu PC | Las palabras que buscas y la canción que eliges. Un token de renovación queda en tu PC, cifrado por Windows |
| Tocas Letra en la tarjeta de música | LRCLIB (lrclib.net, una biblioteca comunitaria y gratuita de letras), directo desde tu PC | El título, el artista, el álbum y la duración de la canción que suena |
| Activas "Leer mensajes de WhatsApp" | Un modelo local (Ollama) si lo tienes: nada sale del PC. Si no, Anthropic, con tu `claude` | El texto de las notificaciones de WhatsApp que Windows ya te mostró |
| Activas la voz y configuras `ttsUrl` | El servicio de voz que **tú** configuraste | El texto de cada respuesta |
| Dictas por primera vez | Hugging Face | Nada tuyo: descarga el modelo de voz una vez. Tu audio se transcribe en tu PC |
| Haces clic en un enlace o en "Guía" | Tu navegador abre GitHub, Trello, claude.ai o la página que elegiste | Nada de Nimbo |

Los pantallazos se toman solo cuando pulsas el botón de pantalla, y se envían solo cuando mandas el mensaje.

Nimbo no guarda contraseñas, tokens ni claves de API, con una excepción opcional: si conectas Spotify con Premium o Telegram, su token queda en tu PC, cifrado por Windows, hasta que pulses Desconectar.

Dudas o inquietudes: abre un issue en este repositorio.

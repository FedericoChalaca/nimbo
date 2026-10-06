# Servicio de voz de ejemplo / Example voice service

**Español.** Nimbo no habla con ElevenLabs ni guarda claves: manda el texto a un servicio tuyo y reproduce el mp3 que vuelve. Esta carpeta es ese servicio, listo para desplegar.

1. Crea una cuenta en [ElevenLabs](https://elevenlabs.io) y copia tu clave de API.
2. Elige dos voces en su biblioteca y copia el id de cada una (está en los detalles de la voz).
3. Despliega esta carpeta. Con [Vercel](https://vercel.com):

```bash
npx vercel deploy --prod
```

4. En el proyecto desplegado, agrega estas variables de entorno y vuelve a desplegar:

| Variable | Qué es |
|---|---|
| `ELEVENLABS_API_KEY` | Tu clave de ElevenLabs |
| `VOICE_ID` | Id de la voz para la apariencia JARVIS |
| `VOICE_ID_NUBE` | Id de la voz para la apariencia Nube |

5. Pon la dirección en `%APPDATA%\nimbo\prefs.json` y reinicia Nimbo:

```json
{ "ttsUrl": "https://tu-proyecto.vercel.app/api/tts" }
```

6. En Nimbo: Conexiones → Voz → **Activar**.

Importante: este servicio no pide contraseña. Quien conozca la dirección puede gastar tu cuota de ElevenLabs, así que no la publiques. Nimbo la guarda solo en tu `prefs.json`.

Prueba sin red ni clave:

```bash
node api/tts.js
```

---

**English.** Nimbo does not talk to ElevenLabs and stores no keys: it sends the text to a service of yours and plays the mp3 that comes back. This folder is that service, ready to deploy.

1. Create an [ElevenLabs](https://elevenlabs.io) account and copy your API key.
2. Pick two voices in their library and copy each voice id (shown in the voice details).
3. Deploy this folder. With [Vercel](https://vercel.com): `npx vercel deploy --prod`.
4. Add the environment variables from the table above (`ELEVENLABS_API_KEY`, `VOICE_ID`, `VOICE_ID_NUBE`) and redeploy.
5. Put the address in `%APPDATA%\nimbo\prefs.json` as `ttsUrl` and restart Nimbo.
6. In Nimbo: Connections → Voice → **Turn on**.

Important: this service has no password. Anyone who knows the address can spend your ElevenLabs quota, so do not publish it. Nimbo keeps it only in your `prefs.json`.

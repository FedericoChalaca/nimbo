// Dictado (🎤): hablas y el texto aparece en el cuadro del chat.
// Escucha con Whisper local (stt-worker.js): el audio nunca sale del PC.
// Usa los globales de index.html: api, setState, label, root, msg, chat…
(() => {
  const SR = 16000; // Whisper espera audio mono a 16 kHz
  const SPEECH_RMS = 0.015; // por encima de esto, hay alguien hablando
  const END_SILENCE_MS = 1100; // este silencio después de hablar = terminaste la frase
  const MIN_SPEECH_MS = 350;
  const MAX_MS = 30_000;
  const PREROLL = 0.3 * SR; // guarda 0,3 s antes de que empieces, para no comerse la primera sílaba

  // Whisper a veces "oye" estas frases en el silencio.
  const HALLUCINATIONS = /^(gracias( por ver)?|subt[ií]tulos|¡?suscr[ií]bete|amara\.org|\.+|…)/i;

  const worker = new Worker("stt-worker.js", { type: "module" });
  let nextId = 0;
  const waiting = new Map();
  const firstSeen = {}; // archivo del modelo → cuándo llegó su primer aviso de progreso
  worker.onmessage = ({ data }) => {
    // Solo mientras descarga de verdad: con el modelo en caché también llegan avisos al 100%.
    if (data.type === "progress" && data.file?.endsWith(".onnx")) {
      const downloading = label.textContent.startsWith("Descargando el oído");
      // Desde la caché el archivo llega al 100 % en un momento; si tras 1,5 s sigue a medias,
      // es una descarga de verdad y vale la pena avisar.
      firstSeen[data.file] ??= Date.now();
      if (data.progress < 100 && Date.now() - firstSeen[data.file] > 1500) {
        label.textContent = `Descargando el oído de Nimbo… ${Math.round(data.progress)}%`;
        label.classList.add("show");
      } else if (downloading) {
        label.classList.remove("show");
      }
    }
    if (data.id == null || !waiting.has(data.id)) return;
    const resolve = waiting.get(data.id);
    waiting.delete(data.id);
    resolve(data.type === "text" ? data.text : "");
    if (data.type === "error") setState("error", `Oído: ${data.error}`.slice(0, 80), { back: 6000 });
  };
  function transcribe(audio) {
    const id = nextId++;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ id, audio }, [audio.buffer]);
    });
  }

  // --- Micrófono: solo abierto mientras dictas ---
  let ctx, stream, source, proc;
  let rec = null; // la frase que se está grabando ahora

  async function openMic() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new AudioContext({ sampleRate: SR });
    source = ctx.createMediaStreamSource(stream);
    // ponytail: ScriptProcessor está deprecado pero es una línea; AudioWorklet si algún día molesta.
    proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (e) => onChunk(e.inputBuffer.getChannelData(0));
    source.connect(proc);
    proc.connect(ctx.destination);
  }
  function closeMic() {
    proc?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close();
    proc = source = stream = ctx = null;
  }

  function onChunk(buf) {
    if (!rec) return;
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    // Nimbo crece con tu voz mientras te escucha.
    Jarvis.setLevel(Math.min(rms * 14, 1));
    root.style.setProperty("--lvl", Math.min(rms * 14, 1).toFixed(2));

    const ms = (buf.length / SR) * 1000;
    rec.total += ms;
    rec.chunks.push(new Float32Array(buf));
    if (rms > SPEECH_RMS) {
      rec.speech += ms;
      rec.silence = 0;
    } else {
      rec.silence += ms;
    }
    // Antes de que hables solo se guarda un poquito, el resto se descarta.
    if (!rec.speech) while (rec.chunks.length * buf.length > PREROLL) rec.chunks.shift();
    if ((rec.speech > MIN_SPEECH_MS && rec.silence > END_SILENCE_MS) || rec.total > MAX_MS) finish();
  }

  /** Graba una frase: termina sola cuando te callas (o con finish()). */
  function listenOnce() {
    return new Promise((resolve) => {
      rec = { chunks: [], speech: 0, silence: 0, total: 0, resolve };
    });
  }
  function finish() {
    if (!rec) return;
    const { chunks, speech, resolve } = rec;
    rec = null;
    Jarvis.setLevel(0);
    root.style.setProperty("--lvl", 0);
    if (speech < MIN_SPEECH_MS) return resolve(null);
    const audio = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) { audio.set(c, off); off += c.length; }
    resolve(audio);
  }

  let dictating = false;
  async function dictate() {
    if (dictating) return finish(); // segundo clic = ya terminé
    dictating = true;
    micBtn.classList.add("live");
    try {
      await openMic();
      setState("listening", "Te escucho… (clic en 🎤 para terminar)");
      const audio = await listenOnce();
      if (audio) {
        setState("thinking", "Transcribiendo…");
        const text = await transcribe(audio);
        if (text && !HALLUCINATIONS.test(text)) msg.value = (msg.value ? msg.value + " " : "") + text;
      }
      setState("idle");
    } catch (e) {
      const denied = e?.name === "NotAllowedError" || e?.name === "NotFoundError";
      setState("error", denied ? "No tengo micrófono: revisa Privacidad → Micrófono en Windows" : `Micrófono: ${e?.message ?? e}`.slice(0, 80), { back: 6000 });
    } finally {
      dictating = false;
      micBtn.classList.remove("live");
      closeMic();
      msg.focus();
    }
  }

  const micBtn = document.getElementById("mic");
  micBtn.addEventListener("click", dictate);
  // Precarga el modelo al abrir el chat, para que el primer dictado no espere la descarga.
  chat.addEventListener("focusin", () => worker.postMessage({ type: "load" }), { once: true });
})();

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

  // El worker se crea al primer uso (al abrir el chat o dictar): importar Whisper pesa y no hace falta al arrancar.
  let worker = null;
  // Con el modelo cargado el worker ocupa ~350 MB: si pasan 3 min sin dictar, se cierra y la memoria vuelve (la próxima vez carga desde la caché en unos segundos).
  let idleTimer = 0;
  function getWorker() {
    if (!worker) { worker = new Worker("stt-worker.js", { type: "module" }); worker.onmessage = onWorkerMessage; }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!waiting.size && !rec) { worker.terminate(); worker = null; } }, 3 * 60_000);
    return worker;
  }
  let nextId = 0;
  const waiting = new Map();
  const firstSeen = {}; // archivo del modelo → cuándo llegó su primer aviso de progreso
  const onWorkerMessage = ({ data }) => {
    // Solo mientras descarga de verdad: con el modelo en caché también llegan avisos al 100%.
    if (data.type === "progress" && data.file?.endsWith(".onnx")) {
      const downloading = label.textContent.startsWith(t("Descargando el oído"));
      // Desde la caché el archivo llega al 100 % en un momento; si tras 1,5 s sigue a medias,
      // es una descarga de verdad y vale la pena avisar.
      firstSeen[data.file] ??= Date.now();
      if (data.progress < 100 && Date.now() - firstSeen[data.file] > 1500) {
        label.textContent = t("Descargando el oído de Nimbo… {0}%", Math.round(data.progress));
        label.classList.add("show");
      } else if (downloading) {
        label.classList.remove("show");
      }
    }
    if (data.id == null || !waiting.has(data.id)) return;
    const resolve = waiting.get(data.id);
    waiting.delete(data.id);
    resolve(data.type === "text" ? data.text : "");
    if (data.type === "error") setState("error", t("Oído: {0}", data.error).slice(0, 80), { back: 6000 });
  };
  function transcribe(audio) {
    const id = nextId++;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      getWorker().postMessage({ id, audio, language: LANG === "en" ? "english" : "spanish" }, [audio.buffer]);
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
    // Ruido de fondo del cuarto (ventilador, música bajita): con él encima de un umbral fijo nunca "te callabas" y el dictado esperaba
    // los 30 s enteros. Piso de ruido: baja de golpe al trozo más silencioso y sube despacito (2 % por trozo de 0,13 s).
    rec.floor = rec.floor == null ? rms : Math.min(rec.floor * 1.02, rms);
    if (rms > Math.max(SPEECH_RMS, rec.floor * 2.5)) {
      rec.speech += ms;
      rec.silence = 0;
    } else {
      rec.silence += ms;
    }
    // Antes de que hables solo se guarda un poquito, el resto se descarta.
    if (!rec.speech) while (rec.chunks.length * buf.length > PREROLL) rec.chunks.shift();
    if ((rec.speech > MIN_SPEECH_MS && rec.silence > END_SILENCE_MS) || rec.total > MAX_MS) finish();
  }
  const joinAudio = (chunks) => { const a = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { a.set(c, o); o += c.length; } return a; };
  // Texto en vivo: el dictado de Windows (live.ps1, en main) va escribiendo lo que oye mientras Whisper graba. Medido en este PC: con
  // Whisper como vista previa, la primera palabra llegaba a los 4 s y el texto final se atrasaba ~3 s más; Windows escribe al instante.
  api.onDictationPartial?.((text) => {
    if (!rec || !text) return;
    msg.value = (rec.base ? rec.base + " " : "") + text;
    msg.classList.add("partial");
  });

  /** Graba una frase: termina sola cuando te callas (o con finish()). */
  function listenOnce() {
    return new Promise((resolve) => {
      rec = { chunks: [], speech: 0, silence: 0, total: 0, resolve, base: msg.value.trim() };
    });
  }
  function finish() {
    if (!rec) return;
    const r = rec;
    rec = null;
    Jarvis.setLevel(0);
    root.style.setProperty("--lvl", 0);
    if (r.speech < MIN_SPEECH_MS) return r.resolve(null);
    r.resolve({ audio: joinAudio(r.chunks), r });
  }
  const finalText = ({ audio }) => transcribe(audio);
  // Con «Oye Nimbo» lo que dijiste se envía solo, pero antes se queda 2 s a la vista: tocar el cuadro o escribir lo detiene para corregir.
  function sendSoon() {
    return new Promise((resolve) => {
      let left = 2;
      const box = el("div", "asked", t("Te entendí: «{0}»", msg.value.trim().slice(0, 160)));
      const note = el("div", "afoot", t("Lo envío en {0} s… (toca el cuadro o escribe para corregir)", left));
      answer.classList.remove("wait");
      answer.replaceChildren(box, note);
      answerBox.classList.remove("hidden");
      const stop = (send) => {
        clearInterval(tick);
        msg.removeEventListener("keydown", hold);
        msg.removeEventListener("mousedown", hold);
        if (send) chat.requestSubmit();
        else note.textContent = t("Listo: corrígelo y envíalo con Enter.");
        resolve();
      };
      const hold = () => stop(false);
      msg.addEventListener("keydown", hold);
      msg.addEventListener("mousedown", hold);
      const tick = setInterval(() => { left--; if (left <= 0) stop(true); else note.textContent = t("Lo envío en {0} s… (toca el cuadro o escribe para corregir)", left); }, 1000);
    });
  }

  let dictating = false;
  // autoSend: lo pidió "Oye Nimbo": al terminar de hablar, lo que dijiste se envía solo (como Siri).
  async function dictate({ autoSend = false } = {}) {
    if (dictating) return finish(); // segundo clic = ya terminé
    stopSpeaking(); // si Nimbo estaba hablando, se calla para escucharte
    dictating = true;
    // Mientras hablas, Whisper se carga (si se había soltado de la memoria): así no hay que esperarlo al terminar (hasta 3,7 s en este PC).
    getWorker().postMessage({ type: "load" });
    micBtn.classList.add("live");
    try {
      await openMic();
      api.liveDictation?.(true);
      setState("listening", t("Te escucho… (clic en 🎤 para terminar)"));
      if (autoSend) { answer.classList.remove("wait"); answer.replaceChildren(el("div", "afoot", t("Te escucho: lo que digas aparece en el cuadro."))); answerBox.classList.remove("hidden"); }
      const heard = await listenOnce();
      api.liveDictation?.(false);
      if (heard) {
        setState("thinking", t("Transcribiendo…"));
        const text = await finalText(heard);
        msg.value = [heard.r.base, text && !HALLUCINATIONS.test(text) ? text : ""].filter(Boolean).join(" ");
      }
      msg.classList.remove("partial");
      setState("idle");
      if (autoSend && heard && msg.value.trim()) await sendSoon();
    } catch (e) {
      const denied = e?.name === "NotAllowedError" || e?.name === "NotFoundError";
      setState("error", denied ? t("No tengo micrófono: revisa Privacidad → Micrófono en Windows") : t("Micrófono: {0}", e?.message ?? e).slice(0, 80), { back: 6000 });
    } finally {
      dictating = false;
      api.liveDictation?.(false);
      msg.classList.remove("partial");
      micBtn.classList.remove("live");
      closeMic();
      msg.focus();
    }
  }

  const micBtn = document.getElementById("mic");
  micBtn.addEventListener("click", () => dictate());
  window.voiceDictate = dictate; // para "Oye Nimbo" (app.js)
  // Precarga el modelo al abrir el chat, para que el primer dictado no espere la descarga.
  chat.addEventListener("focusin", () => getWorker().postMessage({ type: "load" }), { once: true });
})();

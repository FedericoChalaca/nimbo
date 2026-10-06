// Transcripción de voz con Whisper, local (el audio nunca sale del PC).
// Corre en un worker para que las animaciones no se traben mientras transcribe.
// La primera vez descarga el modelo (~80 MB) de Hugging Face y queda en caché.
import { pipeline, env } from "./node_modules/@huggingface/transformers/dist/transformers.min.js";

env.allowLocalModels = false;
// El runtime WebAssembly sale de node_modules, no de un CDN. npm lo deja dentro de
// transformers o en la raíz según qué más haya instalado: se usa el que exista.
const RUNTIMES = [
  "./node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/",
  "./node_modules/onnxruntime-web/dist/",
].map((p) => new URL(p, import.meta.url).href);
// Ojo: sin await suelto aquí arriba. Mientras el módulo espera, los mensajes que
// llegan antes de definir onmessage se pierden y el dictado se queda colgado.
async function useLocalRuntime() {
  for (const dir of RUNTIMES) {
    if ((await fetch(dir + "ort-wasm-simd-threaded.asyncify.mjs").catch(() => null))?.ok) {
      env.backends.onnx.wasm.wasmPaths = dir;
      return;
    }
  }
}
// Pocos hilos: dictar es corto y así no le quita CPU a lo que estés haciendo (p. ej. jugar).
env.backends.onnx.wasm.numThreads = 4;

// Medido en este portátil (frase de 4 s, PC libre): base en CPU ~2,5 s. small era
// más preciso pero tardaba 8,5–13,5 s: demasiado para dictar.
const MODEL = "onnx-community/whisper-base";
let asr = null;
const downloading = new Set(); // archivos que se están bajando de internet (no de la caché)

function load() {
  asr ??= useLocalRuntime().then(() => pipeline("automatic-speech-recognition", MODEL, {
    device: "wasm",
    dtype: "q8",
    // Solo avisa si de verdad descarga: leyendo de la caché también llegan eventos "progress".
    progress_callback: (p) => {
      if (p.status === "download") downloading.add(p.file);
      if (p.status === "progress" && downloading.has(p.file)) postMessage({ type: "progress", file: p.file, progress: p.progress });
    },
  }));
  return asr;
}

onmessage = async ({ data }) => {
  try {
    const transcriber = await load();
    if (data.type === "load") return postMessage({ type: "ready" });
    const out = await transcriber(data.audio, { language: data.language === "english" ? "english" : "spanish", task: "transcribe" });
    postMessage({ type: "text", id: data.id, text: out.text.trim() });
  } catch (e) {
    asr = null; // si falló la carga, el próximo intento vuelve a probar
    postMessage({ type: "error", id: data.id, error: String(e?.message ?? e) });
  }
};

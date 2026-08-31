/** Preloaded filler audio — zero network latency on first response. */

const INTENTS = ['lookup', 'portfolio', 'navigate', 'action', 'default'];
const cache = new Map();
let preloadPromise = null;
let audioCtx = null;

function baseUrl() {
  return import.meta.env.VITE_API_URL || '';
}

export async function preloadFillers() {
  if (preloadPromise) return preloadPromise;
  preloadPromise = Promise.all(
    INTENTS.map(async (intent) => {
      try {
        const res = await fetch(`${baseUrl()}/api/voice/filler/${intent}`);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const text = res.headers.get('X-Filler-Text') || '';
        cache.set(intent, { buf, text });
      } catch {
        // Warm cache is best-effort.
      }
    }),
  );
  return preloadPromise;
}

export function getCachedFiller(intent) {
  return cache.get(intent) || cache.get('default') || null;
}

/** Play a cached filler immediately — returns phrase text when known. */
export async function playCachedFiller(intent = 'default') {
  const entry = getCachedFiller(intent);
  if (!entry?.buf?.byteLength) return null;

  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const decoded = await audioCtx.decodeAudioData(entry.buf.slice(0));
  const source = audioCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(audioCtx.destination);
  source.start();

  await new Promise((resolve) => {
    source.onended = resolve;
    setTimeout(resolve, decoded.duration * 1000 + 40);
  });
  return entry.text || null;
}

export function stopFillerAudio() {
  try {
    audioCtx?.close();
  } catch {
    // ignore
  }
  audioCtx = null;
}

/** Delayed, rotating ack fillers — only when the real response is slow to arrive. */

import { pickFillerIntent } from './veraFillers';

const INTENTS = ['lookup', 'portfolio', 'navigate', 'action'];
/** intent -> [{ text, buf }] */
const phrasePools = new Map();
let poolLoadPromise = null;
let audioContext = null;
const recentTexts = [];
const MAX_RECENT = 6;

function baseUrl() {
  return import.meta.env.VITE_API_URL || '';
}

function remember(text) {
  recentTexts.unshift(text);
  if (recentTexts.length > MAX_RECENT) recentTexts.pop();
}

function pickRotated(pool) {
  if (!pool?.length) return null;
  const fresh = pool.filter((p) => !recentTexts.includes(p.text));
  const choices = fresh.length ? fresh : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  remember(pick.text);
  return pick;
}

export async function preloadFillers() {
  if (poolLoadPromise) return poolLoadPromise;
  poolLoadPromise = (async () => {
    try {
      const res = await fetch(`${baseUrl()}/api/voice/fillers/bundle`);
      if (!res.ok) return;
      const bundle = await res.json();
      for (const intent of INTENTS) {
        const items = (bundle[intent] || []).map((item) => ({
          text: item.text,
          buf: Uint8Array.from(atob(item.audio_b64), (c) => c.charCodeAt(0)).buffer,
        }));
        if (items.length) phrasePools.set(intent, items);
      }
    } catch {
      // Best-effort warm cache.
    }
  })();
  return poolLoadPromise;
}

async function playEntry(entry) {
  if (!entry?.buf) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  const decoded = await audioContext.decodeAudioData(entry.buf.slice(0));
  const source = audioContext.createBufferSource();
  source.buffer = decoded;
  source.connect(audioContext.destination);
  source.start();
  await new Promise((resolve) => {
    source.onended = resolve;
    setTimeout(resolve, decoded.duration * 1000 + 40);
  });
  return entry.text;
}

/** Arm a delayed filler — cancelled automatically when the real response starts. */
export function createDelayedFiller({
  delayMs = 520,
  onPhrase,
  blockMainAudio,
  unblockMainAudio,
}) {
  let timer = null;
  let playing = null;
  let armed = false;

  function cancel() {
    armed = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function arm(message) {
    cancel();
    const intent = pickFillerIntent(message);
    if (!intent) return;

    armed = true;
    timer = setTimeout(() => {
      timer = null;
      if (!armed) return;
      const pool = phrasePools.get(intent);
      const entry = pickRotated(pool);
      if (!entry) return;

      blockMainAudio?.();
      playing = playEntry(entry)
        .then((phrase) => {
          if (phrase) onPhrase?.(phrase);
          return phrase;
        })
        .finally(() => {
          playing = null;
          unblockMainAudio?.();
        });
    }, delayMs);
  }

  return { arm, cancel, get playing() { return playing; } };
}

export function stopFillerAudio() {
  try {
    audioContext?.close();
  } catch {
    // ignore
  }
  audioContext = null;
}

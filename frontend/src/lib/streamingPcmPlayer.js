/** Gapless PCM playback via Web Audio — one continuous utterance, no chunk gaps. */

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class StreamingPcmPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.audioContext = null;
    this.nextStartTime = 0;
    this.scheduled = false;
    this.aborted = false;
    this.mainBlocked = false;
    this.pendingMainChunks = [];
    this._unblockResolvers = [];
  }

  async ensureContext() {
    if (this.aborted) return;
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /** Hold main reply audio until instant ack filler finishes (ChatGPT-style). */
  blockMainAudio() {
    this.mainBlocked = true;
  }

  unblockMainAudio() {
    if (!this.mainBlocked) return;
    this.mainBlocked = false;
    const queued = this.pendingMainChunks.splice(0);
    for (const b64 of queued) void this._playBase64ChunkNow(b64);
    for (const resolve of this._unblockResolvers.splice(0)) resolve();
  }

  waitUntilUnblocked() {
    if (!this.mainBlocked) return Promise.resolve();
    return new Promise((resolve) => this._unblockResolvers.push(resolve));
  }

  async _scheduleBuffer(buffer) {
    await this.ensureContext();
    if (!this.audioContext) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    if (!this.scheduled || this.nextStartTime < now + 0.02) {
      this.nextStartTime = now + 0.03;
      this.scheduled = true;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  /** Play cached MP3 filler — returns when scheduled duration completes. */
  async playMp3Url(url) {
    if (this.aborted || !url) return;
    await this.ensureContext();
    if (!this.audioContext) return;

    const res = await fetch(url);
    if (!res.ok) return;
    const phrase = res.headers.get('X-Filler-Text') || '';
    const buf = await res.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await this.audioContext.decodeAudioData(buf.slice(0));
    } catch {
      return;
    }

    const startAt = this.nextStartTime > this.audioContext.currentTime + 0.02
      ? this.nextStartTime
      : this.audioContext.currentTime + 0.02;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
    this.scheduled = true;

    await new Promise((resolve) => {
      source.onended = resolve;
      setTimeout(resolve, audioBuffer.duration * 1000 + 80);
    });
    return phrase;
  }

  async _playBase64ChunkNow(b64) {
    if (this.aborted || !b64) return;
    await this.ensureContext();
    if (!this.audioContext) return;

    const pcmBytes = b64ToBytes(b64);
    const int16 = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength / 2,
    );
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, this.sampleRate);
    buffer.copyToChannel(float32, 0);
    await this._scheduleBuffer(buffer);
  }

  async playChunk(pcmBytes) {
    if (this.aborted || !pcmBytes?.byteLength) return;
    await this.ensureContext();
    if (!this.audioContext) return;

    const int16 = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength / 2,
    );
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, this.sampleRate);
    buffer.copyToChannel(float32, 0);
    await this._scheduleBuffer(buffer);
  }

  async playBase64Chunk(b64) {
    if (this.aborted || !b64) return;
    if (this.mainBlocked) {
      this.pendingMainChunks.push(b64);
      return;
    }
    await this._playBase64ChunkNow(b64);
  }

  waitUntilIdle() {
    return new Promise((resolve) => {
      const tick = () => {
        if (this.aborted || !this.audioContext || !this.scheduled) return resolve();
        const remainingMs = (this.nextStartTime - this.audioContext.currentTime) * 1000;
        if (remainingMs <= 60) return resolve();
        setTimeout(tick, Math.min(remainingMs, 250));
      };
      tick();
    });
  }

  stop() {
    this.aborted = true;
    this.mainBlocked = false;
    this.pendingMainChunks = [];
    for (const resolve of this._unblockResolvers.splice(0)) resolve();
    try {
      this.audioContext?.close();
    } catch {
      // ignore
    }
    this.audioContext = null;
    this.nextStartTime = 0;
    this.scheduled = false;
  }
}

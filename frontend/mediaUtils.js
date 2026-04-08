/**
 * mediaUtils.js — Audio capture & playback pipeline
 * ────────────────────────────────────────────────────
 *  AudioCapture  — mic → 16 kHz Int16 PCM → base64 chunks
 *  AudioPlayer   — base64 24 kHz Int16 PCM → speaker (gapless)
 *  Shared utils  — downsample, float32↔int16, base64 encode/decode
 */

// ═══════════════════════════════════════════════════════════════
//  AudioCapture
//  Captures microphone audio, downsamples to 16 kHz and delivers
//  base64-encoded PCM chunks via the onChunk callback.
// ═══════════════════════════════════════════════════════════════
class AudioCapture {
  /**
   * @param {(base64: string) => void} onChunk  - called for each PCM chunk
   * @param {(rms: number) => void}   [onLevel] - optional volume callback (0–1)
   */
  constructor(onChunk, onLevel) {
    this.onChunk  = onChunk;
    this.onLevel  = onLevel || (() => {});
    this._ctx     = null;
    this._stream  = null;
    this._proc    = null;
    this._src     = null;
    this._active  = false;
  }

  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount:     1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       { ideal: 16000 }
      }
    });

    // Use native context — we'll downsample manually if needed
    this._ctx = new AudioContext();
    const nativeRate = this._ctx.sampleRate;

    this._src  = this._ctx.createMediaStreamSource(this._stream);
    this._proc = this._ctx.createScriptProcessor(4096, 1, 1);

    this._proc.onaudioprocess = (e) => {
      const raw = e.inputBuffer.getChannelData(0); // Float32, native rate

      // Volume meter
      let sum = 0;
      for (let i = 0; i < raw.length; i++) sum += raw[i] * raw[i];
      this.onLevel(Math.sqrt(sum / raw.length));

      if (!this._active) return;

      // Downsample → 16 kHz → Int16 → base64
      const down = _downsample(raw, nativeRate, 16000);
      const pcm  = _f32ToI16(down);
      this.onChunk(_toBase64(pcm.buffer));
    };

    this._src.connect(this._proc);
    this._proc.connect(this._ctx.destination);
    this._active = true;
  }

  /** Toggle whether audio is actually sent (mute/unmute) */
  setActive(active) { this._active = active; }
  get active()      { return this._active; }

  stop() {
    this._active = false;
    this._proc?.disconnect();
    this._src?.disconnect();
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close();
    this._proc = this._src = this._stream = this._ctx = null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  AudioPlayer
//  Accepts base64-encoded 24 kHz Int16 PCM chunks and plays them
//  gaplessly by scheduling against the AudioContext clock.
// ═══════════════════════════════════════════════════════════════
class AudioPlayer {
  constructor() {
    this._ctx      = null;
    this._nextTime = 0;
    this._gainNode = null;
  }

  /** Play a base64 PCM chunk (24 kHz, Int16, little-endian) */
  play(base64) {
    if (!this._ctx) {
      this._ctx      = new AudioContext({ sampleRate: 24000 });
      this._gainNode = this._ctx.createGain();
      this._gainNode.connect(this._ctx.destination);
    }
    if (this._ctx.state === "suspended") this._ctx.resume();

    const f32 = _fromBase64(base64);
    if (!f32.length) return;

    const buf = this._ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);

    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._gainNode);

    const now = this._ctx.currentTime;
    // Small lookahead to absorb scheduling jitter
    if (this._nextTime < now + 0.02) this._nextTime = now + 0.02;
    src.start(this._nextTime);
    this._nextTime += buf.duration;
  }

  /** Call when a turn ends or is interrupted — resets the queue */
  reset() {
    this._nextTime = this._ctx ? this._ctx.currentTime : 0;
  }

  get isPlaying() {
    return this._ctx
      ? this._ctx.currentTime < this._nextTime
      : false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Private utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Downsample a Float32Array from fromRate to toRate using linear interpolation.
 */
function _downsample(buf, fromRate, toRate) {
  if (fromRate === toRate) return buf;
  const ratio  = fromRate / toRate;
  const len    = Math.round(buf.length / ratio);
  const out    = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos  = i * ratio;
    const lo   = Math.floor(pos);
    const hi   = Math.min(lo + 1, buf.length - 1);
    const frac = pos - lo;
    out[i]     = buf[lo] * (1 - frac) + buf[hi] * frac;
  }
  return out;
}

/** Float32 [-1,1] → Int16 PCM */
function _f32ToI16(buf) {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const s  = Math.max(-1, Math.min(1, buf[i]));
    out[i]   = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

/** ArrayBuffer → base64 string */
function _toBase64(buffer) {
  const bytes  = new Uint8Array(buffer);
  const CHUNK  = 8192;
  let   binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** base64 Int16 PCM → Float32Array */
function _fromBase64(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;
  return f32;
}

// WebAudio synth — no asset deps. Generates all SFX procedurally.
//
// Signal chain:  voices ─┬─► master(gain) ─► limiter(comp) ─► destination
//                        └─► send ─► reverb(convolver) ─► verbReturn ─► limiter
//
// The limiter glues stacked hits and stops clipping when a brawl fires a dozen
// cues at once. A short procedural reverb adds space; per-voice stereo pan +
// random pitch detune keep repeated hits from sounding like one machine gun.
class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.5;
    this._noiseBuf = null;
    this._last = Object.create(null); // per-cue throttle timestamps
    this.unlock = this.unlock.bind(this);
    addEventListener('pointerdown', this.unlock, { once: true });
    addEventListener('keydown', this.unlock, { once: true });
    addEventListener('touchstart', this.unlock, { once: true });
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();

    // Brick-wall-ish limiter so layered cues never clip or get harsh.
    const limiter = this.limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -7;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);

    const master = this.master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(limiter);

    // Procedural plate-ish reverb on a parallel send bus.
    const reverb = this.reverb = ctx.createConvolver();
    reverb.buffer = this._makeImpulse(1.5, 3.0);
    const verbReturn = this.verbReturn = ctx.createGain();
    verbReturn.gain.value = 0.9;
    reverb.connect(verbReturn);
    verbReturn.connect(limiter);

    // 1s of white noise, reused by every noise burst (no per-shot alloc).
    const buf = this._noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx?.state === 'suspended') this.ctx.resume();
    });
  }

  _makeImpulse(dur, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = (rate * dur) | 0;
    const imp = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const c = imp.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return imp;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  toggleMute() { this.muted = !this.muted; return this.muted; }

  // Throttle a cue key to `minDt` seconds — collapses same-frame duplicate fires
  // (e.g. a multi-hit AoE) into one so nothing machine-guns.
  _gate(key, minDt) {
    const t = this.ctx.currentTime;
    if (this._last[key] !== undefined && t - this._last[key] < minDt) return false;
    this._last[key] = t;
    return true;
  }

  _rand(a, b) { return a + Math.random() * (b - a); }

  // Core voice: schedule one envelope-shaped source into the mix, with optional
  // stereo pan and reverb send. Returns nothing; fire-and-forget.
  _play(src, t0, { a = 0.005, h = 0.05, r = 0.08, peak = 0.4, pan = 0, send = 0 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + h + r);
    src.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); out = p;
    }
    out.connect(this.master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      out.connect(s); s.connect(this.reverb);
    }
    return g;
  }

  _osc(type, f0, f1, t0, dur, opts = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 != null && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (opts.detune) o.detune.value = opts.detune;
    this._play(o, t0, { a: opts.a ?? 0.004, h: opts.h ?? dur * 0.3, r: opts.r ?? dur * 0.7, peak: opts.peak ?? 0.3, pan: opts.pan ?? 0, send: opts.send ?? 0 });
    o.start(t0); o.stop(t0 + dur + 0.06);
    return o;
  }

  _noise(t0, dur, { type = 'lowpass', freq = 2000, q = 0.7, peak = 0.3, pan = 0, send = 0, a = 0.003, sweepTo = null } = {}) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuf;
    n.loop = true;
    n.playbackRate.value = this._rand(0.9, 1.15);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    n.connect(f);
    this._play(f, t0, { a, h: dur * 0.15, r: dur * 0.8, peak, pan, send });
    n.start(t0); n.stop(t0 + dur + 0.06);
  }

  // ---- Back-compat primitives (still used raw by weapons/UI) -----------------
  beep(freq = 440, dur = 0.1, type = 'square', vol = 0.4) {
    if (!this.ctx || this.muted) return;
    this._osc(type, freq, freq, this.ctx.currentTime, dur, { peak: vol, h: dur * 0.35, r: dur * 0.6, pan: this._rand(-0.15, 0.15) });
  }

  noise(dur = 0.2, vol = 0.3, filterFreq = 2000) {
    if (!this.ctx || this.muted) return;
    this._noise(this.ctx.currentTime, dur, { freq: filterFreq, peak: vol });
  }

  sweep(f1, f2, dur, type = 'sawtooth', vol = 0.3) {
    if (!this.ctx || this.muted) return;
    this._osc(type, f1, f2, this.ctx.currentTime, dur, { peak: vol, h: dur * 0.3, r: dur * 0.7, pan: this._rand(-0.12, 0.12) });
  }

  // ---- High-level cues -------------------------------------------------------
  jump() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = this._rand(-0.2, 0.2);
    this._osc('triangle', 300, 560, t, 0.16, { peak: 0.16, pan: p });
    this._noise(t, 0.14, { type: 'highpass', freq: 500, sweepTo: 2600, peak: 0.08, pan: p });
  }

  land(power = 1) {
    if (!this.ctx || this.muted) return;
    if (!this._gate('land', 0.05)) return;
    const t = this.ctx.currentTime, v = Math.min(1, 0.5 + power * 0.5);
    this._osc('sine', 170, 55, t, 0.13, { peak: 0.34 * v, h: 0.01, r: 0.12 });
    this._noise(t, 0.1, { type: 'lowpass', freq: 1100, sweepTo: 350, peak: 0.16 * v });
  }

  punch() { this.hit(0.85); }

  hit(power = 1) {
    if (!this.ctx || this.muted) return;
    if (!this._gate('hit', 0.028)) return;
    const t = this.ctx.currentTime, p = this._rand(-0.25, 0.25), vary = this._rand(0.92, 1.1);
    // sub thump + mid crack + transient noise = weighty impact
    this._osc('sine', 150 * vary, 48, t, 0.14, { peak: 0.4 * power, h: 0.008, r: 0.13, pan: p });
    this._osc('square', 340 * vary, 120, t, 0.07, { peak: 0.22 * power, h: 0.004, r: 0.06, pan: p });
    this._noise(t, 0.07, { type: 'bandpass', freq: 1600 * vary, q: 1.1, peak: 0.26 * power, pan: p, send: 0.1 });
  }

  shoot() {
    if (!this.ctx || this.muted) return;
    if (!this._gate('shoot', 0.02)) return;
    const t = this.ctx.currentTime, p = this._rand(-0.3, 0.3), v = this._rand(0.92, 1.12);
    this._osc('sawtooth', 920 * v, 200, t, 0.09, { peak: 0.22, h: 0.004, r: 0.08, pan: p });
    this._osc('sine', 160, 60, t, 0.06, { peak: 0.16, h: 0.002, r: 0.05, pan: p }); // little kick
    this._noise(t, 0.05, { type: 'highpass', freq: 3000, peak: 0.14, pan: p });
  }

  explode() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 95, 28, t, 0.5, { peak: 0.5, h: 0.02, r: 0.5, send: 0.25 });        // sub boom
    this._noise(t, 0.45, { type: 'lowpass', freq: 400, sweepTo: 1800, peak: 0.42, send: 0.3 }); // body
    this._noise(t + 0.04, 0.4, { type: 'bandpass', freq: 1200, q: 0.6, peak: 0.2, send: 0.35 }); // crackle tail
    this._osc('sawtooth', 140, 40, t, 0.3, { peak: 0.22, h: 0.01, r: 0.3, pan: this._rand(-0.2, 0.2) });
  }

  pickup() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('triangle', 660, 660, t, 0.08, { peak: 0.2, h: 0.03, r: 0.05, send: 0.1 });
    this._osc('sine', 990, 990, t + 0.06, 0.1, { peak: 0.22, h: 0.04, r: 0.07, send: 0.12 });
    this._osc('sine', 1320, 1480, t + 0.12, 0.09, { peak: 0.14, h: 0.02, r: 0.07, send: 0.15 }); // sparkle
  }

  death() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('sawtooth', 440, 70, t, 0.5, { peak: 0.3, h: 0.05, r: 0.45, detune: 8, send: 0.2 });
    this._osc('square', 220, 50, t, 0.45, { peak: 0.16, h: 0.05, r: 0.4, detune: -10 });
    this._noise(t + 0.05, 0.4, { type: 'lowpass', freq: 1400, sweepTo: 200, peak: 0.16, send: 0.2 });
  }

  spawn() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 620, 940, t, 0.12, { peak: 0.22, h: 0.03, r: 0.1, send: 0.15 });
    this._osc('triangle', 1240, 1760, t + 0.05, 0.12, { peak: 0.16, h: 0.02, r: 0.1, send: 0.18 });
  }

  // Airy weapon whoosh (filtered noise sweep) — replaces the old square blip.
  swing() {
    if (!this.ctx || this.muted) return;
    if (!this._gate('swing', 0.04)) return;
    const t = this.ctx.currentTime, p = this._rand(-0.35, 0.35);
    this._noise(t, 0.11, { type: 'bandpass', freq: 900, q: 1.3, sweepTo: 2600, peak: 0.16, pan: p });
  }

  click() {
    if (!this.ctx || this.muted) return;
    this._osc('triangle', 1100, 900, this.ctx.currentTime, 0.035, { peak: 0.16, h: 0.003, r: 0.03 });
  }

  // UI hover — softer/quieter than click.
  hover() {
    if (!this.ctx || this.muted) return;
    if (!this._gate('hover', 0.04)) return;
    this._osc('sine', 720, 760, this.ctx.currentTime, 0.04, { peak: 0.07, h: 0.002, r: 0.035 });
  }

  win() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const tt = t + i * 0.11;
      this._osc('triangle', f, f, tt, 0.18, { peak: 0.26, h: 0.06, r: 0.12, detune: 4, send: 0.18, pan: -0.1 });
      this._osc('sine', f, f, tt, 0.18, { peak: 0.16, h: 0.06, r: 0.12, detune: -4, pan: 0.1 });
    });
    // final shimmer on the top note
    this._osc('sine', 1047, 1568, t + 0.44, 0.3, { peak: 0.14, h: 0.05, r: 0.25, send: 0.25 });
  }

  break() {
    if (!this.ctx || this.muted) return;
    if (!this._gate('break', 0.03)) return;
    const t = this.ctx.currentTime;
    this._osc('square', 380, 180, t, 0.12, { peak: 0.18, h: 0.01, r: 0.1, pan: this._rand(-0.2, 0.2) });
    // two debris bursts for a crunchy shatter
    this._noise(t, 0.16, { type: 'highpass', freq: 2400, peak: 0.26 });
    this._noise(t + 0.05, 0.12, { type: 'bandpass', freq: 1500, q: 0.8, peak: 0.16, pan: this._rand(-0.3, 0.3) });
  }

  // Comedic boing with a bit of body.
  bonk() {
    if (!this.ctx || this.muted) return;
    if (!this._gate('bonk', 0.03)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.18);
    // vibrato wobble = boing
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 22; lg.gain.value = 30;
    lfo.connect(lg); lg.connect(o.frequency);
    this._play(o, t, { a: 0.004, h: 0.04, r: 0.16, peak: 0.34, pan: this._rand(-0.15, 0.15) });
    o.start(t); o.stop(t + 0.24);
    lfo.start(t); lfo.stop(t + 0.24);
  }

  // ---- Extra cues available for wiring --------------------------------------
  block() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = this._rand(-0.2, 0.2);
    this._osc('square', 520, 380, t, 0.06, { peak: 0.16, h: 0.004, r: 0.05, pan: p });
    this._noise(t, 0.08, { type: 'highpass', freq: 3500, peak: 0.2, pan: p }); // metallic clank
  }

  dash() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = this._rand(-0.4, 0.4);
    this._noise(t, 0.16, { type: 'bandpass', freq: 600, q: 1.6, sweepTo: 2400, peak: 0.16, pan: p });
  }

  grab() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('square', 200, 320, t, 0.06, { peak: 0.18, h: 0.004, r: 0.05 });
  }

  throw() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = this._rand(-0.3, 0.3);
    this._noise(t, 0.14, { type: 'bandpass', freq: 1200, q: 1.2, sweepTo: 400, peak: 0.16, pan: p });
    this._osc('sine', 260, 90, t, 0.1, { peak: 0.14, h: 0.005, r: 0.09, pan: p });
  }

  // Match countdown tick (n=3,2,1) and GO.
  countdown() {
    if (!this.ctx || this.muted) return;
    this._osc('square', 660, 660, this.ctx.currentTime, 0.12, { peak: 0.24, h: 0.05, r: 0.08, send: 0.12 });
  }

  go() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this._osc('square', 880, 1320, t, 0.3, { peak: 0.3, h: 0.1, r: 0.2, detune: 6, send: 0.2, pan: -0.1 });
    this._osc('sawtooth', 440, 660, t, 0.3, { peak: 0.16, h: 0.1, r: 0.2, pan: 0.1 });
  }
}

export const audio = new Synth();

// PC-speaker flavoured sound effects synthesised with WebAudio. The
// AudioContext is created lazily on the first user gesture (mobile rule).
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
    // 1 second of white noise for explosions
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }
  ok() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }
  tone(freq, dur, { type = 'square', vol = 0.5, slide = 0, delay = 0 } = {}) {
    if (!this.ok()) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  noise(dur, { vol = 0.6, cutoff = 1200, delay = 0 } = {}) {
    if (!this.ok()) return;
    const t0 = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t0);
    f.frequency.exponentialRampToValueAtTime(80, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }
  fire() {
    this.tone(900, 0.18, { slide: -700, vol: 0.4 });
    this.noise(0.12, { vol: 0.25, cutoff: 3000 });
  }
  explosion(r) {
    const big = r >= 30;
    this.noise(big ? 1.4 : 0.45 + r / 60, { vol: big ? 1 : 0.6, cutoff: big ? 600 : 1500 });
    this.tone(big ? 60 : 120, big ? 1.0 : 0.3, { type: 'sawtooth', slide: -40, vol: 0.4 });
  }
  hit() {
    this.tone(200, 0.12, { slide: -120, vol: 0.4 });
  }
  death() {
    this.tone(500, 0.6, { slide: -450, vol: 0.5 });
    this.noise(0.9, { vol: 0.8, cutoff: 900, delay: 0.1 });
  }
  shield() {
    this.tone(1200, 0.1, { vol: 0.3 });
    this.tone(1600, 0.1, { vol: 0.3, delay: 0.08 });
  }
  dirt() {
    this.noise(0.5, { vol: 0.35, cutoff: 500 });
  }
  laser() {
    this.tone(1800, 0.35, { type: 'sawtooth', slide: -1500, vol: 0.4 });
  }
  click() {
    this.tone(1000, 0.03, { vol: 0.15 });
  }
  select() {
    this.tone(700, 0.05, { vol: 0.2 });
    this.tone(1000, 0.05, { vol: 0.2, delay: 0.05 });
  }
  turn() {
    this.tone(600, 0.06, { vol: 0.2 });
    this.tone(900, 0.08, { vol: 0.2, delay: 0.07 });
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { vol: 0.35, delay: i * 0.13 }));
  }
  lose() {
    [400, 350, 300, 200].forEach((f, i) => this.tone(f, 0.25, { vol: 0.35, delay: i * 0.18 }));
  }
  cash() {
    this.tone(1300, 0.05, { vol: 0.25 });
    this.tone(1700, 0.1, { vol: 0.25, delay: 0.06 });
  }
  fall() {
    this.tone(700, 0.4, { slide: -500, vol: 0.25 });
  }
  bounce() {
    this.tone(300, 0.08, { slide: 200, vol: 0.3 });
  }
}

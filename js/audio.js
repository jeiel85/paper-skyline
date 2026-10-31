// WebAudio 합성 효과음 (외부 음원 파일 없음)
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.wind = null;
  }

  // 브라우저 자동재생 정책 때문에 첫 사용자 입력에서 호출한다
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);

    // 바람: 루프 노이즈 → 밴드패스, 속도에 따라 볼륨·음높이
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const wg = this.ctx.createGain();
    wg.gain.value = 0;
    src.connect(bp).connect(wg).connect(this.master);
    src.start();
    this.wind = { bp, wg };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  setWind(speed, active) {
    if (!this.wind) return;
    const t = this.ctx.currentTime;
    const k = active ? Math.min(1, speed / 50) : 0;
    this.wind.wg.gain.setTargetAtTime(k * 0.22, t, 0.15);
    this.wind.bp.frequency.setTargetAtTime(300 + k * 1400, t, 0.15);
  }

  tone(freq, dur, type = 'sine', vol = 0.25, when = 0, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const gn = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, freq, vol = 0.4) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gn).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  award(combo) {
    const base = 523 * Math.pow(2, Math.min(combo, 8) / 12);
    this.tone(base, 0.18, 'triangle', 0.18);
    this.tone(base * 1.5, 0.22, 'triangle', 0.14, 0.07);
  }
  star() {
    [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.15, i * 0.05));
  }
  launch() { this.burst(0.35, 2500, 0.3); this.tone(300, 0.3, 'sine', 0.1, 0, 2.5); }
  hit() { this.burst(0.25, 1200, 0.5); this.tone(160, 0.2, 'square', 0.08, 0, 0.5); }
  wreck() { this.burst(0.6, 900, 0.6); }
  land(kind) {
    if (kind === 'perfect') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.09));
    else this.burst(0.3, 600, 0.35);
  }
  click() { this.tone(660, 0.06, 'square', 0.06); }
}

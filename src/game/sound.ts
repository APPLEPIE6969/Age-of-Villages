// ============================================================================
// SoundManager: procedural sound effects via Web Audio API.
// No external files, no API keys, no network — all sounds synthesized.
// ============================================================================

export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.3;

  constructor() {
    // AudioContext is created on first user interaction (browser autoplay policy)
  }

  /** Must be called after a user gesture (click/keypress) to unlock audio */
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  setEnabled(v: boolean) { this.enabled = v; }
  setVolume(v: number) {
    this.volume = v;
    if (this.masterGain) this.masterGain.gain.value = v;
  }

  // --- Helper: create an oscillator with envelope ---
  private tone(freq: number, duration: number, type: OscillatorType = 'sine', vol = 0.3, attack = 0.005, decay = 0.1) {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, now + attack + decay + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + attack + decay + duration + 0.1);
  }

  // --- Helper: noise burst (for impacts, whooshes) ---
  private noise(duration: number, vol = 0.2, filterFreq = 1000, filterQ = 1, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
    source.stop(now + duration);
  }

  // --- Helper: frequency sweep (for whoosh, arrow) ---
  private sweep(startFreq: number, endFreq: number, duration: number, vol = 0.2, type: OscillatorType = 'sine') {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, endFreq), now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.1);
  }

  // ====== GAME SOUNDS ======

  /** UI click — selecting a unit or building */
  select() {
    this.tone(880, 0.05, 'sine', 0.15, 0.002, 0.03);
    this.tone(1320, 0.04, 'sine', 0.1, 0.002, 0.02);
  }

  /** Move command — confirmation blip */
  move() {
    this.tone(523, 0.08, 'triangle', 0.12, 0.002, 0.05);
    this.tone(659, 0.06, 'triangle', 0.08, 0.005, 0.04);
  }

  /** Attack command — aggressive tone */
  attackCommand() {
    this.tone(220, 0.1, 'sawtooth', 0.15, 0.002, 0.08);
    this.tone(330, 0.08, 'square', 0.08, 0.005, 0.05);
  }

  /** Gather command — soft confirmation */
  gather() {
    this.tone(440, 0.06, 'sine', 0.1, 0.002, 0.04);
    this.tone(554, 0.05, 'sine', 0.08, 0.005, 0.03);
  }

  /** Build placement — thud + hammer */
  build() {
    this.noise(0.08, 0.2, 200, 1, 'lowpass');
    this.tone(110, 0.1, 'square', 0.1, 0.002, 0.08);
  }

  /** Melee hit — metallic clang + impact */
  meleeHit() {
    this.noise(0.05, 0.25, 3000, 2, 'bandpass');
    this.tone(180, 0.08, 'sawtooth', 0.12, 0.001, 0.06);
    this.tone(320, 0.04, 'square', 0.08, 0.001, 0.03);
  }

  /** Arrow fire — bowstring + whoosh */
  arrow() {
    this.sweep(800, 200, 0.15, 0.12, 'sine');
    this.noise(0.1, 0.08, 2000, 1, 'bandpass');
  }

  /** Unit trained — short fanfare */
  unitTrained() {
    this.tone(523, 0.08, 'triangle', 0.12);
    setTimeout(() => this.tone(659, 0.08, 'triangle', 0.12), 80);
    setTimeout(() => this.tone(784, 0.12, 'triangle', 0.15), 160);
  }

  /** Building complete — bell chime */
  buildingComplete() {
    this.tone(659, 0.3, 'sine', 0.15, 0.01, 0.25);
    this.tone(880, 0.4, 'sine', 0.1, 0.01, 0.35);
  }

  /** Age advancement — triumphant chord */
  ageAdvance() {
    this.tone(523, 0.5, 'triangle', 0.12, 0.05, 0.4);
    this.tone(659, 0.5, 'triangle', 0.1, 0.05, 0.4);
    this.tone(784, 0.5, 'triangle', 0.1, 0.05, 0.4);
    setTimeout(() => {
      this.tone(1047, 0.6, 'sine', 0.15, 0.02, 0.5);
    }, 300);
  }

  /** Error — can't afford / invalid action */
  error() {
    this.tone(200, 0.15, 'sawtooth', 0.15, 0.002, 0.12);
    this.tone(150, 0.12, 'sawtooth', 0.1, 0.005, 0.1);
  }

  /** Enemy wave incoming — warning alarm */
  enemyWave() {
    this.tone(300, 0.2, 'sawtooth', 0.15, 0.01, 0.15);
    setTimeout(() => this.tone(300, 0.2, 'sawtooth', 0.15, 0.01, 0.15), 300);
    setTimeout(() => this.tone(200, 0.4, 'sawtooth', 0.12, 0.01, 0.35), 600);
  }

  /** Victory fanfare */
  victory() {
    this.tone(523, 0.15, 'triangle', 0.15);
    setTimeout(() => this.tone(659, 0.15, 'triangle', 0.15), 150);
    setTimeout(() => this.tone(784, 0.15, 'triangle', 0.15), 300);
    setTimeout(() => this.tone(1047, 0.5, 'triangle', 0.2, 0.02, 0.4), 450);
  }

  /** Defeat — descending tones */
  defeat() {
    this.tone(440, 0.3, 'sawtooth', 0.15, 0.02, 0.25);
    setTimeout(() => this.tone(349, 0.3, 'sawtooth', 0.15, 0.02, 0.25), 300);
    setTimeout(() => this.tone(262, 0.6, 'sawtooth', 0.18, 0.02, 0.5), 600);
  }

  /** Resource gathered — subtle chime (played occasionally) */
  resourceGather() {
    this.tone(880, 0.03, 'sine', 0.04, 0.001, 0.02);
  }

  /** Building under attack — alert */
  underAttack() {
    this.tone(440, 0.1, 'square', 0.12, 0.01, 0.08);
    setTimeout(() => this.tone(440, 0.1, 'square', 0.12, 0.01, 0.08), 200);
  }
}

// Singleton procedural audio engine using Web Audio API
// All sounds are generated with oscillators and noise — no audio files

class TerminalAudio {
  private ctx: AudioContext | null = null;
  private enabled: boolean = false;
  private humGain: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;

  // Lazy-init AudioContext (must be triggered by user interaction)
  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  enable() {
    this.enabled = true;
    if (typeof window !== 'undefined') {
      localStorage.setItem('audioEnabled', '1');
    }
    this.startHum();
  }

  disable() {
    this.enabled = false;
    if (typeof window !== 'undefined') {
      localStorage.setItem('audioEnabled', '0');
    }
    this.stopHum();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Load saved preference
  loadPreference() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('audioEnabled');
      if (stored === '1') {
        this.enabled = true;
      }
    }
  }

  // Check if user has ever set a preference
  hasPreference(): boolean {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('audioEnabled') !== null;
    }
    return false;
  }

  // ── Helper: create white noise buffer ──────────────
  private createNoise(duration: number): AudioBuffer {
    const ctx = this.getCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ── Helper: play a tone with envelope ──────────────
  private playTone(
    freq: number,
    duration: number,
    waveform: OscillatorType = 'sine',
    volume: number = 0.15,
    delay: number = 0,
  ) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  // ── Helper: play noise burst ──────────────
  private playNoise(duration: number, volume: number = 0.1, delay: number = 0) {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime + delay;

    const source = ctx.createBufferSource();
    source.buffer = this.createNoise(duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  // ── CRT Ambient Hum ──────────────
  private startHum() {
    if (!this.enabled || this.humOsc) return;
    try {
      const ctx = this.getCtx();
      this.humOsc = ctx.createOscillator();
      this.humGain = ctx.createGain();
      this.humOsc.type = 'sine';
      this.humOsc.frequency.setValueAtTime(60, ctx.currentTime);
      this.humGain.gain.setValueAtTime(0.025, ctx.currentTime);
      this.humOsc.connect(this.humGain);
      this.humGain.connect(ctx.destination);
      this.humOsc.start();
    } catch {
      // Ignore — AudioContext may not be ready
    }
  }

  private stopHum() {
    if (this.humOsc) {
      try { this.humOsc.stop(); } catch { /* already stopped */ }
      this.humOsc = null;
    }
    this.humGain = null;
  }

  // Briefly duck the hum for dramatic contrast
  private duckHum(durationMs: number = 500) {
    if (!this.humGain) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    this.humGain.gain.setValueAtTime(0, now);
    this.humGain.gain.linearRampToValueAtTime(0.025, now + durationMs / 1000);
  }

  // ── Sound methods ──────────────

  // Soft click — for text appearing, button taps
  keyClick() {
    if (!this.enabled) return;
    const freq = 780 + Math.random() * 40; // 780-820Hz
    this.playTone(freq, 0.03, 'square', 0.06);
  }

  // Dial-up/modem screech — ascending oscillator sweep
  gameStart() {
    if (!this.enabled) return;
    this.duckHum(2500);
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(2000, now + 2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 1);
    gain.gain.linearRampToValueAtTime(0, now + 2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 2.1);

    // White noise overlay
    this.playNoise(2, 0.06);
  }

  // Dramatic low drone then reveal sting
  roleReveal(isImpostor: boolean = false) {
    if (!this.enabled) return;
    this.duckHum(2000);
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    // Low drone
    const drone = ctx.createOscillator();
    const droneGain = ctx.createGain();
    drone.type = 'sine';
    drone.frequency.setValueAtTime(isImpostor ? 60 : 80, now);
    droneGain.gain.setValueAtTime(0, now);
    droneGain.gain.linearRampToValueAtTime(0.15, now + 1);
    droneGain.gain.linearRampToValueAtTime(0.15, now + 1.3);
    droneGain.gain.linearRampToValueAtTime(0, now + 1.5);
    drone.connect(droneGain);
    droneGain.connect(ctx.destination);
    drone.start(now);
    drone.stop(now + 1.6);

    // Reveal sting
    const sting = ctx.createOscillator();
    const stingGain = ctx.createGain();
    sting.type = 'square';
    sting.frequency.setValueAtTime(isImpostor ? 400 : 600, now + 1.3);
    stingGain.gain.setValueAtTime(0, now);
    stingGain.gain.setValueAtTime(0.12, now + 1.3);
    stingGain.gain.linearRampToValueAtTime(0, now + 1.5);
    sting.connect(stingGain);
    stingGain.connect(ctx.destination);
    sting.start(now + 1.3);
    sting.stop(now + 1.6);
  }

  // Bass thud + distortion burst — short, visceral
  kill() {
    if (!this.enabled) return;
    this.duckHum(400);
    this.playTone(60, 0.15, 'sine', 0.2);
    this.playNoise(0.1, 0.15);
  }

  // Descending tone + static fade — you just died
  killed() {
    if (!this.enabled) return;
    this.duckHum(1000);
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.8);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.9);

    this.playNoise(0.8, 0.12);
  }

  // Klaxon — two-tone alternating alarm
  meetingAlarm() {
    if (!this.enabled) return;
    this.duckHum(1200);
    // 3 beats: 440/520 alternating, 200ms each, 100ms gap
    this.playTone(440, 0.2, 'square', 0.12, 0);
    this.playTone(520, 0.2, 'square', 0.12, 0.3);
    this.playTone(440, 0.2, 'square', 0.12, 0.6);
  }

  // Tick sound — for each vote being revealed
  voteReveal() {
    if (!this.enabled) return;
    this.playTone(1000, 0.05, 'triangle', 0.1);
  }

  // Gavel-like sharp impact
  verdict() {
    if (!this.enabled) return;
    this.duckHum(300);
    this.playTone(200, 0.1, 'sine', 0.18);
    this.playNoise(0.08, 0.12);
  }

  // Warning siren — escalating beeps
  sabotageAlert() {
    if (!this.enabled) return;
    this.duckHum(800);
    this.playTone(400, 0.15, 'square', 0.1, 0);
    this.playTone(600, 0.15, 'square', 0.1, 0.2);
    this.playTone(800, 0.15, 'square', 0.1, 0.4);
  }

  // Satisfying ascending chime
  taskComplete() {
    if (!this.enabled) return;
    this.playTone(400, 0.1, 'sine', 0.12, 0);
    this.playTone(500, 0.1, 'sine', 0.12, 0.1);
    this.playTone(600, 0.1, 'sine', 0.12, 0.2);
  }

  // Quick positive arpeggio (C-E-G-C)
  miniGameSuccess() {
    if (!this.enabled) return;
    this.playTone(523, 0.08, 'triangle', 0.1, 0);    // C5
    this.playTone(659, 0.08, 'triangle', 0.1, 0.08);  // E5
    this.playTone(784, 0.08, 'triangle', 0.1, 0.16);  // G5
    this.playTone(1047, 0.12, 'triangle', 0.1, 0.24); // C6
  }

  // Buzzer — short low tone
  miniGameFail() {
    if (!this.enabled) return;
    this.playTone(150, 0.2, 'square', 0.1);
  }

  // Subtle tick — for last 10 seconds of timer
  timerTick() {
    if (!this.enabled) return;
    this.playTone(600, 0.03, 'sine', 0.08);
  }

  // Very faint eerie drone — for ghost state (one-shot, not looping)
  ghostAmbient() {
    if (!this.enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.linearRampToValueAtTime(95, now + 2);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.5);
    gain.gain.linearRampToValueAtTime(0.04, now + 1.5);
    gain.gain.linearRampToValueAtTime(0, now + 2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 2.1);
  }

  // Carnival/circus-like sting — playful but creepy
  jesterReveal() {
    if (!this.enabled) return;
    this.duckHum(1200);
    // Quick ascending then descending — circus vibe with square wave
    const notes = [440, 554, 659, 880, 659, 554, 440];
    notes.forEach((freq, i) => {
      this.playTone(freq, 0.12, 'square', 0.1, i * 0.12);
    });
  }

  // Beep — for restart countdown
  countdown() {
    if (!this.enabled) return;
    this.playTone(880, 0.1, 'sine', 0.1);
  }
}

export const audio = new TerminalAudio();

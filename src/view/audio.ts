/**
 * Procedural sound: every effect is synthesised with Web Audio, so there are
 * no audio files to ship. A little lute-ish music box plays underneath.
 *
 * The context starts suspended until the first user gesture, as browsers
 * require; every method is safe to call before that and simply does nothing.
 */

type Voice = { gain: GainNode; source: AudioScheduledSourceNode };

const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private breathVoice: (Voice & { filter: BiquadFilterNode }) | null = null;
  private crackle: (Voice & { filter: BiquadFilterNode }) | null = null;
  private nextNote = 0;
  private step = 0;
  private musicRoot = 50;
  muted = false;

  constructor() {
    const start = () => this.start();
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    // iOS Safari only unlocks audio inside touchend/click, not pointerdown.
    window.addEventListener('touchend', start);
    window.addEventListener('click', start);
  }

  private start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : .8;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;
      this.master.connect(compressor).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = .9;
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.music.gain.value = .16;
      this.music.connect(this.master);
      const length = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.nextNote = ctx.currentTime + .3;
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : .8, this.ctx.currentTime, .05);
    return this.muted;
  }

  private noiseSource() {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.loopStart = Math.random();
    return source;
  }

  private envelope(gain: GainNode, peak: number, attack: number, decay: number) {
    const t = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, t + attack + decay);
  }

  /** Hold the breath roar open while `active`; call every frame. */
  breath(active: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    if (active && !this.breathVoice) {
      const source = this.noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = .7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.sfx);
      source.start();
      gain.gain.setTargetAtTime(.55, ctx.currentTime, .04);
      filter.frequency.setTargetAtTime(1400, ctx.currentTime, .15);
      this.breathVoice = { source, gain, filter };
    } else if (!active && this.breathVoice) {
      const voice = this.breathVoice;
      voice.gain.gain.setTargetAtTime(0, ctx.currentTime, .08);
      voice.filter.frequency.setTargetAtTime(300, ctx.currentTime, .1);
      voice.source.stop(ctx.currentTime + .5);
      this.breathVoice = null;
    } else if (active && this.breathVoice) {
      this.breathVoice.filter.frequency.value = 1100 + Math.random() * 500;
    }
  }

  /** Background fire crackle scaled by how much is burning. */
  fires(amount: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    if (!this.crackle) {
      const source = this.noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.sfx);
      source.start();
      this.crackle = { source, gain, filter };
    }
    const level = Math.min(.12, amount * .025);
    // Crackle: random amplitude spikes on the hiss.
    const spike = Math.random() < .3 ? 2.5 : 1;
    this.crackle.gain.gain.setTargetAtTime(level * spike, ctx.currentTime, .02);
    if (amount > .5 && Math.random() < amount * .02) this.pop(1800 + Math.random() * 2000, .05, .04);
  }

  private pop(frequency: number, level: number, decay: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.sfx!);
    this.envelope(gain, level, .002, decay);
    osc.start();
    osc.stop(ctx.currentTime + decay + .05);
  }

  /** A dwarf's yelp: squeaky, pitch-bent, a little different every time. */
  yelp() {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 380 + Math.random() * 260;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.9, t + .08);
    osc.frequency.exponentialRampToValueAtTime(base * .7, t + .35);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 18;
    const depth = ctx.createGain();
    depth.gain.value = 30;
    vibrato.connect(depth).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    osc.connect(filter).connect(gain).connect(this.sfx);
    this.envelope(gain, .28, .01, .38);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + .45);
    vibrato.stop(t + .45);
  }

  /** Cartoon launch: a springy slide-whistle up. */
  boing() {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + .32);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 24;
    const depth = ctx.createGain();
    depth.gain.value = 40;
    wobble.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.sfx);
    this.envelope(gain, .3, .01, .4);
    osc.start(t);
    wobble.start(t);
    osc.stop(t + .5);
    wobble.stop(t + .5);
    this.thump(.5);
  }

  /** Heavy low thud: landings, bumps, footfalls. */
  thump(level = .6) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + .18);
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.sfx);
    this.envelope(gain, level, .005, .22);
    osc.start(t);
    osc.stop(t + .3);
  }

  /** Paper crumple: a cluster of short filtered noise grains. */
  crumple(size = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const grains = Math.round(8 * size + 4);
    for (let i = 0; i < grains; i++) {
      const t = ctx.currentTime + Math.random() * .25 * size;
      const source = this.noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1500 + Math.random() * 4000;
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(.25 * Math.random() + .1, t + .004);
      gain.gain.exponentialRampToValueAtTime(.0001, t + .04 + Math.random() * .05);
      source.connect(filter).connect(gain).connect(this.sfx);
      source.start(t);
      source.stop(t + .12);
    }
    this.thump(.35 * size);
  }

  /** Big ignition whoomp for cottages and the maypole. */
  whoomp() {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    const source = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.exponentialRampToValueAtTime(3000, t + .25);
    filter.frequency.exponentialRampToValueAtTime(300, t + 1.2);
    const gain = ctx.createGain();
    source.connect(filter).connect(gain).connect(this.sfx);
    this.envelope(gain, .6, .08, 1.2);
    source.start(t);
    source.stop(t + 1.5);
    this.thump(.7);
  }

  /** Page turn: an airy swish. */
  pageTurn() {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    const source = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = .8;
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(5000, t + .45);
    const gain = ctx.createGain();
    source.connect(filter).connect(gain).connect(this.sfx);
    this.envelope(gain, .35, .15, .5);
    source.start(t);
    source.stop(t + .8);
  }

  /** Chime for a mayhem promotion. */
  fanfare() {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    [0, 4, 7, 12].forEach((interval, i) => this.pluck(this.musicRoot + 12 + interval, ctx.currentTime + i * .09, .9, 2));
  }

  private pluck(midi: number, when: number, level: number, decay = 1.1) {
    const ctx = this.ctx!;
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const overtone = ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = frequency * 2.01;
    const og = ctx.createGain();
    og.gain.value = .3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, when + decay);
    osc.connect(gain);
    overtone.connect(og).connect(gain);
    gain.connect(this.music!);
    osc.start(when);
    overtone.start(when);
    osc.stop(when + decay + .1);
    overtone.stop(when + decay + .1);
  }

  /**
   * Music box in D Dorian: a wandering melody over a drone, getting busier as
   * the mayhem climbs. Scheduled a little ahead so it survives frame hitches.
   */
  update(intensity: number, cave: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.music || this.muted) return;
    const beat = cave ? .42 : .3 - Math.min(.1, intensity * .02);
    while (this.nextNote < ctx.currentTime + .25) {
      const bar = Math.floor(this.step / 8);
      const inBar = this.step % 8;
      const chord = [0, 3, 4, 0][bar % 4];
      if (inBar === 0) this.pluck(this.musicRoot - 12 + DORIAN[chord], this.nextNote, .6, 2.4);
      const busy = cave ? .45 : .7 + Math.min(.3, intensity * .05);
      if (Math.random() < busy) {
        const degree = chord + [0, 2, 4, 1, 3, 5, 2, 4][inBar] + (Math.random() < .2 ? 7 : 0);
        const octave = Math.floor(degree / 7);
        const midi = this.musicRoot + DORIAN[degree % 7] + octave * 12;
        this.pluck(midi, this.nextNote, cave ? .35 : .45, cave ? 1.6 : 1);
      }
      this.nextNote += beat;
      this.step++;
    }
  }
}

/**
 * Seeded random number generation. This module must never import `playcanvas`.
 *
 * The simulation must not call `Math.random()`. `docs/ARCHITECTURE.md` makes
 * bit-identical determinism load-bearing — it is what client prediction,
 * replays-as-input-logs and rollback all rest on — and an unseeded global
 * generator makes a tick unreproducible by construction.
 *
 * mulberry32: small, fast, and good enough for wander targets and scatter. It
 * is not cryptographic and does not need to be. forge will bring its own
 * generator; what matters here is that randomness enters the simulation
 * through one seeded, injectable place rather than being sprinkled around.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform in [-extent, +extent). */
  spread(extent: number): number {
    return this.range(-extent, extent);
  }
}

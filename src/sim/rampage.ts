/**
 * The rampage: every gameplay rule that involves more than one entity. This
 * module must never import `playcanvas`.
 *
 * Owns the drake, the dwarves, the props and the mayhem score for one level,
 * and runs one tick of all of them in a fixed order. Everything that happens
 * worth telling the player about is pushed to {@link Rampage.events}; the view
 * drains that queue for particles, sound, narration and score pops, and never
 * infers events by diffing state.
 */

import { DrakeSim } from './drake';
import { DwarfSim } from './dwarf';
import { PropKind, PropSim, PropState } from './props';
import type { Rng } from './random';
import { EntityFlags, type Input, type Transform } from './types';
import type { VillageLayout } from './village';
import type { World } from './world';
import { TUNING } from '../tuning';

/** Breath reach and half-angle cosine, matching the particle stream. */
export const BREATH_RANGE = 11;
const BREATH_CONE_DWARF = .78;
const BREATH_CONE_PROP = .7;

/** Drake body, approximated as one circle a little ahead of the model centre. */
const DRAKE_RADIUS = 1.25;
const DRAKE_BODY_AHEAD = .9;

/** Below this speed the drake nudges dwarves aside instead of launching them. */
const LAUNCH_MIN_SPEED = 4;
/** Above this speed, cottages and haystacks fold flat instead of stopping it. */
export const FLATTEN_SPEED = 12;

const MAX_DWARVES = 12;
const SPAWN_INTERVAL = 2.5;
const COMBO_WINDOW = 2.6;

export type RampageEvent =
  | { type: 'dwarfIgnited'; x: number; z: number; combo: number; points: number }
  | { type: 'dwarfLaunched'; x: number; z: number; combo: number; points: number; launches: number }
  | { type: 'dwarfLanded'; x: number; z: number }
  | { type: 'dwarfGone'; x: number; z: number }
  | { type: 'dwarfSpawned'; x: number; z: number }
  | { type: 'propIgnited'; x: number; z: number; kind: PropKind; combo: number; points: number }
  | { type: 'propCharred'; x: number; z: number; kind: PropKind }
  | { type: 'propFlattened'; x: number; z: number; kind: PropKind; combo: number; points: number }
  | { type: 'bump'; x: number; z: number };

const POINTS = {
  dwarfIgnited: 10,
  dwarfLaunched: 15,
  propIgnited: { [PropKind.Tree]: 4, [PropKind.Cottage]: 40, [PropKind.Haystack]: 8, [PropKind.Stall]: 20, [PropKind.Fence]: 3, [PropKind.Signpost]: 5, [PropKind.Maypole]: 60 },
  propFlattened: { [PropKind.Tree]: 0, [PropKind.Cottage]: 60, [PropKind.Haystack]: 10, [PropKind.Stall]: 25, [PropKind.Fence]: 4, [PropKind.Signpost]: 6, [PropKind.Maypole]: 0 }
} as const;

export class Rampage {
  readonly drake: DrakeSim;
  readonly dwarves: DwarfSim[] = [];
  readonly props: PropSim[] = [];
  readonly events: RampageEvent[] = [];

  score = 0;
  combo = 0;
  bestCombo = 0;
  private comboTimer = 0;
  private spawnTimer = 0;
  /** Only a level with a layout spawns dwarves. */
  private readonly village: boolean;

  private readonly at: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly drakeAt: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    drake: DrakeSim,
    layout?: VillageLayout,
    /** The cave is a prologue: nothing there counts towards mayhem. */
    private readonly scoring = true
  ) {
    this.drake = drake;
    this.village = layout !== undefined;
    if (layout) {
      for (const p of layout.props) this.props.push(new PropSim(world, p.kind, p.x, p.z, p.yaw, p.size));
      for (let i = 0; i < 6; i++) this.spawnDwarf();
      // A welcoming committee on the road in, so chapter two opens on faces.
      for (let i = 0; i < 3; i++) {
        const x = layout.drakeStart.x + this.rng.spread(6);
        const z = layout.drakeStart.z - 9 - this.rng.range(0, 6);
        this.dwarves.push(new DwarfSim(world, this.rng, x, z));
      }
    }
  }

  get livingDwarves() {
    let n = 0;
    for (const d of this.dwarves) if (!d.dead) n++;
    return n;
  }

  get burningDwarves() {
    let n = 0;
    for (const d of this.dwarves) if (!d.dead && d.burning) n++;
    return n;
  }

  tick(dt: number, input: Input): void {
    const world = this.world;
    this.drake.update(world, dt, input);
    world.state.transform(this.drake.id, this.drakeAt);
    const drake = this.drakeAt;

    this.collideDrake(drake);
    if (this.drake.breathed) this.breathe(drake);

    const threat = { x: drake.x, z: drake.z };
    for (const dwarf of this.dwarves) {
      if (dwarf.dead) continue;
      // Last known position, for the ghost when this tick burns it out.
      world.state.transform(dwarf.id, this.at);
      const lastX = this.at.x;
      const lastZ = this.at.z;
      dwarf.update(world, dt, threat);
      if (!world.state.transform(dwarf.id, this.at)) {
        if (dwarf.dead) this.events.push({ type: 'dwarfGone', x: lastX, z: lastZ });
        continue;
      }
      if (dwarf.landed) this.events.push({ type: 'dwarfLanded', x: this.at.x, z: this.at.z });
      this.ramDwarf(dwarf, drake);
    }
    this.spreadFromDwarves();
    this.spreadBetweenProps(dt);

    for (let i = this.dwarves.length - 1; i >= 0; i--) {
      if (this.dwarves[i].dead) this.dwarves.splice(i, 1);
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    if (this.village) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = SPAWN_INTERVAL;
        this.spawnDwarf();
      }
    }
  }

  drainEvents(out: RampageEvent[]): void {
    out.push(...this.events);
    this.events.length = 0;
  }

  /** Remove every entity this rampage owns except the drake. */
  destroy(): void {
    for (const dwarf of this.dwarves) if (!dwarf.dead) this.world.destroy(dwarf.id);
    for (const prop of this.props) this.world.destroy(prop.id);
    this.dwarves.length = 0;
    this.props.length = 0;
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  private score_(base: number): { combo: number; points: number } {
    if (!this.scoring || base <= 0) return { combo: this.combo, points: 0 };
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = COMBO_WINDOW;
    const points = Math.round(base * (1 + (this.combo - 1) * .25));
    this.score += points;
    return { combo: this.combo, points };
  }

  private breathe(drake: Transform): void {
    const fx = this.drake.forwardX;
    const fz = this.drake.forwardZ;
    const ox = drake.x + fx * 2.2;
    const oz = drake.z + fz * 2.2;
    for (const dwarf of this.dwarves) {
      if (dwarf.dead || dwarf.burning) continue;
      if (!this.world.state.transform(dwarf.id, this.at)) continue;
      const dx = this.at.x - ox;
      const dz = this.at.z - oz;
      const distance = Math.hypot(dx, dz);
      if (distance < BREATH_RANGE && (distance < .8 || (dx * fx + dz * fz) / distance > BREATH_CONE_DWARF)) {
        if (dwarf.ignite(this.world)) {
          this.events.push({ type: 'dwarfIgnited', x: this.at.x, z: this.at.z, ...this.score_(POINTS.dwarfIgnited) });
        }
      }
    }
    for (const prop of this.props) {
      if (!prop.flammable) continue;
      const dx = prop.x - ox;
      const dz = prop.z - oz;
      const centre = Math.hypot(dx, dz);
      const distance = centre - prop.radius;
      if (distance > BREATH_RANGE) continue;
      const cos = centre > .01 ? (dx * fx + dz * fz) / centre : 1;
      // Broad props catch at wider angles: widen the cone by their size.
      const cone = Math.min(BREATH_CONE_PROP, BREATH_CONE_PROP - prop.radius / Math.max(centre, 1) * .5);
      if (cos > cone) this.igniteProp(prop);
    }
  }

  private igniteProp(prop: PropSim): void {
    if (prop.ignite(this.world)) {
      this.events.push({ type: 'propIgnited', x: prop.x, z: prop.z, kind: prop.kind, ...this.score_(POINTS.propIgnited[prop.kind]) });
    }
  }

  private collideDrake(drake: Transform): void {
    const bodyX = drake.x + this.drake.forwardX * DRAKE_BODY_AHEAD;
    const bodyZ = drake.z + this.drake.forwardZ * DRAKE_BODY_AHEAD;
    let pushX = 0;
    let pushZ = 0;
    for (const prop of this.props) {
      if (prop.radius <= 0 || prop.state === PropState.Flattened || prop.state === PropState.Charred) {
        // Fences have no collider but still fold under a charge.
        if (prop.kind !== PropKind.Fence || prop.state !== PropState.Intact) continue;
      }
      const dx = bodyX - prop.x;
      const dz = bodyZ - prop.z;
      const distance = Math.hypot(dx, dz);
      const reach = DRAKE_RADIUS + Math.max(prop.radius, .6);
      if (distance >= reach) continue;

      if (prop.spec.flattenable && prop.state === PropState.Intact && this.drake.speed > (prop.kind === PropKind.Fence ? LAUNCH_MIN_SPEED : FLATTEN_SPEED)) {
        if (prop.flatten(this.world)) {
          this.events.push({ type: 'propFlattened', x: prop.x, z: prop.z, kind: prop.kind, ...this.score_(POINTS.propFlattened[prop.kind]) });
        }
        continue;
      }
      if (prop.radius <= 0) continue;
      const overlap = reach - distance;
      pushX += (distance > .001 ? dx / distance : 1) * overlap;
      pushZ += (distance > .001 ? dz / distance : 0) * overlap;
    }
    if (pushX !== 0 || pushZ !== 0) {
      this.drake.place(this.world, drake.x + pushX, drake.z + pushZ);
      // `place` zeroes speed; a wall should, but only the part driving into it.
      this.drake.speed *= .35;
      this.world.state.transform(this.drake.id, drake);
      this.events.push({ type: 'bump', x: drake.x, z: drake.z });
    }
  }

  private ramDwarf(dwarf: DwarfSim, drake: Transform): void {
    if (dwarf.airborne) return;
    const bodyX = drake.x + this.drake.forwardX * DRAKE_BODY_AHEAD;
    const bodyZ = drake.z + this.drake.forwardZ * DRAKE_BODY_AHEAD;
    const dx = this.at.x - bodyX;
    const dz = this.at.z - bodyZ;
    const distance = Math.hypot(dx, dz);
    const speed = this.drake.speed;
    // A charging drake sweeps a wider path: wings out, head low.
    const reach = DRAKE_RADIUS + (speed > TUNING.drake.walkSpeed + 1 ? 1.1 : .45);
    if (distance > reach) return;
    if (speed < LAUNCH_MIN_SPEED) {
      // Shoved aside, standing.
      const nx = distance > .001 ? dx / distance : 1;
      const nz = distance > .001 ? dz / distance : 0;
      const shove = DRAKE_RADIUS + .45 - distance;
      this.world.setPosition(dwarf.id, this.at.x + nx * shove, this.at.y, this.at.z + nz * shove);
      return;
    }
    // Mostly along the drake's heading, partly sideways off the snout.
    const dirX = this.drake.forwardX * .8 + (distance > .001 ? dx / distance : 0) * .5;
    const dirZ = this.drake.forwardZ * .8 + (distance > .001 ? dz / distance : 0) * .5;
    const power = 3 + speed * .72;
    if (dwarf.launch(this.world, dirX, dirZ, power)) {
      const bonus = speed > TUNING.drake.walkSpeed + 1 ? 1.5 : 1;
      this.events.push({
        type: 'dwarfLaunched', x: this.at.x, z: this.at.z, launches: dwarf.launches,
        ...this.score_(Math.round(POINTS.dwarfLaunched * bonus))
      });
    }
  }

  /** A burning dwarf is a torch with legs: it lights whatever it runs into. */
  private spreadFromDwarves(): void {
    for (const dwarf of this.dwarves) {
      if (dwarf.dead || !dwarf.burning) continue;
      if (!this.world.state.transform(dwarf.id, this.at)) continue;
      const x = this.at.x;
      const z = this.at.z;
      for (const prop of this.props) {
        if (!prop.flammable) continue;
        if (Math.hypot(prop.x - x, prop.z - z) < prop.radius + .7) this.igniteProp(prop);
      }
      for (const other of this.dwarves) {
        if (other === dwarf || other.dead || other.burning) continue;
        const flags = this.world.state.flags(other.id);
        if (flags & EntityFlags.Airborne) continue;
        const ox = this.at.x;
        const oz = this.at.z;
        if (!this.world.state.transform(other.id, this.at)) continue;
        if (Math.hypot(this.at.x - ox, this.at.z - oz) < .9 && other.ignite(this.world)) {
          this.events.push({ type: 'dwarfIgnited', x: this.at.x, z: this.at.z, ...this.score_(POINTS.dwarfIgnited) });
        }
        // Restore this dwarf's position for the next comparison.
        this.world.state.transform(dwarf.id, this.at);
      }
    }
  }

  private spreadBetweenProps(dt: number): void {
    for (const prop of this.props) {
      if (prop.update(this.world, dt)) {
        this.events.push({ type: 'propCharred', x: prop.x, z: prop.z, kind: prop.kind });
      }
    }
    for (const source of this.props) {
      if (source.state !== PropState.Burning) continue;
      for (const target of this.props) {
        if (target === source || !target.flammable) continue;
        if (source.spreadsTo(target, dt, this.rng)) this.igniteProp(target);
      }
    }
  }

  private spawnDwarf(): void {
    if (this.livingDwarves >= MAX_DWARVES) return;
    const cottages = this.props.filter(p => p.kind === PropKind.Cottage && p.state === PropState.Intact);
    let x: number;
    let z: number;
    if (cottages.length > 0) {
      // Out of a front door, blinking at the commotion.
      const home = cottages[Math.floor(this.rng.next() * cottages.length)];
      this.world.state.transform(home.id, this.at);
      const yaw = this.at.yaw * Math.PI / 180;
      const out = 2.2 * home.size + 1.2;
      x = home.x + Math.sin(yaw) * out;
      z = home.z + Math.cos(yaw) * out;
    } else {
      x = this.rng.spread(35);
      z = this.rng.spread(30);
    }
    this.dwarves.push(new DwarfSim(this.world, this.rng, x, z));
    this.events.push({ type: 'dwarfSpawned', x, z });
  }
}

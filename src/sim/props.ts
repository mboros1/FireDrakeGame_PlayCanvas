/**
 * Flammable, flattenable scenery. This module must never import `playcanvas`.
 *
 * A prop is a circle on the ground with a material story: it can catch, burn
 * for a while, spread fire to its neighbours, and end up charred. Cottages
 * can also be charged flat. Everything here is deterministic — spread rolls
 * come from the injected generator.
 */

import type { Rng } from './random';
import { EntityFlags, EntityKind, type EntityId } from './types';
import type { World } from './world';

export enum PropKind {
  Tree = 0,
  Cottage = 1,
  Haystack = 2,
  Stall = 3,
  Fence = 4,
  Signpost = 5,
  Maypole = 6
}

export enum PropState {
  Intact = 0,
  Burning = 1,
  Charred = 2,
  Flattened = 3
}

type PropSpec = {
  /** Collision radius against the drake, metres. 0 means walk-through. */
  radius: number;
  /** Seconds from catching to charred. */
  burnDuration: number;
  /** Chance per second to ignite each neighbour in range while burning. */
  spreadRate: number;
  /** How far this prop throws fire while burning, metres. */
  spreadRange: number;
  /** Charging into it at speed squashes it flat. */
  flattenable: boolean;
};

export const PROP_SPECS: Record<PropKind, PropSpec> = {
  [PropKind.Tree]: { radius: .6, burnDuration: 7, spreadRate: .45, spreadRange: 6, flattenable: false },
  [PropKind.Cottage]: { radius: 3.1, burnDuration: 11, spreadRate: .3, spreadRange: 8, flattenable: true },
  [PropKind.Haystack]: { radius: 1.2, burnDuration: 4, spreadRate: 1.4, spreadRange: 6.5, flattenable: true },
  [PropKind.Stall]: { radius: 1.6, burnDuration: 6, spreadRate: .6, spreadRange: 5.5, flattenable: true },
  [PropKind.Fence]: { radius: 0, burnDuration: 3.5, spreadRate: .9, spreadRange: 3.5, flattenable: true },
  [PropKind.Signpost]: { radius: .3, burnDuration: 3, spreadRate: .3, spreadRange: 3, flattenable: true },
  [PropKind.Maypole]: { radius: .45, burnDuration: 8, spreadRate: .2, spreadRange: 4, flattenable: false }
};

export class PropSim {
  readonly id: EntityId;
  readonly spec: PropSpec;
  state = PropState.Intact;
  burnElapsed = 0;
  /** Player whose fire this is, for credit when it spreads. -1 for nobody. */
  igniter = -1;

  constructor(
    world: World,
    readonly kind: PropKind,
    readonly x: number,
    readonly z: number,
    yaw = 0,
    /** Uniform size multiplier; scales collision and spread with the art. */
    readonly size = 1
  ) {
    this.spec = PROP_SPECS[kind];
    this.id = world.spawn(EntityKind.Prop, x, 0, z, yaw);
  }

  get radius() {
    return this.spec.radius * this.size;
  }

  /** 0 when fresh, 1 when the fire has finished with it. */
  get burnProgress() {
    return this.state === PropState.Burning
      ? Math.min(1, this.burnElapsed / this.spec.burnDuration)
      : this.state === PropState.Charred ? 1 : 0;
  }

  get flammable() {
    return this.state === PropState.Intact || this.state === PropState.Flattened;
  }

  ignite(world: World): boolean {
    if (!this.flammable) return false;
    this.state = PropState.Burning;
    this.burnElapsed = 0;
    world.addFlag(this.id, EntityFlags.Burning);
    return true;
  }

  flatten(world: World): boolean {
    if (!this.spec.flattenable || this.state !== PropState.Intact) return false;
    this.state = PropState.Flattened;
    world.addFlag(this.id, EntityFlags.Flattened);
    return true;
  }

  /** Advance the burn. Returns true on the tick it becomes charred. */
  update(world: World, dt: number): boolean {
    if (this.state !== PropState.Burning) return false;
    this.burnElapsed += dt;
    if (this.burnElapsed >= this.spec.burnDuration) {
      this.state = PropState.Charred;
      world.clearFlag(this.id, EntityFlags.Burning);
      world.addFlag(this.id, EntityFlags.Charred);
      return true;
    }
    return false;
  }

  /** Overwrite with server state. Replica props are drawn, never simulated. */
  applyReplica(world: World, state: PropState, burnElapsed: number): void {
    if (state === this.state && Math.abs(burnElapsed - this.burnElapsed) < .05) return;
    this.state = state;
    this.burnElapsed = burnElapsed;
    let flags = 0;
    if (state === PropState.Burning) flags |= EntityFlags.Burning;
    if (state === PropState.Charred) flags |= EntityFlags.Charred;
    if (state === PropState.Flattened) flags |= EntityFlags.Flattened;
    world.setFlags(this.id, flags);
  }

  /** Roll whether this burning prop sets `other` alight this tick. */
  spreadsTo(other: PropSim, dt: number, rng: Rng): boolean {
    if (this.state !== PropState.Burning || !other.flammable) return false;
    // Fire is at its hungriest in the middle of a burn.
    const intensity = Math.sin(Math.min(1, this.burnProgress * 1.3) * Math.PI) * .8 + .2;
    const range = this.spec.spreadRange * this.size;
    const distance = Math.hypot(other.x - this.x, other.z - this.z) - other.radius;
    if (distance > range) return false;
    const falloff = 1 - Math.max(0, distance) / range;
    return rng.next() < this.spec.spreadRate * intensity * falloff * dt;
  }
}

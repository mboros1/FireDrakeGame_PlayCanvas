/**
 * Dwarf wandering and burning. This module must never import `playcanvas`.
 *
 * Owns where a dwarf goes and whether it is on fire. Presentation — the run
 * bob, the arm flail, the attached flames — derives from this state on the view
 * side and is not simulated.
 */

import { RAD_TO_DEG } from './math';
import type { Rng } from './random';
import { EntityFlags, EntityKind, type EntityId, type Transform } from './types';
import type { World } from './world';

const WANDER_EXTENT = 38;
const ARRIVE_DISTANCE = 1.2;
const RETARGET_MIN = 2;
const RETARGET_MAX = 6;
const WALK_SPEED = 2.4;
const PANIC_SPEED = 4.3;

/** Seconds a dwarf burns before it is destroyed. Matches the Unreal build. */
export const BURN_DURATION = 5;

export class DwarfSim {
  readonly id: EntityId;
  dead = false;

  private targetX = 0;
  private targetZ = 0;
  private retargetIn = 0;
  private burnRemaining = 0;

  private readonly scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(world: World, private readonly rng: Rng, x: number, z: number) {
    this.id = world.spawn(EntityKind.Dwarf, x, 0, z);
    world.addFlag(this.id, EntityFlags.Grounded);
    this.chooseTarget();
  }

  get burning(): boolean {
    return this.burnRemaining > 0;
  }

  /** Seconds of burn left, for presentation that scales with it. */
  get burnRemainingSeconds(): number {
    return this.burnRemaining;
  }

  ignite(world: World): void {
    if (this.burning || this.dead) return;
    this.burnRemaining = BURN_DURATION;
    world.addFlag(this.id, EntityFlags.Burning);
  }

  update(world: World, dt: number): void {
    if (this.dead) return;
    const at = this.scratch;
    if (!world.state.transform(this.id, at)) return;

    this.retargetIn -= dt;
    const toTargetX = this.targetX - at.x;
    const toTargetZ = this.targetZ - at.z;
    const distance = Math.hypot(toTargetX, toTargetZ);
    if (this.retargetIn <= 0 || distance < ARRIVE_DISTANCE) this.chooseTarget();

    if (distance > 0.1) {
      const speed = this.burning ? PANIC_SPEED : WALK_SPEED;
      const step = (speed * dt) / distance;
      // Forward is -Z, so face the target the same way the drake does.
      const yaw = Math.atan2(-toTargetX, -toTargetZ) * RAD_TO_DEG;
      world.setPosition(this.id, at.x + toTargetX * step, at.y, at.z + toTargetZ * step);
      world.setYaw(this.id, yaw);
    }

    if (this.burning) {
      this.burnRemaining -= dt;
      if (this.burnRemaining <= 0) {
        this.burnRemaining = 0;
        this.dead = true;
        world.destroy(this.id);
      }
    }
  }

  private chooseTarget(): void {
    this.targetX = this.rng.spread(WANDER_EXTENT);
    this.targetZ = this.rng.spread(WANDER_EXTENT);
    this.retargetIn = this.rng.range(RETARGET_MIN, RETARGET_MAX);
  }
}

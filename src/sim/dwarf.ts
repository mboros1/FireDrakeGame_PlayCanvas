/**
 * Dwarf wandering, fleeing, tumbling and burning. This module must never
 * import `playcanvas`.
 *
 * Owns where a dwarf goes, whether it is on fire, and whether it is currently
 * airborne because a drake ran into it. Presentation — the puppet flip, the
 * arm flail, the attached flames, the dizzy stars — derives from this state on
 * the view side and is not simulated.
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
const FLEE_SPEED = 3.6;

/** Within this range of the drake, an unburnt dwarf stops strolling and runs. */
export const FLEE_RADIUS = 9;

const GRAVITY = 24;
/** A landing faster than this bounces once; slower lands and sees stars. */
const BOUNCE_SPEED = 6;
const BOUNCE_RESTITUTION = .38;
const STUN_DURATION = 1.4;

/** Seconds a dwarf burns before it is destroyed. Matches the Unreal build. */
export const BURN_DURATION = 5;

/** What a dwarf is running from this tick, if anything. */
export type Threat = { x: number; z: number };

export class DwarfSim {
  readonly id: EntityId;
  dead = false;

  private targetX = 0;
  private targetZ = 0;
  private retargetIn = 0;
  private burnRemaining = 0;

  /** Airborne velocity, m/s. Zero while grounded. */
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private stunRemaining = 0;

  /** Accumulated tumble in degrees, for the view's cartwheel. */
  spin = 0;
  private spinRate = 0;

  /** Number of times this dwarf has been launched. Mayhem likes repeat business. */
  launches = 0;

  /** True on the tick this dwarf touched down. Presentation reads it for the puff. */
  landed = false;

  private readonly scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(world: World, private readonly rng: Rng, x: number, z: number) {
    this.id = world.spawn(EntityKind.Dwarf, x, 0, z);
    world.addFlag(this.id, EntityFlags.Grounded);
    this.chooseTarget();
  }

  get burning(): boolean {
    return this.burnRemaining > 0;
  }

  get airborne(): boolean {
    return this.vy !== 0 || this.vx !== 0 || this.vz !== 0;
  }

  get stunned(): boolean {
    return this.stunRemaining > 0;
  }

  /** Seconds of burn left, for presentation that scales with it. */
  get burnRemainingSeconds(): number {
    return this.burnRemaining;
  }

  ignite(world: World): boolean {
    if (this.burning || this.dead) return false;
    this.burnRemaining = BURN_DURATION;
    world.addFlag(this.id, EntityFlags.Burning);
    return true;
  }

  /**
   * Send the dwarf flying along (dirX, dirZ) — the slapstick half of the game.
   * Returns false if it is already in the air, so a charge scores once.
   */
  launch(world: World, dirX: number, dirZ: number, power: number): boolean {
    if (this.dead || this.airborne) return false;
    const length = Math.hypot(dirX, dirZ) || 1;
    this.vx = (dirX / length) * power;
    this.vz = (dirZ / length) * power;
    this.vy = 5 + power * .55;
    this.spinRate = (this.rng.next() < .5 ? -1 : 1) * (540 + power * 40);
    this.launches++;
    world.clearFlag(this.id, EntityFlags.Grounded);
    world.addFlag(this.id, EntityFlags.Airborne);
    world.clearFlag(this.id, EntityFlags.Stunned);
    this.stunRemaining = 0;
    return true;
  }

  update(world: World, dt: number, threat?: Threat): void {
    if (this.dead) return;
    const at = this.scratch;
    if (!world.state.transform(this.id, at)) return;
    this.landed = false;

    if (this.airborne) {
      this.fly(world, at, dt);
    } else if (this.stunRemaining > 0) {
      this.stunRemaining -= dt;
      if (this.stunRemaining <= 0) {
        this.stunRemaining = 0;
        world.clearFlag(this.id, EntityFlags.Stunned);
      }
    } else {
      this.walk(world, at, dt, threat);
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

  private walk(world: World, at: Transform, dt: number, threat?: Threat): void {
    const fleeing = !this.burning && threat !== undefined &&
      Math.hypot(at.x - threat.x, at.z - threat.z) < FLEE_RADIUS;

    if (fleeing) {
      // Run directly away, with the target far enough out that it does not
      // arrive and dither.
      const awayX = at.x - threat.x;
      const awayZ = at.z - threat.z;
      const length = Math.hypot(awayX, awayZ) || 1;
      this.targetX = at.x + (awayX / length) * 12;
      this.targetZ = at.z + (awayZ / length) * 12;
      this.retargetIn = Math.max(this.retargetIn, .5);
    }

    this.retargetIn -= dt;
    const toTargetX = this.targetX - at.x;
    const toTargetZ = this.targetZ - at.z;
    const distance = Math.hypot(toTargetX, toTargetZ);
    if (this.retargetIn <= 0 || distance < ARRIVE_DISTANCE) this.chooseTarget();

    if (distance > 0.1) {
      const speed = this.burning ? PANIC_SPEED : fleeing ? FLEE_SPEED : WALK_SPEED;
      const step = (speed * dt) / distance;
      // Forward is -Z, so face the target the same way the drake does.
      const yaw = Math.atan2(-toTargetX, -toTargetZ) * RAD_TO_DEG;
      const x = clampExtent(at.x + toTargetX * step);
      const z = clampExtent(at.z + toTargetZ * step);
      world.setPosition(this.id, x, at.y, z);
      world.setYaw(this.id, yaw);
    }
  }

  private fly(world: World, at: Transform, dt: number): void {
    this.vy -= GRAVITY * dt;
    let x = at.x + this.vx * dt;
    let y = at.y + this.vy * dt;
    let z = at.z + this.vz * dt;
    // The paper stage has walls; bounce off them rather than leaving the book.
    if (Math.abs(x) > WANDER_EXTENT + 12) { this.vx = -this.vx * .5; x = at.x; }
    if (Math.abs(z) > WANDER_EXTENT + 12) { this.vz = -this.vz * .5; z = at.z; }
    this.spin += this.spinRate * dt;

    if (y <= 0) {
      y = 0;
      if (-this.vy > BOUNCE_SPEED) {
        this.vy = -this.vy * BOUNCE_RESTITUTION;
        this.vx *= .55;
        this.vz *= .55;
        this.spinRate *= .6;
      } else {
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.spin = 0;
        this.spinRate = 0;
        this.stunRemaining = STUN_DURATION;
        world.clearFlag(this.id, EntityFlags.Airborne);
        world.addFlag(this.id, EntityFlags.Grounded);
        world.addFlag(this.id, EntityFlags.Stunned);
      }
      this.landed = true;
    }
    world.setPosition(this.id, x, y, z);
  }

  private chooseTarget(): void {
    this.targetX = this.rng.spread(WANDER_EXTENT);
    this.targetZ = this.rng.spread(WANDER_EXTENT);
    this.retargetIn = this.rng.range(RETARGET_MIN, RETARGET_MAX);
  }
}

const clampExtent = (value: number) =>
  value < -(WANDER_EXTENT + 10) ? -(WANDER_EXTENT + 10) : value > WANDER_EXTENT + 10 ? WANDER_EXTENT + 10 : value;

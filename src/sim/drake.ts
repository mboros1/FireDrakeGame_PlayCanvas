/**
 * Drake locomotion. This module must never import `playcanvas`.
 *
 * A kinematic character controller per `docs/ARCHITECTURE.md`: scripted
 * movement on an axis-locked body that never tips, rather than a dynamic rigid
 * body driven by forces. Phase 2 replaces the flat ground assumption here with
 * forge's capsule-versus-terrain collision.
 */

import { TUNING } from '../tuning';
import { clamp, DEG_TO_RAD, lerp, RAD_TO_DEG, shortestAngleDelta } from './math';
import { EntityFlags, EntityKind, type EntityId, type Input, type Transform } from './types';
import type { World } from './world';

/** Seconds between breath particles while the fire key is held. */
const FIRE_INTERVAL = 0.055;

/** Below this the stick is considered centred and the drake keeps its facing. */
const INPUT_DEADZONE = 0.01;

export class DrakeSim {
  readonly id: EntityId;

  /** Current forward speed in m/s. Presentation reads this for the run bob. */
  speed = 0;

  private fireCooldown = 0;

  /** True only on the tick breath was emitted. Fire presentation reads it. */
  breathed = false;

  /** Unit forward vector, kept for the tick's breath origin and cone test. */
  forwardX = 0;
  forwardZ = -1;

  /**
   * Flat-ground height and square level bounds. Provisional: both become level
   * data in step 5 and terrain collision in phase 2.
   */
  groundY = 0.1;
  boundsXZ = 54;

  private readonly scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(world: World, x: number, z: number, yaw = 0) {
    this.id = world.spawn(EntityKind.Drake, x, this.groundY, z, yaw);
    world.addFlag(this.id, EntityFlags.Grounded);
    this.setForwardFromYaw(yaw);
  }

  update(world: World, dt: number, input: Input): void {
    const t = this.scratch;
    if (!world.state.transform(this.id, t)) return;

    // Movement is camera-relative, which is why the look angle arrives as an
    // input rather than being read from the camera here.
    const cameraRadians = input.cameraYaw * DEG_TO_RAD;
    const cameraForwardX = -Math.sin(cameraRadians);
    const cameraForwardZ = -Math.cos(cameraRadians);
    const cameraRightX = Math.cos(cameraRadians);
    const cameraRightZ = -Math.sin(cameraRadians);

    let desiredX = cameraForwardX * input.forward + cameraRightX * input.right;
    let desiredZ = cameraForwardZ * input.forward + cameraRightZ * input.right;
    const magnitude = Math.hypot(desiredX, desiredZ);
    const inputAmount = Math.min(1, magnitude);

    let yaw = t.yaw;
    if (inputAmount > INPUT_DEADZONE) {
      desiredX /= magnitude;
      desiredZ /= magnitude;
      const desiredYaw = Math.atan2(-desiredX, -desiredZ) * RAD_TO_DEG;
      yaw += shortestAngleDelta(yaw, desiredYaw) *
        Math.min(1, dt * TUNING.drake.turnResponsiveness);
    }

    const targetSpeed =
      (input.charging ? TUNING.drake.chargeSpeed : TUNING.drake.walkSpeed) * inputAmount;
    this.speed = lerp(this.speed, targetSpeed, Math.min(1, dt * TUNING.drake.acceleration));

    this.setForwardFromYaw(yaw);
    const x = clamp(t.x + this.forwardX * this.speed * dt, -this.boundsXZ, this.boundsXZ);
    const z = clamp(t.z + this.forwardZ * this.speed * dt, -this.boundsXZ, this.boundsXZ);

    world.setPosition(this.id, x, this.groundY, z);
    world.setYaw(this.id, yaw);

    this.fireCooldown -= dt;
    this.breathed = input.breathing && this.fireCooldown <= 0;
    if (this.breathed) {
      this.fireCooldown = FIRE_INTERVAL;
      world.addFlag(this.id, EntityFlags.Breathing);
    } else {
      world.clearFlag(this.id, EntityFlags.Breathing);
    }
  }

  /** Move the drake outright — scene loads and the debug teleport. */
  place(world: World, x: number, z: number, yaw?: number): void {
    world.setPosition(this.id, x, this.groundY, z);
    if (yaw !== undefined) {
      world.setYaw(this.id, yaw);
      this.setForwardFromYaw(yaw);
    }
    this.speed = 0;
  }

  private setForwardFromYaw(yaw: number): void {
    const radians = yaw * DEG_TO_RAD;
    this.forwardX = -Math.sin(radians);
    this.forwardZ = -Math.cos(radians);
  }
}

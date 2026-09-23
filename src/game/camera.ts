/**
 * The follow camera: orbit angle, zoom, charge FOV kick, trauma shake, and an
 * automation hook that eases the yaw toward a target.
 *
 * Owns camera *state*; input devices call {@link look} and {@link zoom}, and
 * gameplay calls {@link shake}. Movement is camera-relative, so {@link yaw}
 * is also a simulation input.
 */

import * as pc from 'playcanvas';
import { TUNING } from '../tuning';

export class CameraRig {
  yaw: number;
  pitch: number = TUNING.camera.pitchDegrees;
  distance: number = TUNING.camera.distance;
  targetDistance: number = TUNING.camera.distance;
  /** Automation: when set, the yaw eases toward it. Any real look cancels it. */
  yawTarget: number | null = null;

  /**
   * Orbit limits. Play uses the tuning values; the desk pulls further back
   * and looks further down on the page.
   */
  limits = {
    minDistance: TUNING.camera.minDistance as number,
    maxDistance: TUNING.camera.maxDistance as number,
    minPitch: TUNING.camera.minPitch as number,
    maxPitch: TUNING.camera.maxPitch as number
  };

  private trauma = 0;
  private fovKick = 0;
  private readonly position = new pc.Vec3();
  private readonly desired = new pc.Vec3();
  private readonly target = new pc.Vec3();

  constructor(readonly entity: pc.Entity, yaw = 0) {
    this.yaw = yaw;
  }

  /** Turn by a look input in degrees: mouse, right-drag or right thumb. */
  look(dyaw: number, dpitch: number) {
    if (dyaw === 0 && dpitch === 0) return;
    this.yawTarget = null;
    this.yaw += dyaw;
    this.pitch = pc.math.clamp(this.pitch + dpitch, this.limits.minPitch, this.limits.maxPitch);
  }

  zoom(delta: number) {
    this.targetDistance = pc.math.clamp(this.targetDistance + delta, this.limits.minDistance, this.limits.maxDistance);
  }

  /** Add screen shake, 0..1. It decays on its own. */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Keep at least this much shake (breathing fire rumbles). */
  rumble(amount: number) {
    this.trauma = Math.max(this.trauma, amount);
  }

  /** Behind the drake at the default framing. */
  reset(yaw: number) {
    this.yawTarget = null;
    this.yaw = yaw;
    this.pitch = TUNING.camera.pitchDegrees;
    this.distance = this.targetDistance = TUNING.camera.distance;
  }

  set(yaw: number, pitch: number, distance: number) {
    this.yawTarget = null;
    this.yaw = yaw;
    this.pitch = pitch;
    this.distance = this.targetDistance = distance;
  }

  update(frameDt: number, elapsed: number, drakePosition: pc.Vec3, drakeYaw: number, charging: boolean) {
    if (this.yawTarget !== null) {
      const delta = ((this.yawTarget - this.yaw + 540) % 360) - 180;
      this.yaw += Math.sign(delta) * Math.min(Math.abs(delta), frameDt * 160);
    }
    this.distance = pc.math.lerp(this.distance, this.targetDistance, Math.min(1, frameDt * 12));
    this.fovKick = pc.math.lerp(this.fovKick, charging ? 9 : 0, Math.min(1, frameDt * 4));
    this.entity.camera!.fov = TUNING.camera.fov + this.fovKick;

    const yaw = this.yaw * pc.math.DEG_TO_RAD;
    const pitch = this.pitch * pc.math.DEG_TO_RAD;
    const distance = this.distance + this.fovKick * .12;
    const horizontal = Math.cos(pitch) * distance;
    this.desired.set(
      drakePosition.x + Math.sin(yaw) * horizontal,
      drakePosition.y + TUNING.camera.targetHeight + Math.sin(pitch) * distance,
      drakePosition.z + Math.cos(yaw) * horizontal
    );
    if (this.position.lengthSq() === 0) this.position.copy(this.desired);
    this.position.lerp(this.position, this.desired, Math.min(1, frameDt * TUNING.camera.followResponsiveness));

    this.trauma = Math.max(0, this.trauma - frameDt * 1.6);
    const shake = this.trauma * this.trauma;
    this.entity.setPosition(
      this.position.x + (Math.sin(elapsed * 47) + Math.sin(elapsed * 31)) * shake * .18,
      this.position.y + (Math.sin(elapsed * 53) + Math.sin(elapsed * 23)) * shake * .14,
      this.position.z + (Math.sin(elapsed * 41) + Math.sin(elapsed * 37)) * shake * .18
    );
    const facing = drakeYaw * pc.math.DEG_TO_RAD;
    this.target.set(
      drakePosition.x - Math.sin(facing) * TUNING.camera.lookAhead,
      drakePosition.y + TUNING.camera.targetHeight,
      drakePosition.z - Math.cos(facing) * TUNING.camera.lookAhead
    );
    this.entity.lookAt(this.target);
  }
}

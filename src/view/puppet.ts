/**
 * Dwarf presentation: a split-pin paper puppet.
 *
 * Body, hat and two arms are separate cutouts pinned together. The puppet
 * always turns its face to the camera and flips edge-on to change direction,
 * the way storybook cutouts (and one well-known plumber) do. Everything here
 * derives from `DwarfSim` state — the tumble angle, the stun, the burn — and
 * nothing is fed back.
 */

import * as pc from 'playcanvas';
import { drawDwarfArm, drawDwarfBody, drawDwarfHat, drawStar, DWARF_LOOKS } from './art';
import type { Fx } from './fx';
import { canvasTexture, cutoutMaterial, meshEntity, quadMesh } from './paper';
import type { DwarfSim } from '../sim/dwarf';
import type { WorldState, Transform } from '../sim/types';

type LookMaterials = { body: pc.StandardMaterial; hat: pc.StandardMaterial; arm: pc.StandardMaterial };

const lookCache: LookMaterials[] = [];
let starMaterial: pc.Material | null = null;

const lookMaterials = (index: number): LookMaterials => {
  if (!lookCache[index]) {
    const look = DWARF_LOOKS[index];
    lookCache[index] = {
      body: cutoutMaterial(canvasTexture(drawDwarfBody(look), { burnable: true, seed: look.seed }), .34),
      hat: cutoutMaterial(canvasTexture(drawDwarfHat(look), { burnable: true, seed: look.seed + 3 }), .34),
      arm: cutoutMaterial(canvasTexture(drawDwarfArm(look), { burnable: true, seed: look.seed + 5 }), .34)
    };
  }
  return lookCache[index];
};

/** Puppet dimensions in metres; the whole dwarf stands 1.3 m. */
const BODY_W = .8;
const BODY_H = 1.0;
const HAT_W = .62;
const HAT_H = .6;
const HAT_Y = .74;
const ARM_W = .26;
const ARM_H = .52;
const SHOULDER_Y = .5;
const SHOULDER_X = .3;

let lookCounter = 0;

export class Puppet {
  readonly root = new pc.Entity('Dwarf');
  private readonly facing = new pc.Entity('Facing');
  private readonly flip = new pc.Entity('Flip');
  private readonly body: pc.Entity;
  private readonly hat: pc.Entity;
  private readonly leftArm = new pc.Entity('Left shoulder');
  private readonly rightArm = new pc.Entity('Right shoulder');
  private readonly stars: pc.Entity[] = [];
  private materials: pc.StandardMaterial[] | null = null;
  private readonly look: LookMaterials;

  private side = 1;
  private flipScale = 1;
  private lastX = 0;
  private lastZ = 0;
  private hatLift = 0;
  private hatVelocity = 0;
  private hatSpin = 0;
  private wasAirborne = false;
  private readonly scratch: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly phase = Math.random() * 10;

  constructor(readonly sim: DwarfSim, parent: pc.Entity) {
    this.look = lookMaterials(lookCounter++ % DWARF_LOOKS.length);
    parent.addChild(this.root);
    this.root.addChild(this.facing);
    this.facing.addChild(this.flip);

    this.body = meshEntity('Body', quadMesh(), this.look.body, this.flip);
    this.body.setLocalScale(BODY_W, BODY_H, 1);

    this.hat = meshEntity('Hat', quadMesh(), this.look.hat, this.flip);
    this.hat.setLocalScale(HAT_W, HAT_H, 1);
    this.hat.setLocalPosition(0, HAT_Y, .01);

    for (const [shoulder, side] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      shoulder.setLocalPosition(SHOULDER_X * side, SHOULDER_Y, .02);
      this.flip.addChild(shoulder);
      const arm = meshEntity('Arm', quadMesh(), this.look.arm, shoulder);
      arm.setLocalScale(ARM_W * side, -ARM_H, 1);
      arm.setLocalPosition(0, .04, 0);
    }

    starMaterial ??= cutoutMaterial(canvasTexture(drawStar()), 1.2);
    for (let i = 0; i < 3; i++) {
      const star = meshEntity('Dizzy star', quadMesh(), starMaterial, this.facing, { castShadows: false });
      star.setLocalScale(.2, .2, 1);
      star.enabled = false;
      this.stars.push(star);
    }
  }

  get dead() {
    return this.sim.dead;
  }

  /** World position of the head, for speech bubbles. */
  headPosition(out: pc.Vec3) {
    return out.copy(this.root.getPosition()).add(new pc.Vec3(0, 1.45, 0));
  }

  private ensureMaterials() {
    if (this.materials) return this.materials;
    const clones = new Map<pc.Material, pc.StandardMaterial>();
    for (const render of this.root.findComponents('render') as pc.RenderComponent[]) {
      for (const mi of render.meshInstances) {
        if (mi.material === starMaterial) continue;
        let clone = clones.get(mi.material);
        if (!clone) {
          clone = (mi.material as pc.StandardMaterial).clone();
          clone.update();
          clones.set(mi.material, clone);
        }
        mi.material = clone;
      }
    }
    this.materials = [...clones.values()];
    return this.materials;
  }

  update(state: WorldState, dt: number, elapsed: number, camera: pc.Entity, fx: Fx) {
    if (!state.transform(this.sim.id, this.scratch)) return;
    const at = this.scratch;
    const sim = this.sim;
    this.root.setPosition(at.x, at.y, at.z);

    // Face the camera; flip edge-on to change which way we walk.
    const cameraPosition = camera.getPosition();
    const toCameraYaw = Math.atan2(cameraPosition.x - at.x, cameraPosition.z - at.z) * pc.math.RAD_TO_DEG;
    this.facing.setEulerAngles(0, toCameraYaw, 0);
    const moveX = at.x - this.lastX;
    const moveZ = at.z - this.lastZ;
    this.lastX = at.x;
    this.lastZ = at.z;
    const cameraRight = this.facing.right;
    const lateral = moveX * cameraRight.x + moveZ * cameraRight.z;
    if (Math.abs(lateral) > .004) this.side = lateral > 0 ? 1 : -1;
    this.flipScale = pc.math.lerp(this.flipScale, this.side, Math.min(1, dt * 14));

    const burning = sim.burning;
    const airborne = sim.airborne;
    const stunned = sim.stunned;
    const speed = Math.hypot(moveX, moveZ) / Math.max(dt, 1e-4);

    // Walk: bob and waddle. Air: cartwheel. Stunned: wobble.
    const stride = elapsed * (burning ? 17 : 11) + this.phase;
    const walking = !airborne && !stunned && speed > .3;
    const bob = walking ? Math.abs(Math.sin(stride)) * .07 : 0;
    const waddle = walking ? Math.sin(stride) * 7 : stunned ? Math.sin(elapsed * 9) * 10 : 0;
    this.flip.setLocalPosition(0, bob, 0);
    this.flip.setLocalScale(Math.abs(this.flipScale) < .08 ? .08 * Math.sign(this.flipScale || 1) : this.flipScale, 1, 1);
    if (airborne) {
      this.flip.setLocalPosition(0, .6, 0);
      this.flip.setLocalEulerAngles(0, 0, sim.spin);
      this.flip.translateLocal(0, -.6, 0);
    } else {
      this.flip.setLocalEulerAngles(0, 0, waddle);
    }

    // Arms: swing when walking, windmill when burning or flying, droop when dazed.
    const swing = walking ? Math.sin(stride) * 30 : 0;
    let left = -8 + swing;
    let right = 8 - swing;
    if (burning || airborne) {
      left = -150 + Math.sin(elapsed * 24 + this.phase) * 60;
      right = 150 + Math.sin(elapsed * 21 + this.phase) * 60;
    } else if (stunned) {
      left = -4;
      right = 4;
    } else if (speed > 3) {
      // Fleeing: arms up in the universal gesture of "not the face".
      left = -165 + Math.sin(elapsed * 16) * 20;
      right = 165 + Math.sin(elapsed * 16 + 1) * 20;
    }
    this.leftArm.setLocalEulerAngles(0, 0, left);
    this.rightArm.setLocalEulerAngles(0, 0, right);

    // Hat on a spring: pops off at launch, lands back on the head eventually.
    if (airborne && !this.wasAirborne) {
      this.hatVelocity = 5.5;
      this.hatSpin = (Math.random() - .5) * 900;
    }
    this.wasAirborne = airborne;
    this.hatVelocity += (-this.hatLift * 60 - this.hatVelocity * 6) * dt;
    this.hatLift = Math.max(0, this.hatLift + this.hatVelocity * dt);
    this.hat.setLocalPosition(0, HAT_Y + this.hatLift + (burning ? Math.abs(Math.sin(elapsed * 30)) * .05 : 0), .01);
    this.hat.setLocalEulerAngles(0, 0, this.hatLift * this.hatSpin * .1);

    // Dizzy stars orbit the head while stunned.
    this.stars.forEach((star, i) => {
      star.enabled = stunned;
      if (!stunned) return;
      const a = elapsed * 5 + (i / 3) * Math.PI * 2;
      star.setLocalPosition(Math.cos(a) * .42, 1.32 + Math.sin(a * 2) * .04, Math.sin(a) * .2 + .1);
      star.setLocalEulerAngles(0, 0, elapsed * 200);
    });

    if (burning) {
      const materials = this.ensureMaterials();
      const progress = 1 - sim.burnRemainingSeconds / 5;
      const char = Math.min(1, progress * 1.1);
      const pulse = .6 + Math.sin(elapsed * 19 + this.phase) * .4;
      for (const m of materials) {
        const shade = 1 - char * .75;
        m.diffuse.set(shade, shade * .92, shade * .85);
        m.emissive.set(.34 + pulse * .6, .2 + pulse * .18, .1);
        m.alphaTest = .5 + Math.max(0, progress - .45) * .75;
        m.update();
      }
      const p = this.root.getPosition();
      fx.burn(new pc.Vec3(p.x, p.y + .15, p.z), .35, 1.2, .8, dt);
    }
  }
}

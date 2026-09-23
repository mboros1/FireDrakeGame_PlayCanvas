/**
 * Procedural animation layered over the drake's clips.
 *
 * The wyvern ships with rudimentary idle/walk clips and nothing for the things
 * this game is about: breathing fire, charging, crashing into cottages. This
 * layer adds those as pose adjustments applied after the anim system runs
 * each frame, so they compose with whatever clip is playing.
 *
 * Bone-local axes in this rig are inconsistent from bone to bone, and the idle
 * clip has the head turned back over the shoulder, so nothing here uses local
 * axes. Two geometric operations do all the work:
 *
 * - `bend(bone, child, degrees)` swings the child up (+) or down (−) about
 *   the horizontal axis perpendicular to the bone.
 * - `turn(bone, degrees)` rotates about world up.
 *
 * Both are pose-independent, which is what makes them safe to layer.
 */

import * as pc from 'playcanvas';

const UP = new pc.Vec3(0, 1, 0);

type Weights = { breath: number; charge: number };

export class DrakeRig {
  private readonly neck: pc.GraphNode[];
  private readonly head: pc.GraphNode;
  private readonly snout: pc.GraphNode;
  private readonly jaw: pc.GraphNode;
  private readonly jawTip: pc.GraphNode;
  private readonly tail: pc.GraphNode[];
  private readonly wings: { arm: pc.GraphNode; hand: pc.GraphNode }[];
  private readonly spine: pc.GraphNode;

  private readonly weights: Weights = { breath: 0, charge: 0 };
  private tailLag = 0;
  private lastYaw: number | null = null;
  private recoil = 0;
  private chomp = 0;
  private gait = 0;
  private curiosity = 0;
  private readonly a = new pc.Vec3();
  private readonly b = new pc.Vec3();
  private readonly axis = new pc.Vec3();
  private readonly q = new pc.Quat();

  static from(model: pc.Entity): DrakeRig | null {
    const find = (name: string) => model.findByName(name);
    const names = {
      neck: ['spine_019_016', 'spine_009_017', 'spine_018_018', 'spine_010_019', 'spine_017_020'],
      tail: ['tail_05', 'tail_1_06', 'tail_2_07', 'tail_3_08', 'tail_4_09', 'tail_5_010', 'tail_6_011', 'tail_7_012']
    };
    const neck = names.neck.map(find);
    const tail = names.tail.map(find);
    const head = find('head_021');
    const snout = find('mouth7_L_001_047');
    const jaw = find('jaw_022');
    const jawTip = find('mouth7_L_029');
    const spine = find('spine_005_014');
    const armL = find('upper-arm_L_084');
    const handL = find('hand_L_086');
    const armR = find('upper-arm_R_0114');
    const handR = find('hand_R_0116');
    if ([...neck, ...tail, head, snout, jaw, jawTip, spine, armL, handL, armR, handR].some(n => !n)) return null;
    return new DrakeRig(neck as pc.GraphNode[], head!, snout!, jaw!, jawTip!, tail as pc.GraphNode[], spine!,
      [{ arm: armL!, hand: handL! }, { arm: armR!, hand: handR! }]);
  }

  private constructor(
    neck: pc.GraphNode[], head: pc.GraphNode, snout: pc.GraphNode, jaw: pc.GraphNode, jawTip: pc.GraphNode,
    tail: pc.GraphNode[], spine: pc.GraphNode, wings: { arm: pc.GraphNode; hand: pc.GraphNode }[]
  ) {
    this.neck = neck;
    this.head = head;
    this.snout = snout;
    this.jaw = jaw;
    this.jawTip = jawTip;
    this.tail = tail;
    this.spine = spine;
    this.wings = wings;
  }

  /** Something big was hit: the head snaps back and the body shudders. */
  impact(strength: number) {
    this.recoil = Math.min(1, this.recoil + strength);
  }

  /**
   * @param forward the drake's gameplay forward, world space, unit, horizontal
   * @param yaw     the drake's yaw in degrees, for turn rate
   */
  update(dt: number, elapsed: number, forward: pc.Vec3, yaw: number, breathing: boolean, charging: boolean, speed: number, look: pc.Vec3 | null = null) {
    const w = this.weights;
    w.breath = pc.math.lerp(w.breath, breathing ? 1 : 0, Math.min(1, dt * (breathing ? 14 : 5)));
    w.charge = pc.math.lerp(w.charge, charging ? 1 : 0, Math.min(1, dt * (charging ? 6 : 3)));
    this.recoil = Math.max(0, this.recoil - dt * 3);
    if (breathing) this.chomp += dt * 22;

    // Tail: lag behind turns on a spring, sway with the stride.
    let yawRate = 0;
    if (this.lastYaw !== null && dt > 0) yawRate = (((yaw - this.lastYaw + 540) % 360) - 180) / dt;
    this.lastYaw = yaw;
    this.tailLag = pc.math.lerp(this.tailLag, pc.math.clamp(-yawRate * .1, -28, 28), Math.min(1, dt * 5));
    const sway = Math.sin(elapsed * (2.2 + speed * .35)) * (3 + Math.min(6, speed * .5));
    this.tail.forEach((bone, i) => {
      const t = (i + 1) / this.tail.length;
      this.turn(bone, (this.tailLag * .35 + sway * .5) * t);
      // Charging lifts the tail out straight like a rudder.
      if (i < 3) this.bend(bone, this.tail[i + 1], w.charge * 6);
    });

    // Gallop: a charging drake bounds, spine pitching with each stride.
    // Idle: a slow rise and fall of the chest.
    this.gait += dt * (2.2 + speed * .55);
    const bound = Math.sin(this.gait * 2) * w.charge;
    this.bend(this.spine, this.neck[0], bound * 7 + Math.sin(elapsed * 1.6) * 1.5 * (1 - w.charge));

    // Curiosity: when nothing else is going on, the head tracks the nearest
    // dwarf. Predators watch their lunch.
    const curious = look !== null && w.breath < .2 && w.charge < .3;
    this.curiosity = pc.math.lerp(this.curiosity, curious ? 1 : 0, Math.min(1, dt * 2.5));
    if (this.curiosity > .01 && look) {
      this.b.sub2(look, this.head.getPosition());
      this.b.y = 0;
      this.a.sub2(this.snout.getPosition(), this.head.getPosition());
      this.a.y = 0;
      if (this.a.lengthSq() > 1e-6 && this.b.lengthSq() > 1e-6) {
        this.a.normalize();
        this.b.normalize();
        const angle = -Math.atan2(this.a.x * this.b.z - this.a.z * this.b.x, this.a.x * this.b.x + this.a.z * this.b.z) * pc.math.RAD_TO_DEG;
        // Only glance within a comfortable arc of the body's heading.
        const bodyAngle = -Math.atan2(forward.x * this.b.z - forward.z * this.b.x, forward.x * this.b.x + forward.z * this.b.z) * pc.math.RAD_TO_DEG;
        if (Math.abs(bodyAngle) < 110) {
          const share = pc.math.clamp(angle, -80, 80) * this.curiosity * .7 / 3;
          this.turn(this.neck[3], share);
          this.turn(this.neck[4], share);
          this.turn(this.head, share);
        }
      }
    }

    // Aim: swing the neck round so the head faces the direction of travel.
    // The idle clip looks back over the shoulder; fire must not.
    const aim = Math.max(w.breath, w.charge * .7);
    if (aim > .01) {
      this.a.sub2(this.snout.getPosition(), this.head.getPosition());
      this.a.y = 0;
      if (this.a.lengthSq() > 1e-6) {
        this.a.normalize();
        const cross = this.a.x * forward.z - this.a.z * forward.x;
        const dot = this.a.x * forward.x + this.a.z * forward.z;
        // Signed angle from head direction to forward, about world up.
        const angle = -Math.atan2(cross, dot) * pc.math.RAD_TO_DEG;
        const share = pc.math.clamp(angle, -150, 150) * aim / (this.neck.length + 1);
        for (const bone of this.neck) this.turn(bone, share);
        this.turn(this.head, share);
      }
      // Level the head, then dip it towards the ground ahead while breathing.
      this.bend(this.neck[2], this.head, -w.breath * 10 - w.charge * 6);
      this.bend(this.head, this.snout, -w.breath * 8);
    }

    // Jaw: gape while breathing, with a hungry chomp.
    const gape = w.breath * (26 + Math.sin(this.chomp) * 6);
    if (gape > .1) this.bend(this.jaw, this.jawTip, -gape);

    // Wings: flare on a charge, lift a little while breathing.
    const flare = w.charge * 28 + w.breath * 10;
    if (flare > .1) for (const { arm, hand } of this.wings) this.bend(arm, hand, flare);

    // Recoil: head snaps back and up, spine arches.
    if (this.recoil > .01) {
      const r = this.recoil * this.recoil;
      this.bend(this.neck[1], this.head, r * 22);
      this.bend(this.spine, this.neck[0], r * 10);
    }
  }

  /** Swing `child` up (+) or down (−) about the horizontal axis across `bone`. */
  private bend(bone: pc.GraphNode, child: pc.GraphNode, degrees: number) {
    this.a.sub2(child.getPosition(), bone.getPosition());
    this.axis.cross(this.a, UP);
    if (this.axis.lengthSq() < 1e-8) return;
    this.axis.normalize();
    this.q.setFromAxisAngle(this.axis, degrees);
    bone.setRotation(this.q.mul(bone.getRotation()));
  }

  /** Rotate `bone` about world up by `degrees`. */
  private turn(bone: pc.GraphNode, degrees: number) {
    if (Math.abs(degrees) < .01) return;
    this.q.setFromAxisAngle(UP, degrees);
    bone.setRotation(this.q.mul(bone.getRotation()));
  }
}

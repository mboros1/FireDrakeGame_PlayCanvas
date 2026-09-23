/**
 * Turns simulation events into what the player feels: sound, particles,
 * camera shake, hit-stop, drake recoil, and the HUD's pops and narration.
 * The simulation reports; this decides how loud.
 */

import * as pc from 'playcanvas';
import { PropKind } from '../sim/props';
import type { RampageEvent } from '../sim/rampage';
import type { Sound } from '../view/audio';
import type { DrakeView } from '../view/drake';
import type { Fx } from '../view/fx';
import type { Hud } from '../view/hud';
import type { CameraRig } from './camera';

export class EventPresenter {
  /** Seconds of near-freeze still owed after a big impact. */
  hitStop = 0;
  private readonly at = new pc.Vec3();

  constructor(
    private readonly hud: Hud,
    private readonly sound: Sound,
    private readonly fx: Fx,
    private readonly drake: DrakeView,
    private readonly rig: CameraRig,
    private readonly drakeSpeed: () => number
  ) {}

  present(event: RampageEvent) {
    const at = this.at.set(event.x, 0, event.z);
    const near = Math.max(0, 1 - at.distance(this.drake.root.getPosition()) / 30);
    this.hud.handle(event, at);
    switch (event.type) {
      case 'dwarfIgnited':
        this.sound.yelp();
        this.rig.shake(.08 * near);
        break;
      case 'dwarfLaunched':
        this.drake.impact(.25);
        this.sound.boing();
        this.fx.burst(at.clone().add(new pc.Vec3(0, .6, 0)), 14);
        this.rig.shake(.35);
        this.hitStop = .06;
        if (Math.random() < .6) setTimeout(() => this.sound.yelp(), 120);
        break;
      case 'dwarfLanded':
        this.sound.thump(.25 * near + .05);
        this.fx.burst(at, 4, false);
        break;
      case 'dwarfGone':
        this.fx.ghost(at);
        break;
      case 'propIgnited':
        if (event.kind === PropKind.Cottage || event.kind === PropKind.Maypole) {
          this.sound.whoomp();
          this.rig.shake(.3 * near);
        }
        break;
      case 'propFlattened': {
        const cottage = event.kind === PropKind.Cottage;
        this.drake.impact(cottage ? .9 : .35);
        this.sound.crumple(cottage ? 1.6 : .7);
        this.fx.burst(at.clone().add(new pc.Vec3(0, .5, 0)), cottage ? 30 : 10);
        this.rig.shake(cottage ? .6 : .2);
        this.hitStop = cottage ? .1 : .04;
        break;
      }
      case 'bump':
        if (this.drakeSpeed() > 4) {
          this.rig.shake(.1);
          this.drake.impact(.5);
        }
        break;
      default:
        break;
    }
    if ('combo' in event && event.combo > 0 && event.combo % 8 === 0) this.sound.fanfare();
  }

  /** The frame's simulation dt, slowed while a hit-stop is owed. */
  timeScale(frameDt: number) {
    const dt = this.hitStop > 0 ? frameDt * .12 : frameDt;
    this.hitStop = Math.max(0, this.hitStop - frameDt);
    return dt;
  }
}

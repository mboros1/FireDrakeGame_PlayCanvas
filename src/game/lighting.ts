/**
 * The sun, the sky fill, and each chapter's mood: clear colour, ambient,
 * fog, light direction and grade.
 */

import * as pc from 'playcanvas';
import { GRADES, type PostStack } from '../view/post';

export class Lighting {
  readonly sun = new pc.Entity('Sun');
  readonly fill = new pc.Entity('Sky fill');

  constructor(private readonly app: pc.AppBase, private readonly camera: pc.Entity, private readonly post: PostStack, quality: 'high' | 'low') {
    this.sun.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, .86, .66),
      intensity: 2.1,
      castShadows: true,
      shadowDistance: 70,
      shadowResolution: quality === 'high' ? 4096 : 2048,
      numCascades: quality === 'high' ? 2 : 1,
      shadowType: pc.SHADOW_PCF3_32F,
      shadowBias: .25,
      normalOffsetBias: .06
    });
    app.root.addChild(this.sun);
    this.fill.addComponent('light', { type: 'directional', color: new pc.Color(.55, .7, .95), intensity: .45, castShadows: false });
    this.fill.setEulerAngles(-60, 200, 0);
    app.root.addChild(this.fill);
  }

  /** Golden-hour festival light. */
  village() {
    const scene = this.app.scene;
    this.camera.camera!.clearColor = new pc.Color(.96, .78, .6);
    scene.ambientLight = new pc.Color(.42, .4, .44);
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = new pc.Color(.93, .8, .68);
    scene.fog.start = 60;
    scene.fog.end = 230;
    this.sun.light!.color = new pc.Color(1, .84, .62);
    this.sun.light!.intensity = 2.3;
    this.sun.setEulerAngles(40, 30, 0);
    this.fill.light!.intensity = .5;
    this.post.apply(GRADES.village);
  }

  /** Lava-lit gloom. */
  cave() {
    const scene = this.app.scene;
    this.camera.camera!.clearColor = new pc.Color(.07, .03, .05);
    scene.ambientLight = new pc.Color(.34, .2, .26);
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = new pc.Color(.13, .05, .08);
    scene.fog.start = 30;
    scene.fog.end = 130;
    this.sun.light!.color = new pc.Color(.9, .6, .8);
    this.sun.light!.intensity = .8;
    this.sun.setEulerAngles(62, 30, 0);
    this.fill.light!.intensity = .12;
    this.post.apply(GRADES.cave);
  }
}

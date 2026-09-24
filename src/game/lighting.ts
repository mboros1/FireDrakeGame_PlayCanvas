/**
 * The sun, the sky fill, and each chapter's mood: clear colour, ambient,
 * fog, light direction and grade.
 */

import * as pc from 'playcanvas';
import { GRADES, type PostStack } from '../view/post';
import { MOOD_PALETTES, type MoodPalette } from '../view/moods';

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

  /** A chapter's light, from its mood: golden afternoon by default. */
  village(mood: MoodPalette = MOOD_PALETTES.afternoon) {
    const scene = this.app.scene;
    this.camera.camera!.clearColor = mood.clear;
    scene.ambientLight = mood.ambient;
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = mood.fog.colour;
    scene.fog.start = mood.fog.start;
    scene.fog.end = mood.fog.end;
    this.sun.light!.color = mood.sun.colour;
    this.sun.light!.intensity = mood.sun.intensity;
    this.sun.setEulerAngles(mood.sun.pitch, mood.sun.yaw, 0);
    this.fill.light!.intensity = mood.fill;
    this.post.apply(mood.grade);
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

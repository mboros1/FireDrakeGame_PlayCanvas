/**
 * Post-processing: the "photographed diorama" look.
 *
 * Tilt-shift depth of field sells the miniature; bloom makes fire and lit
 * windows glow; grading and vignette warm everything towards an old book.
 */

import * as pc from 'playcanvas';

export type Grade = {
  bloom: number;
  saturation: number;
  contrast: number;
  brightness: number;
  tint: pc.Color;
  vignette: number;
  vignetteColour: pc.Color;
  focusRange: number;
  blur: number;
};

export const GRADES: Record<'village' | 'cave', Grade> = {
  village: {
    bloom: .018,
    saturation: 1.12,
    contrast: 1.06,
    brightness: 1.02,
    tint: new pc.Color(1, .97, .9),
    vignette: .42,
    vignetteColour: new pc.Color(.22, .12, .1),
    focusRange: 22,
    blur: 1.6
  },
  cave: {
    bloom: .03,
    saturation: 1.16,
    contrast: 1.12,
    brightness: 1.05,
    tint: new pc.Color(1, .92, .88),
    vignette: .58,
    vignetteColour: new pc.Color(.05, .01, .03),
    focusRange: 20,
    blur: 1.8
  }
};

export class PostStack {
  readonly frame: pc.CameraFrame;

  constructor(app: pc.AppBase, camera: pc.CameraComponent, quality: 'high' | 'low') {
    const frame = new pc.CameraFrame(app, camera);
    frame.rendering.toneMapping = pc.TONEMAP_NEUTRAL;
    frame.rendering.samples = quality === 'high' ? 4 : 1;
    frame.rendering.sharpness = .25;
    frame.bloom.intensity = .02;
    frame.bloom.blurLevel = 14;
    frame.grading.enabled = true;
    frame.vignette.inner = .45;
    frame.vignette.outer = 1.25;
    frame.vignette.curvature = .6;
    frame.colorEnhance.enabled = true;
    frame.colorEnhance.vibrance = .18;
    frame.colorEnhance.shadows = .05;
    frame.colorEnhance.highlights = -.04;
    if (quality === 'high') {
      frame.ssao.type = 'combine';
      frame.ssao.intensity = .55;
      frame.ssao.radius = 1.2;
      frame.ssao.samples = 12;
      frame.ssao.blurEnabled = true;
      frame.dof.enabled = true;
      frame.dof.nearBlur = false;
      frame.dof.highQuality = true;
    }
    this.frame = frame;
    this.apply(GRADES.village);
  }

  apply(grade: Grade) {
    const f = this.frame;
    f.bloom.intensity = grade.bloom;
    f.grading.saturation = grade.saturation;
    f.grading.contrast = grade.contrast;
    f.grading.brightness = grade.brightness;
    f.grading.tint = grade.tint;
    f.vignette.intensity = grade.vignette;
    f.vignette.color = grade.vignetteColour;
    f.dof.focusRange = grade.focusRange;
    f.dof.blurRadius = grade.blur;
    f.update();
  }

  /** Keep the drake in the sharp band as the camera zooms. */
  focusAt(distance: number) {
    if (!this.frame.dof.enabled || Math.abs(this.frame.dof.focusDistance - distance) < .25) return;
    this.frame.dof.focusDistance = distance;
    this.frame.update();
  }
}

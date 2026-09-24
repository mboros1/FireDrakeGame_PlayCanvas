/**
 * A chapter's mood: how the paper theatre is lit and coloured. One palette
 * feeds the sky, the hills, the ground sheet, the lights, the grade and the
 * weather, so a chapter changes all of them with one word.
 */

import * as pc from 'playcanvas';
import type { Mood } from '../sim/level';
import type { Grade } from './post';

export type GroundPalette = {
  base: string;
  fields: string[];
  tufts: string;
  flowers: string[];
  pathEdge: string;
  path: string;
  water: [string, string];
};

export type MoodPalette = {
  sky: [number, string][];
  /** Nearest first: fill, rim. */
  hills: [string, string][];
  ground: GroundPalette;
  /** What hangs in the sky on its string. */
  celestial: 'sun' | 'moon' | 'none';
  /** Paper stars on strings, for night. */
  stars: boolean;
  clouds: number;
  /** Paper flakes drifting down around the camera. */
  snow: boolean;
  clear: pc.Color;
  ambient: pc.Color;
  fog: { colour: pc.Color; start: number; end: number };
  sun: { colour: pc.Color; intensity: number; pitch: number; yaw: number };
  fill: number;
  grade: Grade;
  /** Multiplier on props' self-illumination: lit windows read at night. */
  glow: number;
};

export const MOOD_PALETTES: Record<Mood, MoodPalette> = {
  afternoon: {
    sky: [[0, '#f6b489'], [.18, '#f7cfa4'], [.45, '#b9d3d0'], [1, '#6f9fbf']],
    hills: [['#5f8a5a', '#86ad76'], ['#7ea283', '#a4c3a0'], ['#a3bfae', '#c6d9cb'], ['#c7d6cc', '#e1e7de']],
    ground: {
      base: '#7fa06a',
      fields: ['#8aad72', '#739660', '#94b27a', '#6d8f5b', '#a0b97f', '#86a46b'],
      tufts: 'rgba(60,95,50,.32)',
      flowers: ['#fbf4e4', '#f4c542', '#e7a1b0', '#fbf4e4'],
      pathEdge: '#c9a878',
      path: '#e2c99a',
      water: ['#4f8a9a', '#6fb0bd']
    },
    celestial: 'sun',
    stars: false,
    clouds: 11,
    snow: false,
    clear: new pc.Color(.96, .78, .6),
    ambient: new pc.Color(.42, .4, .44),
    fog: { colour: new pc.Color(.93, .8, .68), start: 60, end: 230 },
    sun: { colour: new pc.Color(1, .84, .62), intensity: 2.3, pitch: 40, yaw: 30 },
    fill: .5,
    grade: {
      bloom: .018, saturation: 1.12, contrast: 1.06, brightness: 1.02, tint: new pc.Color(1, .97, .9),
      vignette: .42, vignetteColour: new pc.Color(.22, .12, .1), focusRange: 22, blur: 1.6
    },
    glow: 1
  },
  moonlit: {
    sky: [[0, '#2a2d58'], [.2, '#232650'], [.55, '#161a3d'], [1, '#0b0d24']],
    hills: [['#1f3346', '#3a5470'], ['#1a2a40', '#2f4462'], ['#17233a', '#283a58'], ['#141d33', '#22314c']],
    ground: {
      base: '#46706a',
      fields: ['#4f7a73', '#406862', '#578279', '#436c66', '#5c877e', '#4a746d'],
      tufts: 'rgba(20,40,45,.35)',
      flowers: ['#7d8fae', '#b7a86a', '#6f82a3', '#7d8fae'],
      pathEdge: '#8a8496',
      path: '#aaa4b8',
      water: ['#23446a', '#34669a']
    },
    celestial: 'moon',
    stars: true,
    clouds: 5,
    snow: false,
    clear: new pc.Color(.06, .07, .16),
    ambient: new pc.Color(.3, .34, .52),
    fog: { colour: new pc.Color(.09, .1, .22), start: 55, end: 210 },
    sun: { colour: new pc.Color(.68, .77, 1), intensity: 1.35, pitch: 50, yaw: 210 },
    fill: .35,
    grade: {
      bloom: .04, saturation: 1.05, contrast: 1.06, brightness: 1.08, tint: new pc.Color(.92, .95, 1.06),
      vignette: .62, vignetteColour: new pc.Color(.02, .02, .08), focusRange: 22, blur: 1.6
    },
    glow: 2.4
  },
  snow: {
    sky: [[0, '#e9ecef'], [.25, '#dfe5ea'], [.6, '#c9d4de'], [1, '#aebdca']],
    hills: [['#e6edf1', '#ffffff'], ['#d5dfe6', '#eef3f6'], ['#c5d1da', '#dfe7ec'], ['#b8c6d1', '#d2dce3']],
    ground: {
      base: '#eef2f4',
      fields: ['#e3e9ed', '#f5f7f8', '#dbe3e8', '#e9eef1', '#d3dce2', '#f0f3f5'],
      tufts: 'rgba(120,140,155,.28)',
      flowers: ['#b9c7d3', '#c75b39', '#b9c7d3', '#e2e8ec'],
      pathEdge: '#b8a88f',
      path: '#d6cbb8',
      water: ['#9fb8c9', '#c3d5e0']
    },
    celestial: 'none',
    stars: false,
    clouds: 16,
    snow: true,
    clear: new pc.Color(.86, .89, .92),
    ambient: new pc.Color(.62, .66, .72),
    fog: { colour: new pc.Color(.88, .9, .93), start: 40, end: 170 },
    sun: { colour: new pc.Color(.96, .97, 1), intensity: 1.35, pitch: 58, yaw: 40 },
    fill: .55,
    grade: {
      bloom: .014, saturation: .92, contrast: 1.02, brightness: 1.02, tint: new pc.Color(.97, .99, 1.03),
      vignette: .34, vignetteColour: new pc.Color(.18, .2, .26), focusRange: 22, blur: 1.6
    },
    glow: 1.1
  }
};

export const moodOf = (mood: Mood | undefined): MoodPalette => MOOD_PALETTES[mood ?? 'afternoon'];

/**
 * Fast iteration surface for the game feel.
 *
 * Change these values while `npm run dev` is running. Vite hot reload preserves
 * the current level and player position, so tuning does not require a restart.
 *
 * World convention (see `docs/ARCHITECTURE.md`): Y-up, right-handed,
 * 1 unit = 1 metre. Reference scale is a 1.3 m dwarf.
 */

import { WYVERN_MODEL } from './generated/wyvern-model';

/** Target standing height in metres — the drake's collision capsule height. */
export const DRAKE_HEIGHT_M = 2.2;

/**
 * The scale anchor. Everything else in the world is judged against a dwarf,
 * because it is the human-scale referent — see the scale bible in
 * `docs/ARCHITECTURE.md`.
 */
export const DWARF_HEIGHT_M = 1.3;

/**
 * Height the dwarf's placeholder primitives are authored at: the head sphere
 * sits at y=2.05 with a 0.35 radius, so the silhouette tops out at 2.4. The
 * primitives keep their authored proportions and the root is scaled by
 * {@link DWARF_SCALE}, so retargeting the height is one number rather than
 * twenty.
 */
const DWARF_PRIMITIVE_HEIGHT = 2.4;

export const DWARF_SCALE = DWARF_HEIGHT_M / DWARF_PRIMITIVE_HEIGHT;

/**
 * Derived from the measured model, never hand-entered. ~0.00219, giving a
 * 2.2 m tall drake at 6.0 m nose-to-tail and 9.5 m wingspan.
 */
const MODEL_SCALE = DRAKE_HEIGHT_M / WYVERN_MODEL.height;

export const TUNING = {
  drake: {
    // The drake stands at ~1.7x the height of a 1.3 m dwarf: large enough to
    // knock them around, small enough that individuals still read as
    // individuals.
    modelScale: MODEL_SCALE,
    // The source wyvern faces +Z. Gameplay forward is -Z.
    modelRotation: { x: 0, y: 180, z: 0 },
    // Put the feet on the ground and recentre the bounds after the facing
    // flip. Both follow from the extracted measurements, so changing the
    // target height cannot leave the drake floating or sunk.
    modelOffset: {
      x: 0,
      y: WYVERN_MODEL.footDrop * MODEL_SCALE,
      z: WYVERN_MODEL.zCentre * MODEL_SCALE
    },
    // Unchanged across the scale change. At 6 m nose-to-tail these read as a
    // brisk run and a committed charge; they were a slow amble against the old
    // 27 m body. Retune by feel, not by proportion.
    walkSpeed: 9,
    chargeSpeed: 17,
    acceleration: 5,
    turnResponsiveness: 10
  },
  camera: {
    fov: 62,
    // Framed for a 2.2 m creature. These are the most feel-sensitive numbers
    // here and should be adjusted live rather than computed.
    distance: 8,
    minDistance: 4,
    maxDistance: 16,
    pitchDegrees: 16,
    minPitch: -8,
    maxPitch: 52,
    targetHeight: 1.4,
    lookAhead: 1,
    mouseSensitivity: 0.15,
    zoomStep: 0.5,
    followResponsiveness: 7
  }
} as const;

/**
 * Convert a model-space socket position into drake-local space, applying the
 * same scale/rotation/offset the rendered model gets.
 *
 * Only the 180-degree yaw in `modelRotation` is handled — the model needs no
 * pitch or roll, and pretending to support them would be untested code.
 *
 * This is how gameplay gets an attachment point without depending on a
 * skeleton: the simulation uses the rest-pose offset this returns, while the
 * view reads the live bone. They agree by construction in the rest pose and
 * diverge only while animating, by centimetres.
 */
export const socketToLocal = (socket: readonly [number, number, number]) => {
  const s = MODEL_SCALE;
  return {
    x: -socket[0] * s,
    y: (socket[1] + WYVERN_MODEL.footDrop) * s,
    z: (-socket[2] + WYVERN_MODEL.zCentre) * s
  };
};

/** Rest-pose breath origin, in drake-local space. Unreal's `MouthSocket`. */
export const MOUTH_LOCAL = socketToLocal(WYVERN_MODEL.sockets.mouth);

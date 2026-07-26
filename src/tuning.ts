/**
 * Fast iteration surface for the game feel.
 *
 * Change these values while `npm run dev` is running. Vite hot reload preserves
 * the current level and player position, so tuning does not require a restart.
 *
 * World convention (see `docs/ARCHITECTURE.md`): Y-up, right-handed,
 * 1 unit = 1 metre. Reference scale is a 1.3 m dwarf.
 */

/**
 * Measured bounds of `public/assets/wyvern/wyvern.glb` in raw GLB units, wings
 * extended in the bind pose. Recorded so the offsets below are derived rather
 * than guessed — change `modelScale` and both offsets follow from these.
 *
 *   size   X 4329.53   Y 1005.49   Z 2732.68
 *   feet at Y -964.31, Z centre -707.60
 */
const MODEL = {
  /** Distance from the model origin down to the feet, in raw GLB units. */
  footDrop: 964.31,
  /** Z centre of the bounds, in raw GLB units. */
  zCentre: 707.6,
  /** Standing height in raw GLB units. */
  height: 1005.49
} as const;

/** Target standing height in metres — the drake's collision capsule height. */
const DRAKE_HEIGHT_M = 2.2;

/** ~0.0022. Yields 2.2 m tall, 6.0 m nose-to-tail, 9.5 m wingspan. */
const MODEL_SCALE = DRAKE_HEIGHT_M / MODEL.height;

export const TUNING = {
  drake: {
    // Derived from the measured bounds above, not hand-tuned. The drake stands
    // 2.2 m at ~1.7x the height of a 1.3 m dwarf: large enough to knock them
    // around, small enough that individuals still read as individuals.
    modelScale: MODEL_SCALE,
    // The source wyvern faces +Z. Gameplay forward is -Z.
    modelRotation: { x: 0, y: 180, z: 0 },
    // Recentre the exported bounds after the 180-degree turn and put the feet
    // on the ground instead of leaving most of the mesh below y=0.
    modelOffset: {
      x: 0,
      y: MODEL.footDrop * MODEL_SCALE,
      z: -MODEL.zCentre * MODEL_SCALE
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
    // Framed for a 2.2 m creature. Scaled from the previous values and then
    // rounded; these are the most feel-sensitive numbers here and should be
    // adjusted live rather than computed.
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

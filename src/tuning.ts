/**
 * Fast iteration surface for the game feel.
 *
 * Change these values while `npm run dev` is running. Vite hot reload preserves
 * the current level and player position, so tuning does not require a restart.
 */
export const TUNING = {
  drake: {
    // Unreal FBX export is centimeters; PlayCanvas world units are meters.
    modelScale: 0.01,
    // The source wyvern faces +Z. Gameplay forward is -Z.
    modelRotation: { x: 0, y: 180, z: 0 },
    // Recenter the exported bounds after the 180-degree turn and put its feet
    // on the ground instead of leaving most of the mesh below y=0.
    modelOffset: { x: 0, y: 9.65, z: -7.08 },
    walkSpeed: 9,
    chargeSpeed: 17,
    acceleration: 5,
    turnResponsiveness: 10
  },
  camera: {
    fov: 62,
    distance: 34,
    minDistance: 18,
    maxDistance: 58,
    pitchDegrees: 16,
    minPitch: -8,
    maxPitch: 52,
    targetHeight: 5.2,
    lookAhead: 4,
    mouseSensitivity: 0.15,
    zoomStep: 2,
    followResponsiveness: 7
  }
} as const;

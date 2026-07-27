/**
 * GENERATED — do not edit. Run `npm run extract:model` to regenerate.
 *
 * Rest-pose measurements extracted from `public/assets/wyvern/wyvern.glb` by
 * `scripts/extract-model-data.mjs`. All values are in raw GLB units, in model
 * space, before the runtime scale/rotation/offset in `src/tuning.ts`.
 *
 * Committed deliberately: `public/assets/` is excluded from version control,
 * so the build must not depend on the GLB being present.
 */

export const WYVERN_MODEL = {
  bounds: {
    min: [-2164.7656, -964.3109, -2073.9343],
    max: [2164.7676, 41.177, 658.7411],
    size: [4329.5332, 1005.4879, 2732.6755]
  },
  /** Model origin down to the lowest vertex — the drake's ground offset. */
  footDrop: 964.3109,
  /** Depth centre, for recentring after the 180-degree facing flip. */
  zCentre: -707.5966,
  /** Standing height. */
  height: 1005.4879,
  /**
   * Attachment points, averaged over their source bones. The equivalent of
   * Unreal's named sockets — see `SOCKETS` in the extraction script.
   */
  sockets: {
    mouth: [0.0002, -201.4209, 626.6089],
    head: [0.0001, -221.1006, 344.2359],
    jaw: [0.0001, -173.0098, 463.3548]
  },
  /** Bone names each socket was averaged from, for the view to look up live. */
  socketBones: {
    mouth: ['mouth7_L_001_047', 'mouth7_R_001_066'],
    head: ['head_021'],
    jaw: ['jaw_022']
  }
} as const;

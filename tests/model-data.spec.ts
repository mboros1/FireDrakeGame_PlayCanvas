import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { extract } from '../scripts/extract-model-data.mjs';
import { WYVERN_MODEL } from '../src/generated/wyvern-model';
import { MOUTH_LOCAL, TUNING, DRAKE_HEIGHT_M } from '../src/tuning';

const SOURCE = 'public/assets/wyvern/wyvern.glb';

test('the committed model data still matches the source GLB', () => {
  // Runtime assets are excluded from version control, so this can only run
  // where they are present. Skipping is honest; asserting would fail for a
  // reason that has nothing to do with the code.
  test.skip(!existsSync(SOURCE), `${SOURCE} not present — run npm run extract:model`);

  const fresh = extract(SOURCE);
  expect(fresh.footDrop).toBeCloseTo(WYVERN_MODEL.footDrop, 3);
  expect(fresh.zCentre).toBeCloseTo(WYVERN_MODEL.zCentre, 3);
  expect(fresh.bounds.size[1]).toBeCloseTo(WYVERN_MODEL.height, 3);
  const sockets = fresh.sockets as Record<string, number[]>;
  for (const [name, position] of Object.entries(sockets)) {
    const committed = WYVERN_MODEL.sockets[name as keyof typeof WYVERN_MODEL.sockets];
    expect(committed, `socket ${name} missing from generated data`).toBeDefined();
    for (let axis = 0; axis < 3; axis++) {
      expect(position[axis]).toBeCloseTo(committed[axis], 3);
    }
  }
});

test('the drake is scaled to its target standing height', () => {
  expect(WYVERN_MODEL.height * TUNING.drake.modelScale).toBeCloseTo(DRAKE_HEIGHT_M, 6);
});

test('the model offset puts the feet on the ground and recentres depth', () => {
  const scale = TUNING.drake.modelScale;
  // Lowest vertex lands at y=0 once the offset is applied.
  expect(WYVERN_MODEL.bounds.min[1] * scale + TUNING.drake.modelOffset.y).toBeCloseTo(0, 6);
  // Depth centre lands at z=0 after the 180-degree facing flip.
  expect(-WYVERN_MODEL.zCentre * scale + TUNING.drake.modelOffset.z).toBeCloseTo(0, 6);
});

test('the breath socket sits ahead of and above the drake origin', () => {
  // Gameplay forward is -Z, so a mouth in front of the body has negative z.
  expect(MOUTH_LOCAL.z).toBeLessThan(0);
  expect(MOUTH_LOCAL.y).toBeGreaterThan(0);
  // And it is on the model, not out in space: within its own bounding box.
  const half = (axis: number) => (WYVERN_MODEL.bounds.size[axis] * TUNING.drake.modelScale) / 2;
  expect(Math.abs(MOUTH_LOCAL.z)).toBeLessThan(half(2) + 0.01);
  expect(MOUTH_LOCAL.y).toBeLessThan(DRAKE_HEIGHT_M);
  expect(Math.abs(MOUTH_LOCAL.x)).toBeLessThan(0.05);
});

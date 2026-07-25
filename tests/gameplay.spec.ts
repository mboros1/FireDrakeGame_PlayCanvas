import { expect, test, type Page } from '@playwright/test';

type DebugState = {
  scene: 'cave' | 'forest' | 'forestExtract';
  modelReady: boolean;
  pointerLocked: boolean;
  pointerLockRequested: boolean;
  drake: { x: number; y: number; z: number; yaw: number };
  camera: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    distance: number;
    targetDistance: number;
  };
  model: {
    scale: number;
    rotation: { x: number; y: number; z: number };
    offset: { x: number; y: number; z: number };
    forwardAlignment: number | null;
  };
  effects: { breathParticles: number; activeDwarves: number };
  extracted: { objects: number; sourceLevel: string | null; loadError: string | null };
};

const state = (page: Page) =>
  page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState());

test('third-person Fire Drake control loop', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => window.__FIRE_DRAKE_DEBUG__?.getState().modelReady, undefined, {
    timeout: 30_000
  });

  const loaded = await state(page);
  expect(loaded.modelReady).toBe(true);
  expect(loaded.model.scale).toBeCloseTo(.01);
  expect(loaded.model.offset.y).toBeGreaterThan(9);
  expect(loaded.model.forwardAlignment).not.toBeNull();
  expect(loaded.model.forwardAlignment!).toBeGreaterThan(.65);
  await page.screenshot({ path: 'test-results/visual/01-loaded.png' });

  const canvas = page.locator('#game');
  await canvas.click({ position: { x: 720, y: 450 } });
  await expect.poll(async () => (await state(page)).pointerLockRequested).toBe(true);

  const beforeLook = await state(page);
  await page.mouse.move(720, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(850, 390, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await state(page)).camera.yaw).not.toBeCloseTo(beforeLook.camera.yaw);
  if ((await state(page)).pointerLocked) await page.keyboard.press('Escape');

  const beforeMove = await state(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const afterMove = await state(page);
  expect(Math.hypot(
    afterMove.drake.x - beforeMove.drake.x,
    afterMove.drake.z - beforeMove.drake.z
  )).toBeGreaterThan(2);

  const beforeZoom = await state(page);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await state(page)).camera.targetDistance)
    .toBeLessThan(beforeZoom.camera.targetDistance);

  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  expect((await state(page)).effects.breathParticles).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.screenshot({ path: 'test-results/visual/02-look-move-zoom-fire.png' });

  await page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.loadScene('forest'));
  await page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.resetCamera());
  await expect.poll(async () => (await state(page)).effects.activeDwarves).toBeGreaterThanOrEqual(6);
  await expect.poll(async () => {
    const current = await state(page);
    return Math.hypot(
      current.camera.x - current.drake.x,
      current.camera.y - current.drake.y,
      current.camera.z - current.drake.z
    );
  }).toBeGreaterThan(25);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/visual/03-forest.png' });

  expect(browserErrors).toEqual([]);
});

declare global {
  interface Window {
    __FIRE_DRAKE_DEBUG__: {
      getState: () => DebugState;
      teleport: (x: number, z: number) => void;
      loadScene: (name: 'cave' | 'forest' | 'forestExtract') => void;
      resetCamera: () => void;
    };
  }
}

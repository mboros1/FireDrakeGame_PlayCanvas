import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * Phone controls, on an emulated landscape phone with real touch events
 * (sent through the DevTools protocol, which is what a finger produces).
 */

test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

type TouchState = {
  drake: { x: number; z: number };
  camera: { yaw: number };
  effects: { breathParticles: number };
  touch: { forward: number; charging: boolean; breathing: boolean } | null;
};

const state = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as TouchState);
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number, number][]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });

test('a phone can prowl, charge, look and breathe fire', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);

  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });
  expect(await state(page).then(s => s.touch)).not.toBeNull();
  await expect(page.locator('.cover-prompt')).toHaveText(/tap/);

  // Tap to open the book, then go to the village.
  await touch(cdp, 'touchStart', [[420, 60, 1]]);
  await touch(cdp, 'touchEnd', []);
  await page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.loadScene('forest'));
  await expect(page.locator('.touch-layer')).toBeVisible();

  const start = await state(page);
  await touch(cdp, 'touchStart', [[150, 280, 1]]);
  for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [[150, 280 - i * 8, 1]]);
  await page.waitForTimeout(600);
  const walking = await state(page);
  expect(walking.touch!.forward).toBeGreaterThan(.5);
  expect(walking.touch!.charging).toBe(false);
  expect(Math.hypot(walking.drake.x - start.drake.x, walking.drake.z - start.drake.z)).toBeGreaterThan(1.5);

  await touch(cdp, 'touchMove', [[150, 180, 1]]);
  await page.waitForTimeout(100);
  expect((await state(page)).touch!.charging).toBe(true);

  // Second finger on the right half turns the camera while the stick holds.
  await touch(cdp, 'touchStart', [[150, 180, 1], [600, 200, 2]]);
  for (let i = 1; i <= 8; i++) await touch(cdp, 'touchMove', [[150, 180, 1], [600 + i * 12, 200, 2]]);
  expect(Math.abs((await state(page)).camera.yaw - walking.camera.yaw)).toBeGreaterThan(10);
  await touch(cdp, 'touchEnd', []);

  const fire = await page.locator('.touch-fire').boundingBox();
  await touch(cdp, 'touchStart', [[fire!.x + fire!.width / 2, fire!.y + fire!.height / 2, 3]]);
  await expect.poll(async () => (await state(page)).effects.breathParticles).toBeGreaterThan(0);
  expect((await state(page)).touch!.breathing).toBe(true);
  await touch(cdp, 'touchEnd', []);
  await page.screenshot({ path: 'test-results/visual/06-phone.png' });

  expect(errors).toEqual([]);
});

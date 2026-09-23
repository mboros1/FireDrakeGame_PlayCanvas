import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two browsers, one room, against a real room server (see playwright.config).
 * Proves the whole loop: join, see each other, move, share the rampage.
 */

type NetState = {
  scene: string;
  drake: { x: number; z: number };
  mayhem: { score: number };
  effects: { activeDwarves: number };
  net: { status: string; seat: number; players: number; lastCorrection: number } | null;
};

const SERVER = 'ws://127.0.0.1:8787/ws';

const join = async (browser: Browser, room: string, name: string) => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/?room=${room}&name=${name}&server=${encodeURIComponent(SERVER)}`);
  await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as NetState | undefined)?.net?.status === 'open', undefined, { timeout: 60_000 });
  return { page, errors };
};

const state = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as NetState);

test('two drakes share one village', async ({ browser }) => {
  const room = `test-${Date.now() % 100000}`;
  const a = await join(browser, room, 'Alpha');
  const b = await join(browser, room, 'Beta');

  await expect.poll(async () => (await state(a.page)).net?.players).toBe(2);
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(2);
  const [sa, sb] = [await state(a.page), await state(b.page)];
  expect(sa.scene).toBe('forest');
  expect(new Set([sa.net!.seat, sb.net!.seat])).toEqual(new Set([0, 1]));
  // The server's dwarves arrive by snapshot on both sides.
  await expect.poll(async () => (await state(b.page)).effects.activeDwarves).toBeGreaterThan(5);

  // A charges and breathes into the village; B's score follows A's rampage.
  const before = await state(a.page);
  await a.page.keyboard.down('KeyW');
  await a.page.keyboard.down('ShiftLeft');
  await a.page.waitForTimeout(1000);
  await a.page.keyboard.down('Space');
  await a.page.waitForTimeout(900);
  await a.page.keyboard.up('Space');
  await a.page.keyboard.up('ShiftLeft');
  await a.page.keyboard.up('KeyW');

  const after = await state(a.page);
  expect(Math.hypot(after.drake.x - before.drake.x, after.drake.z - before.drake.z)).toBeGreaterThan(8);
  // Prediction matches the server closely: no rubber-banding.
  expect(after.net!.lastCorrection).toBeLessThan(1);
  await expect.poll(async () => (await state(b.page)).mayhem.score).toBeGreaterThan(0);
  // Fire keeps spreading, so the score keeps moving: both sides must agree at
  // some instant, not match a value read once.
  await expect.poll(async () => {
    const [x, y] = await Promise.all([state(a.page), state(b.page)]);
    return x.mayhem.score === y.mayhem.score;
  }).toBe(true);

  await b.page.screenshot({ path: 'test-results/visual/05-multiplayer-watcher.png' });
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.page.close();
  await b.page.close();
});

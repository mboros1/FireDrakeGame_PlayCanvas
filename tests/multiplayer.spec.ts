import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two players, one room, no server: one of the pages hosts. Proves the whole
 * loop: join, see each other, move, share the rampage, survive the host
 * leaving. Both pages share a browser context and use `?signal=local`
 * (BroadcastChannel), so the suite needs no relays; the lobby rules are the
 * same over Nostr. `tests/lobby.spec.ts` covers the lobby itself in Node.
 */

type NetState = {
  scene: string;
  drake: { x: number; z: number };
  mayhem: { score: number };
  effects: { activeDwarves: number };
  net: { status: string; seat: number; players: number; lastCorrection: number; hosting: boolean } | null;
};

const join = async (context: BrowserContext, room: string, name: string) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/?room=${room}&name=${name}&signal=local`);
  await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as NetState | undefined)?.net?.status === 'open', undefined, { timeout: 60_000 });
  return { page, errors };
};

const state = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as NetState);

test('two drakes share one village', async ({ context }) => {
  const room = `test-${Date.now() % 100000}`;
  const a = await join(context, room, 'Alpha');
  await expect.poll(async () => (await state(a.page)).net?.hosting).toBe(true);
  const b = await join(context, room, 'Beta');

  await expect.poll(async () => (await state(a.page)).net?.players).toBe(2);
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(2);
  const [sa, sb] = [await state(a.page), await state(b.page)];
  expect(sa.scene).toBe('forest');
  expect(new Set([sa.net!.seat, sb.net!.seat])).toEqual(new Set([0, 1]));
  // The host's dwarves arrive by snapshot on both sides.
  await expect.poll(async () => (await state(b.page)).effects.activeDwarves).toBeGreaterThan(5);

  // B, the guest, charges and breathes into the village; the host's room
  // scores it and A sees the same score.
  const before = await state(b.page);
  await b.page.keyboard.down('KeyW');
  await b.page.keyboard.down('ShiftLeft');
  await b.page.waitForTimeout(1000);
  await b.page.keyboard.down('Space');
  await b.page.waitForTimeout(900);
  await b.page.keyboard.up('Space');
  await b.page.keyboard.up('ShiftLeft');
  await b.page.keyboard.up('KeyW');

  const after = await state(b.page);
  expect(Math.hypot(after.drake.x - before.drake.x, after.drake.z - before.drake.z)).toBeGreaterThan(8);
  // Prediction matches the host closely: no rubber-banding.
  expect(after.net!.lastCorrection).toBeLessThan(1);
  await expect.poll(async () => (await state(a.page)).mayhem.score).toBeGreaterThan(0);
  // Fire keeps spreading, so the score keeps moving: both sides must agree at
  // some instant, not match a value read once.
  await expect.poll(async () => {
    const [x, y] = await Promise.all([state(a.page), state(b.page)]);
    return x.mayhem.score === y.mayhem.score;
  }).toBe(true);

  await a.page.screenshot({ path: 'test-results/visual/05-multiplayer-watcher.png' });
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.page.close();
  await b.page.close();
});

test('a dropped player finds the room again on their own', async ({ context }) => {
  const room = `drop-${Date.now() % 100000}`;
  const a = await join(context, room, 'Alpha');
  const b = await join(context, room, 'Beta');
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(2);

  // A hosts, so dropping A also hands the room to B.
  await a.page.evaluate(() => (window.__FIRE_DRAKE_DEBUG__ as unknown as { dropConnection: () => void }).dropConnection());
  await expect.poll(async () => (await state(b.page)).net?.hosting, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await state(a.page)).net?.status, { timeout: 15_000 }).toBe('open');
  // Back in the same room with the same company.
  await expect.poll(async () => (await state(a.page)).net?.players, { timeout: 15_000 }).toBe(2);
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(2);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.page.close();
  await b.page.close();
});

test('when the host closes the book, the guest takes it up and plays on', async ({ context }) => {
  const room = `leave-${Date.now() % 100000}`;
  const a = await join(context, room, 'Alpha');
  await expect.poll(async () => (await state(a.page)).net?.hosting).toBe(true);
  const b = await join(context, room, 'Beta');
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(2);
  expect((await state(b.page)).net?.hosting).toBe(false);

  await a.page.close();
  await expect.poll(async () => (await state(b.page)).net?.hosting, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await state(b.page)).net?.players).toBe(1);
  // A fresh page of the same village, with dwarves in it again.
  await expect.poll(async () => (await state(b.page)).effects.activeDwarves).toBeGreaterThan(5);
  expect((await state(b.page)).scene).toBe('forest');
  expect(b.errors).toEqual([]);
  await b.page.close();
});

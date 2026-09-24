import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Bound chapters: the server API, and binding at the desk then reading the
 * chapter from the cover, alone and together.
 */

const HTTP = 'http://127.0.0.1:8787';
const SERVER = 'ws://127.0.0.1:8787/ws';
const village = () => JSON.parse(readFileSync('src/levels/little-kindling.json', 'utf8'));
const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const bind = (body: unknown, from = ip()) =>
  fetch(`${HTTP}/chapters`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain', 'fly-client-ip': from } });

type Game = { scene: string; desk: { boundCode: string | null } | null; effects: { activeDwarves: number }; net: { status: string; players: number } | null };
const game = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as Game);

test('bind a chapter and read it back by its code', async () => {
  const chapter = { ...village(), title: 'The Bakery', heading: 'In Which the Bakery Learns Humility', mood: 'moonlit' };
  chapter.props = chapter.props.slice(0, 40);
  const response = await bind(chapter);
  expect(response.status).toBe(201);
  const { code } = await response.json();
  expect(code).toMatch(/^[a-z]+-\d{3,4}$/);

  const read = await (await fetch(`${HTTP}/chapters/${code}`)).json();
  expect(read.title).toBe('The Bakery');
  expect(read.heading).toBe('In Which the Bakery Learns Humility');
  expect(read.level.mood).toBe('moonlit');
  expect(read.level.props.length).toBe(40);
  expect(read.level.id).toBe(`chapter-${code}`);
});

test('the binder refuses bad, oversized and unknown chapters', async () => {
  const bad = await bind({ ...village(), props: [{ kind: 'dragon', x: 0, z: 0, yaw: 0, size: 1, variant: 0 }] });
  expect(bad.status).toBe(400);
  expect((await bad.json()).problems).toContain('prop 0: unknown kind dragon');
  expect((await bind('not json at all')).status).toBe(400);
  const huge = await bind('x'.repeat(200_000)).catch(() => null);
  expect(huge?.status ?? 413).not.toBe(201);
  expect((await fetch(`${HTTP}/chapters/turnip-000`)).status).toBe(404);
  expect((await fetch(`${HTTP}/chapters/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
});

test('write at the desk, bind, and read it from the cover by its code', async ({ page }) => {
  await page.goto(`/?desk=1&server=${encodeURIComponent(SERVER)}`);
  await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.desk, undefined, { timeout: 60_000 });
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="details"]').click();
  await page.locator('#details-heading').fill('In Which a Code Is Shared');
  await page.locator('#details-heading').press('Tab');
  await page.locator('[data-action="bind"]').click();
  await expect(page.locator('#bound-code')).toHaveText(/^[a-z]+-\d{3,4}$/);
  const code = (await page.locator('#bound-code').textContent())!;

  // A fresh reader, from the cover.
  await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });
  await page.locator('#read-code').fill(code);
  await page.locator('#read-form button').click();
  await expect.poll(async () => (await game(page)).scene).toBe('forest');
  await expect(page.locator('#objective')).toHaveText('In Which a Code Is Shared');

  // A wrong code says so and stays on the cover.
  await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });
  await page.locator('#read-code').fill('turnip-000');
  await page.locator('#read-form button').click();
  await expect(page.locator('#read-error')).toContainText('No chapter is bound');
});

test('a room plays a bound chapter for everyone in it', async ({ browser }) => {
  const chapter = { ...village(), title: 'Two Cottages', heading: 'In Which Two Cottages Are Plenty' };
  chapter.props = chapter.props.filter((p: { kind: string }) => p.kind === 'cottage').slice(0, 2);
  const { code } = await (await bind(chapter)).json();
  const room = `bound-${Date.now() % 100000}`;
  const open = async (name: string) => {
    const page = await browser.newPage();
    await page.goto(`/?room=${room}&name=${name}&chapter=${code}&server=${encodeURIComponent(SERVER)}`);
    await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.net?.status === 'open', undefined, { timeout: 60_000 });
    return page;
  };
  const a = await open('Alpha');
  // The second joiner names no chapter: the room's own is what they get.
  const b = await browser.newPage();
  await b.goto(`/?room=${room}&name=Beta&server=${encodeURIComponent(SERVER)}`);
  await b.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.net?.status === 'open', undefined, { timeout: 60_000 });
  for (const page of [a, b]) {
    await expect.poll(async () => page.evaluate(() => document.querySelectorAll('#objective').length)).toBe(1);
    const props = await page.evaluate(() => (window.__FIRE_DRAKE_DEBUG__.getState() as unknown as { effects: { burningProps: number } }) && (window as unknown as { __FIRE_DRAKE_DEBUG__: { nearest: (k: string) => unknown } }).__FIRE_DRAKE_DEBUG__.nearest('tree'));
    // Only cottages in this chapter: there is no tree to find.
    expect(props).toBeNull();
  }
  await a.close();
  await b.close();

  // Asking a new room for a chapter that does not exist is refused, clearly.
  const c = await browser.newPage();
  await c.goto(`/?room=missing-${Date.now() % 100000}&name=Gamma&chapter=turnip-000&server=${encodeURIComponent(SERVER)}`);
  await expect.poll(async () => (await game(c)).net?.status, { timeout: 15_000 }).toBe('no-chapter');
  await c.close();
});

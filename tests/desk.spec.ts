import { expect, test, type Page } from '@playwright/test';

/**
 * The author's desk, driven with a real mouse and keyboard: place, move,
 * turn, draw, erase, undo, read the page, return, and export.
 */

type DeskState = {
  open: boolean;
  title: string;
  tool: string;
  props: number;
  paths: number;
  pond: [number, number, number] | null;
  spawns: number;
  selected: { kind: number; x: number; z: number; yaw: number; size: number } | null;
  problems: string[];
  undo: number;
  redo: number;
};
type Game = { scene: string; desk: DeskState | null; effects: { activeDwarves: number } };

const game = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as Game);
const desk = async (page: Page) => (await game(page)).desk!;

test('write a chapter at the desk, read it, and come back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem('fire-drake:chapter-drafts'));

  // The cover's link opens the desk on a copy of Little Kindling.
  await page.locator('#write-chapter').click();
  await expect.poll(async () => (await desk(page))?.open).toBe(true);
  await expect(page.locator('#desk')).toBeVisible();
  // Start from a blank page.
  await page.locator('[data-action="new"]').click();
  await expect.poll(async () => (await desk(page)).props).toBe(0);

  // Place two cottages.
  await page.locator('[data-tool="place"][data-kind="1"]').click();
  await page.mouse.click(620, 430);
  await page.mouse.click(820, 430);
  await expect.poll(async () => (await desk(page)).props).toBe(2);

  // Select the first, drag it, turn it.
  await page.keyboard.press('1');
  await page.mouse.click(620, 430);
  const picked = (await desk(page)).selected!;
  expect(picked).not.toBeNull();
  await page.mouse.move(620, 430);
  await page.mouse.down();
  await page.mouse.move(560, 520, { steps: 6 });
  await page.mouse.up();
  const moved = (await desk(page)).selected!;
  expect(Math.hypot(moved.x - picked.x, moved.z - picked.z)).toBeGreaterThan(2);
  await page.keyboard.press('KeyE');
  expect(Math.abs((await desk(page)).selected!.yaw - moved.yaw)).toBeCloseTo(15, 0);

  // Draw a path and a pond; set a second bookmark.
  await page.keyboard.press('P');
  await page.mouse.move(400, 600);
  await page.mouse.down();
  await page.mouse.move(700, 620, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await desk(page)).paths).toBe(2);
  await page.keyboard.press('O');
  await page.mouse.move(1000, 560);
  await page.mouse.down();
  await page.mouse.move(1060, 560, { steps: 4 });
  await page.mouse.up();
  expect((await desk(page)).pond).not.toBeNull();
  await page.keyboard.press('K');
  await page.keyboard.down('Shift');
  await page.mouse.click(720, 700);
  await page.keyboard.up('Shift');
  expect((await desk(page)).spawns).toBe(2);

  // Erase the second cottage; undo brings it back; redo takes it again.
  await page.keyboard.press('X');
  await page.mouse.click(820, 430);
  expect((await desk(page)).props).toBe(1);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect((await desk(page)).props).toBe(2);
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
  expect((await desk(page)).props).toBe(1);

  // Title it.
  await page.locator('#desk-title').fill('In Which the Bakery Learns Humility');
  await page.locator('#desk-title').press('Enter');
  expect((await desk(page)).title).toBe('In Which the Bakery Learns Humility');
  expect((await desk(page)).problems).toEqual([]);

  // Read it: the draft plays, with dwarves coming out of the cottage.
  await page.locator('[data-action="read"]').click();
  await expect.poll(async () => (await game(page)).scene).toBe('forest');
  await expect(page.locator('.draft-banner')).toBeVisible();
  await expect.poll(async () => (await game(page)).effects.activeDwarves).toBeGreaterThan(0);

  // B returns to the desk with the draft intact and the undo history kept.
  await page.keyboard.press('KeyB');
  await expect.poll(async () => (await game(page)).scene).toBe('desk');
  const back = await desk(page);
  expect(back.props).toBe(1);
  expect(back.title).toBe('In Which the Bakery Learns Humility');
  expect(back.undo).toBeGreaterThan(5);

  // The draft survives a reload: it was autosaved as a valid chapter file.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-drake:chapter-drafts') ?? '{}'));
  expect(stored.drafts[0].level.title).toBe('In Which the Bakery Learns Humility');
  expect(stored.drafts[0].level.props[0].kind).toBe('cottage');
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });
  await page.evaluate(() => (window.__FIRE_DRAKE_DEBUG__.loadScene as (name: string) => void)('desk'));
  await expect.poll(async () => (await desk(page))?.title).toBe('In Which the Bakery Learns Humility');
  await page.screenshot({ path: 'test-results/visual/07-desk.png' });

  expect(errors).toEqual([]);
});

test('chapter details: heading, mood and deeds carry into the page', async ({ page }) => {
  await page.goto('/?desk=1');
  await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.desk?.open, undefined, { timeout: 60_000 });
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="details"]').click();
  await page.locator('#details-heading').fill('In Which Winter Comes Early');
  await page.locator('#details-heading').press('Tab');
  await page.locator('#details-opening').fill('Snow fell on Little Kindling, which was about to become the least of its problems.');
  await page.locator('#details-opening').press('Tab');
  await page.locator('[data-mood="snow"]').click();
  // Make the deeds this chapter's own: add one, then retarget it.
  await page.locator('[data-deed-action="add"]').click();
  const row = page.locator('.details-deeds li[data-deed]').last();
  await row.locator('select').selectOption('burn-haystacks');
  await row.locator('.deed-count').fill('2');
  await row.locator('.deed-count').press('Tab');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fire-drake:chapter-drafts') ?? '{}').drafts[0].level);
  expect(stored.heading).toBe('In Which Winter Comes Early');
  expect(stored.mood).toBe('snow');
  expect(stored.narration.opening).toContain('Snow fell');
  expect(stored.deeds.at(-1)).toEqual({ template: 'burn-haystacks', count: 2 });
  expect(stored.deeds.length).toBe(12);

  await page.locator('[data-action="read"]').click();
  await expect.poll(async () => (await game(page)).scene).toBe('forest');
  await expect(page.locator('#objective')).toHaveText('In Which Winter Comes Early');
  await expect(page.locator('#narrator')).toContainText('Snow fell');
  await expect(page.locator('#deeds-count')).toHaveText('0 of 12');
});

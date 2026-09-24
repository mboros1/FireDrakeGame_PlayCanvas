import { expect, test, type Page } from '@playwright/test';

/**
 * Bound chapters with no server: bind at the desk, find the chapter in the
 * table of contents, read it by its code alone and together.
 * `tests/chapter-code.spec.ts` covers the codes themselves.
 */

type Game = { scene: string; desk: { boundCode: string | null } | null; effects: { activeDwarves: number }; net: { status: string; players: number } | null };
const game = (page: Page) => page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as unknown as Game);
const ready = (page: Page) => page.waitForFunction(() => document.body.classList.contains('ready'), undefined, { timeout: 60_000 });

/** Write a small chapter at the desk and bind it; its code. */
const bindAtDesk = async (page: Page, heading: string) => {
  await page.goto('/?desk=1');
  await page.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.desk, undefined, { timeout: 60_000 });
  await page.locator('[data-action="copy"]').click();
  await page.locator('[data-action="details"]').click();
  await page.locator('#details-heading').fill(heading);
  await page.locator('#details-heading').press('Tab');
  await page.locator('[data-action="bind"]').click();
  await expect(page.locator('#bound-code')).toHaveValue(/^fd1\.[A-Za-z0-9_-]{100,}$/);
  await expect(page.locator('#bound-name')).toHaveText(/^[a-z]+-\d{3}$/);
  return (await page.locator('#bound-code').inputValue())!;
};

test('bind at the desk, then read it from the cover by its code', async ({ page }) => {
  const code = await bindAtDesk(page, 'In Which a Code Is Shared');

  // A fresh reader in another browser has no shelf: the code alone is enough.
  const reader = await page.context().browser()!.newPage();
  await reader.goto('/');
  await ready(reader);
  await reader.locator('#read-code').fill(code);
  await reader.locator('#read-form button').click();
  await expect.poll(async () => (await game(reader)).scene).toBe('forest');
  await expect(reader.locator('#objective')).toHaveText('In Which a Code Is Shared');

  // A wrong code says so and stays on the cover.
  await reader.goto('/');
  await ready(reader);
  await reader.locator('#read-code').fill('bakery-771');
  await reader.locator('#read-form button').click();
  await expect(reader.locator('#read-error')).toContainText('not a chapter code');
  expect((await game(reader)).scene).toBe('cave');

  // And a link carries it too.
  await reader.goto(`/?chapter=${code}`);
  await expect.poll(async () => (await game(reader)).scene, { timeout: 60_000 }).toBe('forest');
  await expect(reader.locator('#objective')).toHaveText('In Which a Code Is Shared');
  await reader.close();
});

test('the table of contents lists the book and the shelf, and reads from it', async ({ page }) => {
  await bindAtDesk(page, 'In Which the Shelf Fills Up');
  await page.goto('/');
  await ready(page);
  await page.locator('#open-contents').click();
  const contents = page.locator('#contents');
  await expect(contents).toBeVisible();
  // Opening the contents does not open the book.
  expect(await page.evaluate(() => document.querySelector('#cover')!.classList.contains('opened'))).toBe(false);
  await expect(contents.locator('.contents-entry').first()).toContainText('Little Kindling');
  const bound = contents.locator('.contents-entry', { hasText: 'In Which the Shelf Fills Up' });
  await expect(bound).toContainText('bound by you');

  // Removing asks twice.
  const entries = await contents.locator('.contents-entry').count();
  await bound.locator('[data-act="remove"]').click();
  await expect(contents.locator('[data-act="remove"].confirm')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('#open-contents').click();
  await expect(contents.locator('.contents-entry')).toHaveCount(entries);

  await contents.locator('.contents-entry', { hasText: 'In Which the Shelf Fills Up' }).locator('[data-act="read"]').click();
  await expect(contents).toBeHidden();
  await expect.poll(async () => (await game(page)).scene).toBe('forest');
  await expect(page.locator('#objective')).toHaveText('In Which the Shelf Fills Up');

  // A pasted code from someone else lands on the shelf as sent.
  await page.goto('/?contents');
  await expect(contents).toBeVisible();
  await expect(contents.locator('.contents-entry')).toHaveCount(entries);
  await contents.locator('#contents-code').fill('nonsense');
  await contents.locator('.contents-add button').click();
  await expect(contents.locator('#contents-error')).toContainText('not a chapter code');
});

test('a room plays the opener\'s chapter for everyone in it', async ({ page }) => {
  const code = await bindAtDesk(page, 'In Which Two Drakes Share a Page');
  const room = `bound-${Date.now() % 100000}`;
  const context = page.context();
  const open = async (url: string) => {
    const player = await context.newPage();
    await player.goto(url);
    await player.waitForFunction(() => (window.__FIRE_DRAKE_DEBUG__?.getState() as unknown as Game)?.net?.status === 'open', undefined, { timeout: 60_000 });
    return player;
  };
  const a = await open(`/?room=${room}&name=Alpha&chapter=${code}&signal=local`);
  // The second joiner names no chapter: the room's own is what they get.
  const b = await open(`/?room=${room}&name=Beta&signal=local`);
  await expect.poll(async () => (await game(b)).net?.players).toBe(2);
  for (const player of [a, b]) {
    await expect(player.locator('#objective')).toHaveText('In Which Two Drakes Share a Page');
  }
  await a.close();
  await b.close();

  // A bad chapter code on "read it together" is caught before joining.
  await page.goto('/?signal=local');
  await ready(page);
  await page.locator('#together-chapter').fill('turnip-000');
  await page.locator('#together-form button').click();
  await expect(page.locator('#together-error')).toContainText('not a chapter code');
  expect((await game(page)).net).toBeNull();
});

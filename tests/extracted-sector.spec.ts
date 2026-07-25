import { expect, test } from '@playwright/test';

test('loads the extracted Unreal forest sector without browser errors', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const startedAt = Date.now();
  await page.goto('/?level=extracted');
  await page.waitForFunction(() => {
    const state = window.__FIRE_DRAKE_DEBUG__?.getState() as {
      scene?: string;
      modelReady?: boolean;
      extracted?: { objects: number; loadError: string | null };
    } | undefined;
    return state?.scene === 'forestExtract'
      && state.modelReady
      && (state.extracted?.objects ?? 0) >= 450;
  }, undefined, { timeout: 30_000 });

  const state = await page.evaluate(() => window.__FIRE_DRAKE_DEBUG__.getState() as {
    extracted: { objects: number; sourceLevel: string | null; loadError: string | null };
  });
  expect(state.extracted.objects).toBe(487);
  expect(state.extracted.sourceLevel).toContain('Lvl_Color_Alternative');
  expect(state.extracted.loadError).toBeNull();
  expect(Date.now() - startedAt).toBeLessThan(30_000);
  await page.screenshot({
    path: 'test-results/visual/04-extracted-forest-sector.png',
    fullPage: true
  });
  expect(browserErrors).toEqual([]);
});

import { test, expect } from '../fixtures/auth';

test('app boots with no uncaught console errors', async ({ gotoApp, page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await gotoApp('signedOut');

  // forecast shell present (logo always rendered)
  await expect(page.locator('img[src="logo.png"]').first()).toBeVisible();

  // filter out known-noisy third-party/network lines; fail on real JS errors
  const real = errors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
  expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
});

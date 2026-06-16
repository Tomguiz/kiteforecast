import { test, expect } from '../fixtures/auth';

test('non-premium user has an upgrade button in the profile panel', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await expect(page.locator('#ppUpgradeBtn')).toHaveCount(1);
});

test('premium user does not see the upgrade block', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300); // allow profile refresh to apply
  const hidden = await page.evaluate(() => {
    const el = document.getElementById('ppPremiumUpgrade');
    return !el || getComputedStyle(el).display === 'none';
  });
  expect(hidden).toBe(true);
});

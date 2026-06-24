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

test('premium user can open a feature detail popup from a grid tile', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="tides"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await expect(page.locator('#featureModalTitle')).toHaveText('Tide times');
  await expect(page.locator('#featureModalBlurb')).toContainText('tide schedule');
});

test('non-premium user can open a feature detail popup from the upgrade list', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await page.locator('#ppUpgradeFeatures .premium-feature-row[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await expect(page.locator('#featureModalTitle')).toHaveText('Unlimited fav spots');
  await expect(page.locator('#featureModalBlurb')).toContainText('favourite spots');
});

test('the feature popup closes via the X button and leaves the profile panel open', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await page.locator('#featureModal .m-close').click();
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the feature popup closes via backdrop click', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  // click the overlay itself (top-left corner avoids the centered card)
  await page.locator('#featureModalOverlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the feature popup closes via Escape and leaves the profile panel open', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the home-view Go Premium promo lists features and opens the popup on click', async ({ gotoApp, page }) => {
  await gotoApp('signedIn'); // non-premium
  await page.waitForTimeout(300);
  // The promo is shown on explicit trigger, never auto-shown — reveal it directly.
  await page.evaluate(() => { const m = document.getElementById('upgradeModal'); if (m) m.style.display = 'block'; });
  const promo = page.locator('#upgradeModalFeatures');
  await expect(promo.locator('.premium-feature-row')).toHaveCount(6);
  await promo.locator('.premium-feature-row[data-feature="tides"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await expect(page.locator('#featureModalTitle')).toHaveText('Tide times');
  // dismiss returns to the page (promo still present underneath)
  await page.keyboard.press('Escape');
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
});

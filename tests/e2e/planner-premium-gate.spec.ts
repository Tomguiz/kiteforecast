import { test, expect } from '../fixtures/auth';

// "Where to ride?" is premium. A free rider should learn that from the button
// itself, and learn where to go from the click — a disabled button explains
// nothing and leaves them guessing.

test('a free rider sees the button locked', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');                       // signed in, not premium
  await page.evaluate(() => updateProfileDot());
  await expect(page.locator('#planBtn')).toHaveClass(/locked/);
  await expect(page.locator('#planBtn')).toHaveAttribute('title', /premium/i);
});

test('and clicking it explains why, then goes where the payment is', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#planBtn').click();
  await expect(page.locator('#plannerOverlay')).toBeHidden();
  await expect(page.locator('.pp-toast')).toContainText(/premium only/i);
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the premium check comes before the home-location one', async ({ gotoApp, page }) => {
  // Sending a free rider off to set a home address for a feature they cannot
  // use would be the wrong first thing to tell them.
  await gotoApp('signedIn');
  await page.evaluate(() => { const p = loadProfile(); delete p.homeLat; delete p.homeLon; saveProfile(p); });
  await page.locator('#planBtn').click();
  // Assert on the toast, not the page: the profile panel it opens legitimately
  // contains a "Home location" field, so a body-wide check proves nothing.
  const toast = page.locator('.pp-toast');
  await expect(toast).toContainText(/premium only/i);
  await expect(toast).not.toContainText(/home location/i);
});

test('a premium rider is not blocked', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; p.homeLabel = 'Waterloo'; saveProfile(p);
    updateProfileDot();
  });
  await expect(page.locator('#planBtn')).not.toHaveClass(/locked/);
  await page.locator('#planBtn').click();
  await expect(page.locator('#plannerOverlay')).toBeVisible();
});

test('the lock follows the plan without a reload', async ({ gotoApp, page }) => {
  // updateProfileDot runs on sign-in, on profile sync and on returning from
  // checkout, so the lock cannot drift from the plan the rider is on.
  await gotoApp('signedIn');
  await page.evaluate(() => updateProfileDot());
  await expect(page.locator('#planBtn')).toHaveClass(/locked/);

  await page.evaluate(() => {
    const p = loadProfile(); p.isPremium = true; saveProfile(p);
    updateProfileDot();
  });
  await expect(page.locator('#planBtn')).not.toHaveClass(/locked/);
});

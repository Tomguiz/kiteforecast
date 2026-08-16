import { test, expect } from '../fixtures/auth';

// A returning user must look signed in immediately on load. initAuth() runs at
// top level and paints an optimistic session from the cached profile, then
// updateAuthUI() repaints the profile button.
//
// On 2026-08-16 that button stopped repainting: initAuth reaches renderSmsGate()
// via updateAuthUI -> updatePremiumUI, and SMS_RELEASED / NEARBY_RELEASED were
// `let`s declared thousands of lines FURTHER DOWN the file. At that moment they
// are in their temporal dead zone, so reading one threw ReferenceError and
// killed updateAuthUI before it touched the button. The session was fine; the
// user just looked logged out on every refresh.

test('a returning user is shown as signed in on load', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  await expect(page.locator('#profileBtn')).toHaveClass(/logged-in/);
  await expect(page.locator('#profileBtn .profile-btn-initials, #profileBtn img')).toHaveCount(1);
});

test('no uncaught ReferenceError while the page initialises', async ({ gotoApp, page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await gotoApp('signedIn');
  await page.waitForTimeout(600);

  expect(errors.filter(e => /before initialization|is not defined/i.test(e))).toEqual([]);
});

test('release flags are readable at the time initAuth runs', async ({ gotoApp, page }) => {
  // Guards the ordering directly: both flags must be initialised before any
  // top-level code that can reach them, not merely defined somewhere.
  await gotoApp('signedIn');

  const flags = await page.evaluate(() => ({
    sms: typeof SMS_RELEASED,
    nearby: typeof NEARBY_RELEASED,
  }));
  expect(flags).toEqual({ sms: 'boolean', nearby: 'boolean' });
});

test('the nearby row renders its released state, not a stale SOON badge', async ({ gotoApp, page }) => {
  // Same root cause, second symptom: renderNearbyToggle never ran, so the badge
  // was never hidden and the radius box was never filled.
  await gotoApp('premium');
  await page.evaluate(() => {
    // @ts-expect-error app global
    openProfilePanel('notifs');
    // @ts-expect-error app global
    renderNearbyToggle();
  });

  await expect(page.locator('#ppNearbySoonBadge')).toBeHidden();
  await expect(page.locator('#ppNearbyKm')).not.toHaveValue('');
});

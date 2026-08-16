import { test, expect } from '../fixtures/auth';

async function seed(page: any, profile: Record<string, unknown>) {
  await page.evaluate((profile: any) => {
    // @ts-expect-error app global
    window.isPremium = () => true;
    // @ts-expect-error app global
    const p = loadProfile();
    Object.assign(p, { email: 'me@example.com' }, profile);
    // @ts-expect-error app global
    saveProfile(p);
    // @ts-expect-error app global
    openProfilePanel('notifs');
    // @ts-expect-error app global
    renderNearbyToggle();
  }, profile);
}

test('the toggle works now that the feature is released', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: false });

  await expect(page.locator('#ppNearbySoonBadge')).toBeHidden();
  await expect(page.locator('#ppNearbyKm')).toBeEnabled();
  await expect(page.locator('#ppNearbyHint')).not.toContainText('Coming soon');
  await expect(page.locator('#ppNearbyHint')).toContainText('Knokke');
});

test('turning it on saves the preference', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: false });

  await page.evaluate(() => {
    // @ts-expect-error app global — capture what reaches profiles
    window.getSb = () => ({ from: () => ({ upsert: async (obj: any) => {
      (window as any).__saved = { ...((window as any).__saved || {}), ...obj }; return { error: null };
    } }) });
  });
  await page.locator('#ppNearbyToggle').click();

  await expect(page.locator('#ppNearbyToggle')).toHaveClass(/on/);
  expect(await page.evaluate(() => (window as any).__saved?.digest_nearby_enabled)).toBe(true);
});

test('still requires a home location before it can be switched on', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: null, homeLon: null, digestNearbyEnabled: false });

  await expect(page.locator('#ppNearbyHint')).toContainText('home location');
  await page.locator('#ppNearbyToggle').click();
  await expect(page.locator('#ppNearbyToggle')).not.toHaveClass(/on/);
});

test('the gate still holds if the flag is ever turned back off', async ({ gotoApp, page }) => {
  // Guards the kill switch: flipping NEARBY_RELEASED back to false must fully
  // re-gate the row, not leave a half-live control behind.
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: false });

  await page.evaluate(() => {
    // @ts-expect-error app global
    NEARBY_RELEASED = false;
    // @ts-expect-error app global
    renderNearbyToggle();
  });

  await expect(page.locator('#ppNearbySoonBadge')).toBeVisible();
  await expect(page.locator('#ppNearbyKm')).toBeDisabled();
  await expect(page.locator('#ppNearbyHint')).toContainText('Coming soon');
});

test('SMS alerts are marked SOON and cannot be switched on', async ({ gotoApp, page }) => {
  // Production has no TWILIO_* secrets, so process-reminders skips the send.
  // The toggle used to save a preference that could never produce a text.
  await gotoApp('premium');
  await page.evaluate(() => {
    // @ts-expect-error app global
    openProfilePanel('notifs');
    // @ts-expect-error app global
    // Scope the spy: a document click also fires an unrelated touchLastSeen
    // upsert of last_seen_at, which would make a blanket spy always true.
    window.getSb = () => ({ from: () => ({ upsert: async (obj: any) => {
      if (obj && 'sms_enabled' in obj) (window as any).__smsWrote = true;
      return { error: null };
    } }) });
    // @ts-expect-error app global
    renderSmsGate();
  });

  await expect(page.locator('#ppSmsSoonBadge')).toBeVisible();
  await page.locator('#ppSmsToggle').click();
  await expect(page.locator('#ppSmsToggle')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => (window as any).__smsWrote === true)).toBe(false);
});

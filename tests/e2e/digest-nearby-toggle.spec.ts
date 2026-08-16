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

test('the nearby row is marked SOON while the feature is unreleased', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: false });

  await expect(page.locator('#ppNearbyRow .soon-badge')).toHaveText('SOON');
  await expect(page.locator('#ppNearbyHint')).toContainText('Coming soon');
});

test('the toggle cannot be switched on while unreleased', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: false });

  // Fail loudly if the gate lets a digest_nearby_* write through. Scoped to
  // that payload (rather than any upsert) because a real click also fires
  // the app's unrelated last-seen-tracking upsert (profiles.last_seen_at) —
  // that one must NOT trip this assertion.
  await page.evaluate(() => {
    // @ts-expect-error app global
    window.getSb = () => ({ from: () => ({ upsert: async (obj: any) => {
      if (obj && (('digest_nearby_enabled' in obj) || ('digest_nearby_km' in obj))) (window as any).__wrote = true;
      return { error: null };
    } }) });
  });
  await page.locator('#ppNearbyToggle').click();

  await expect(page.locator('#ppNearbyToggle')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => (window as any).__wrote === true)).toBe(false);
  expect(await page.evaluate(() => {
    // @ts-expect-error app global
    return loadProfile().digestNearbyEnabled;
  })).not.toBe(true);
});

test('the radius input is disabled while unreleased', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyKm: 150 });

  await expect(page.locator('#ppNearbyKm')).toBeDisabled();
});

test('the SOON gate takes precedence over the home-location gate', async ({ gotoApp, page }) => {
  // Do not tell the user to go set a home location for something they cannot
  // enable yet.
  await gotoApp('signedIn');
  await seed(page, { homeLat: null, homeLon: null, digestNearbyEnabled: false });

  await expect(page.locator('#ppNearbyHint')).toContainText('Coming soon');
});

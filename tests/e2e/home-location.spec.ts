import { test, expect } from '../fixtures/auth';

// The home location drives the digest's "near you" section. It reuses the same
// Nominatim geocoder as the spot-suggestion form.
test('finding a home location fills the label and stores coordinates', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ lat: '51.3500', lon: '3.2800', display_name: 'Knokke-Heist, Belgium' }]),
    }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = 'Knokke-Heist';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  await expect(page.locator('#ppHomeStatus')).toContainText('Knokke-Heist, Belgium');

  const stored = await page.evaluate(() => {
    // @ts-expect-error app global
    const p = loadProfile();
    return { lat: p.homeLat, lon: p.homeLon, label: p.homeLabel };
  });
  expect(stored.lat).toBeCloseTo(51.35, 2);
  expect(stored.lon).toBeCloseTo(3.28, 2);
  expect(stored.label).toBe('Knokke-Heist, Belgium');
});

test('a geocoder miss leaves the stored location untouched', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    // @ts-expect-error app global
    const p = loadProfile(); p.homeLat = 1; p.homeLon = 2; p.homeLabel = 'Existing';
    // @ts-expect-error app global
    saveProfile(p);
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = 'zzzzz nowhere';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  await expect(page.locator('#ppHomeStatus')).toContainText("Couldn't find");
  const stored = await page.evaluate(() => {
    // @ts-expect-error app global
    return loadProfile().homeLabel;
  });
  expect(stored).toBe('Existing');
});

test('an empty query does not call the geocoder', async ({ gotoApp, page }) => {
  let called = false;
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) => {
    called = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = '   ';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  expect(called).toBe(false);
});

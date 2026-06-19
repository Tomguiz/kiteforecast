import { test, expect } from '../fixtures/auth';

test('Find coordinates fills lat/lon from the geocoder', async ({ gotoApp, page }) => {
  // Mock Nominatim BEFORE navigation
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ lat: '36.0921', lon: '27.7619', display_name: 'Prasonisi, Rhodes, Greece' }]),
    }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'Prasonisi Rhodos';
    // @ts-expect-error app global
    return findCoordsFromName();
  });

  await expect(page.locator('#suggestLat')).toHaveValue('36.0921');
  await expect(page.locator('#suggestLon')).toHaveValue('27.7619');
  await expect(page.locator('#findCoordsStatus')).toContainText('Prasonisi, Rhodes, Greece');
});

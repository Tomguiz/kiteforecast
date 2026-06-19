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

test('zero results shows a "couldn\'t find" message, leaves fields empty', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'zzzznowhere';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await expect(page.locator('#findCoordsStatus')).toContainText(/couldn.t find/i);
  await expect(page.locator('#suggestLat')).toHaveValue('');
});

test('network error shows a "couldn\'t reach" message', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 500, body: 'err' }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'Knokke';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await expect(page.locator('#findCoordsStatus')).toContainText(/couldn.t reach/i);
});

test('empty name does not call the geocoder', async ({ gotoApp, page }) => {
  let called = false;
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) => { called = true; route.fulfill({ status: 200, body: '[]' }); });
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = '';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await page.waitForTimeout(200);
  expect(called).toBe(false);
});

test('non-numeric coordinates show a "no coordinates" message', async ({ gotoApp, page }) => {
  // Defensive branch: a result row whose lat/lon aren't parseable.
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ lat: 'x', lon: 'y', display_name: 'Weird Place' }]) }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'Weird Place';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await expect(page.locator('#findCoordsStatus')).toContainText(/no coordinates/i);
  await expect(page.locator('#suggestLat')).toHaveValue('');
});

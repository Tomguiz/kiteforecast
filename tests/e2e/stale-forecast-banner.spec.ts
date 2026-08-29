import { test, expect } from '../fixtures/auth';

// "Forecast may be outdated — tap to refresh" was .72rem in a 29px bar pinned
// to the bottom edge, where the phone browser's own toolbar competes for the
// tap. It was neither easy to see nor reliably hittable, and nothing about it
// said it was a button.

test.use({ viewport: { width: 390, height: 844 } });

const makeStale = (page: any) => page.evaluate(() => {
  lastFetchTime = Date.now() - 5 * 3600 * 1000;   // 5h old
  updateFetchTimestamp();
});

const makeFresh = (page: any) => page.evaluate(() => {
  lastFetchTime = Date.now();
  updateFetchTimestamp();
});

test('the stale bar is a comfortable tap target', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await makeStale(page);

  const box = await page.locator('#fetchTimestamp').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(48);   // was 29
});

test('it says it is a button rather than hoping you try tapping', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await makeStale(page);

  await expect(page.locator('#fetchTimestamp')).toContainText('Forecast may be outdated');
  await expect(page.locator('#fetchTimestamp .fetch-ts-btn')).toBeVisible();
  await expect(page.locator('#fetchTimestamp .fetch-ts-btn')).toContainText('Refresh');
});

test('tapping it actually refreshes', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => { (window as any)._refreshed = false; (window as any).refreshForecast = () => { (window as any)._refreshed = true; }; });
  await makeStale(page);
  await page.locator('#fetchTimestamp').click();

  expect(await page.evaluate(() => (window as any)._refreshed)).toBe(true);
});

test('a fresh forecast drops the warning but keeps the refresh', async ({ gotoApp, page }) => {
  // Refresh used to appear only once the app declared the data stale. With
  // forecasts served from a shared row that is normally up to two hours old,
  // that warning would have been the permanent state — so the alarm goes and
  // the control stays. What must still clear is the warning text itself.
  await gotoApp('signedIn');
  await makeStale(page);
  await expect(page.locator('#fetchTimestamp')).toContainText('Forecast may be outdated');

  await makeFresh(page);
  await expect(page.locator('#fetchTimestamp')).not.toContainText('outdated');
  await expect(page.locator('#fetchTimestamp')).not.toHaveClass(/stale/);
  await expect(page.locator('#fetchTimestamp')).toContainText('Updated');
  await expect(page.locator('#fetchTimestamp .fetch-ts-btn')).toBeVisible();
});

test('the fresh bar is quiet, but the rider can still ask for fresh data', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => { (window as any)._refreshed = false; (window as any).refreshForecast = () => { (window as any)._refreshed = true; }; });
  await makeFresh(page);

  // quiet: no alarm colour, small type
  await expect(page.locator('#fetchTimestamp')).not.toHaveClass(/stale/);
  // but reachable: this bar was once .72rem of text pinned to the bottom edge
  // and could not be hit on a phone. It must stay a real target.
  const box = await page.locator('#fetchTimestamp').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.locator('#fetchTimestamp').click();
  expect(await page.evaluate(() => (window as any)._refreshed)).toBe(true);
});

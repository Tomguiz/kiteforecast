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

test('a fresh forecast leaves no Refresh button behind', async ({ gotoApp, page }) => {
  // the stale state writes markup; the fresh branch must clear it, not just
  // overwrite the text around it
  await gotoApp('signedIn');
  await makeStale(page);
  await expect(page.locator('#fetchTimestamp .fetch-ts-btn')).toBeVisible();

  await makeFresh(page);
  expect(await page.locator('#fetchTimestamp .fetch-ts-btn').count()).toBe(0);
  await expect(page.locator('#fetchTimestamp')).toContainText('Last forecast update');
});

test('the fresh bar stays out of the way — no pointer events, no tap', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await makeFresh(page);

  expect(await page.evaluate(() =>
    getComputedStyle(document.getElementById('fetchTimestamp')!).pointerEvents)).toBe('none');
});

import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// chipBestCache is keyed "lat,lon|dirs". Several call sites need to look up a
// spot's cached forecast by lat,lon regardless of the dirs suffix. A single
// shared helper, chipBestForSpot(lat,lon), does the prefix match so no caller
// can reintroduce the bare-key bug (which silently lost entries for any spot
// with wind directions).

test('chipBestForSpot resolves a dirs-suffixed cache entry by lat,lon', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const got = await page.evaluate(() => {
    const lat = 51.35, lon = 3.28;
    chipBestCache[`${lat},${lon}|270,315`] = { spotName: 'X', days10: [] };
    return chipBestForSpot(lat, lon)?.spotName ?? null;
  });
  expect(got).toBe('X');
});

test('chipBestForSpot does not false-match a different spot via a shorter prefix', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const got = await page.evaluate(() => {
    // a "51.3,..." spot must NOT resolve a "51.35,..." entry
    chipBestCache[`51.35,3.28|270`] = { spotName: 'long', days10: [] };
    return chipBestForSpot(51.3, 3.28)?.spotName ?? 'no-match';
  });
  expect(got).toBe('no-match');
});

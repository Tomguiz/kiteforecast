import { test, expect } from '../fixtures/auth';

// Root-cause regression: the homepage "good days" badge and the spot-detail
// "X of Y days rideable" header used two DIFFERENT definitions of a rideable
// day (7-day window + any-2-qualifying-hours vs 10-day window + 2-CONSECUTIVE-
// hours), so the two views disagreed. Both must now use ONE definition:
// 10-day window, day qualifies on >=2 CONSECUTIVE qualifying daylight hours.
//
// dayGoodHours(hours) is the single shared definition. `hours` is an array of
// { hr, kn, dir, code, gustKn } for a day's daylight hours, with windDirs (a
// Set) already applied via the app's global direction check. It returns the
// count of qualifying hours that are part of a 2+ consecutive (by clock hour)
// run — identical to buildDay()'s goodHours.

test('dayGoodHours counts 2 consecutive qualifying hours as a rideable day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const n = await page.evaluate(() => {
    // good NW wind, clear sky, at consecutive hours 12 & 13
    windDirs = new Set([315]);
    const hours = [
      { hr: 12, kn: 22, dir: 315, code: 0, gustKn: 26 },
      { hr: 13, kn: 24, dir: 315, code: 0, gustKn: 28 },
    ];
    return dayGoodHours(hours);
  });
  expect(n).toBeGreaterThanOrEqual(2);
});

test('dayGoodHours does NOT count 2 NON-consecutive qualifying hours', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const n = await page.evaluate(() => {
    windDirs = new Set([315]);
    // qualifying at 10 and 15 — a 5-hour gap, no 2-consecutive run
    const hours = [
      { hr: 10, kn: 22, dir: 315, code: 0, gustKn: 26 },
      { hr: 15, kn: 24, dir: 315, code: 0, gustKn: 28 },
    ];
    return dayGoodHours(hours);
  });
  expect(n).toBe(0);
});

test('buildDay().goodHours and dayGoodHours agree on the same data (one definition)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { fromBuildDay, fromHelper } = await page.evaluate(() => {
    windDirs = new Set([315]);
    const D = '2026-06-27';
    // daylight hours 9..16, qualifying NW run at 11-14
    const m = new Map<number, any>();
    const kns: Record<number, number> = { 9: 8, 10: 10, 11: 18, 12: 22, 13: 24, 14: 16, 15: 9, 16: 7 };
    for (const hr of Object.keys(kns).map(Number)) {
      m.set(hr, { kn: kns[hr], dir: 315, code: 0, gustKn: kns[hr] + 5 });
    }
    cachedHrMap = new Map([[D, m]]);
    const bd = buildDay(D, `${D}T05:54`, `${D}T21:29`);
    const hours = [...m.entries()].map(([hr, d]) => ({ hr, ...d }));
    return { fromBuildDay: bd.goodHours, fromHelper: dayGoodHours(hours) };
  });
  expect(fromHelper).toBe(fromBuildDay);
  expect(fromBuildDay).toBeGreaterThanOrEqual(2); // the NW run at 11-14 qualifies
});

test('the homepage good-days fetch uses the same forecast window as the spot page (16 days)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // Capture the open-meteo forecast request fired by fetchChipQualDays and
  // assert it asks for the same window as the spot detail page (16 days), so
  // the homepage badge and the spot header can never disagree on the count.
  const reqUrl = page.waitForRequest((req) =>
    req.url().includes('api.open-meteo.com/v1/forecast') &&
    req.url().includes('windspeed_10m'));
  await page.evaluate(() => {
    // fire the homepage chip fetch directly for a known spot
    fetchChipQualDays({ name: 'T', loc: '', lat: 51.35, lon: 3.28, dirs: [270, 315] });
  });
  const url = (await reqUrl).url();
  expect(url).toContain('forecast_days=16');
});

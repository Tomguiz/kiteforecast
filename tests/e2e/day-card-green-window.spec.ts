import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// A day-card's sparkline should highlight, in bright green, the hours that form
// the 2h+ consecutive good-wind window — the same hours dayGoodHours counts.
// dayGoodWindowMask(hours, dirOK?) returns a boolean per hour (true = part of a
// 2+ consecutive qualifying run). tdsSparkSVG(kn, color, mask) overlays a green
// segment on the masked points, leaving the rest of the line its base color.

test('dayGoodWindowMask marks the consecutive qualifying run and nothing else', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const mask = await page.evaluate(() => {
    windDirs = new Set([315]);
    // hours 9..14; qualifying NW run at 11,12,13; 9,10 light; 14 light
    const hours = [
      { hr: 9, kn: 8, dir: 315, code: 0, gustKn: 10 },
      { hr: 10, kn: 10, dir: 315, code: 0, gustKn: 12 },
      { hr: 11, kn: 18, dir: 315, code: 0, gustKn: 22 },
      { hr: 12, kn: 22, dir: 315, code: 0, gustKn: 26 },
      { hr: 13, kn: 24, dir: 315, code: 0, gustKn: 28 },
      { hr: 14, kn: 9, dir: 315, code: 0, gustKn: 11 },
    ];
    return dayGoodWindowMask(hours);
  });
  expect(mask).toEqual([false, false, true, true, true, false]);
});

test('dayGoodWindowMask is all-false when there is no 2h consecutive run', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const mask = await page.evaluate(() => {
    windDirs = new Set([315]);
    // qualifying at 10 and 14 only — not consecutive
    const hours = [
      { hr: 10, kn: 22, dir: 315, code: 0, gustKn: 26 },
      { hr: 12, kn: 8, dir: 315, code: 0, gustKn: 10 },
      { hr: 14, kn: 22, dir: 315, code: 0, gustKn: 26 },
    ];
    return dayGoodWindowMask(hours);
  });
  expect(mask).toEqual([false, false, false]);
});

test('tdsSparkSVG draws a green window overlay when a mask is provided', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { withMask, withoutMask } = await page.evaluate(() => {
    const kn = [8, 10, 18, 22, 24, 9];
    const mask = [false, false, true, true, true, false];
    return {
      withMask: tdsSparkSVG(kn, '#f97316', mask),
      withoutMask: tdsSparkSVG(kn, '#f97316'),
    };
  });
  // the green overlay polyline uses the session-green color #4ade80
  expect(withMask).toContain('#4ade80');
  expect(withMask.match(/<polyline/g)?.length).toBeGreaterThan(1); // base + green overlay
  // no mask → no green overlay
  expect(withoutMask).not.toContain('#4ade80');
});

test('the day-card sparkline gets a green window for a rideable day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const hasGreen = await page.evaluate(() => {
    windDirs = new Set([315]);
    const D = '2026-06-27';
    const m = new Map<number, any>();
    const kns: Record<number, number> = { 9: 8, 10: 10, 11: 18, 12: 22, 13: 24, 14: 16, 15: 9 };
    for (const hr of Object.keys(kns).map(Number)) m.set(hr, { kn: kns[hr], dir: 315, code: 0, gustKn: kns[hr] + 5 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [0],
      temperature_2m_max: [22], temperature_2m_min: [15], windgusts_10m_max: [13],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    renderGrid();
    const card = document.querySelector('#tdsCols .tds-day-card')!;
    return card.querySelector('.tds-dc-spark')!.innerHTML.includes('#4ade80');
  });
  expect(hasGreen).toBe(true);
});

test('a non-rideable day-card sparkline has no green window', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const hasGreen = await page.evaluate(() => {
    windDirs = new Set([315]);
    const D = '2026-06-27';
    const m = new Map<number, any>();
    // all light wind — no qualifying hours, so no 2h window
    for (let hr = 9; hr <= 15; hr++) m.set(hr, { kn: 7 + (hr % 2), dir: 315, code: 0, gustKn: 10 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [0],
      temperature_2m_max: [22], temperature_2m_min: [15], windgusts_10m_max: [13],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    renderGrid();
    const card = document.querySelector('#tdsCols .tds-day-card')!;
    return card.querySelector('.tds-dc-spark')!.innerHTML.includes('#4ade80');
  });
  expect(hasGreen).toBe(false);
});

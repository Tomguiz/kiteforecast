import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The 16-day card's base sparkline was coloured purely by wind SPEED
// (windBarColor(maxKn)), so a strong-but-not-rideable day (wrong direction or
// rain) showed a misleading green line — contradicting the card's own
// "× Wind dir / RAIN" verdict. The base line must be GREY unless the day is
// actually rideable (hasSession, i.e. a 2h+ qualifying window). The green
// good-window overlay still highlights exactly when conditions are good.

const GREY = '#475569';

function seedOneDay(page: import('@playwright/test').Page, opts: {
  dir: number; code: number; kn: number;
}) {
  return page.evaluate((o) => {
    windDirs = new Set([315]); // good = NW only
    const D = '2026-06-27';
    const m = new Map<number, any>();
    // strong wind all daylight, but direction/rain decide rideability
    for (let h = 9; h <= 17; h++) m.set(h, { kn: o.kn, dir: o.dir, code: o.code, gustKn: o.kn + 8 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [o.code],
      temperature_2m_max: [22], temperature_2m_min: [15], windgusts_10m_max: [13],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    renderGrid();
    return document.querySelector('#tdsCols .tds-day-card .tds-dc-spark')!.innerHTML;
  }, opts);
}

test('a strong but WRONG-DIRECTION day draws a grey (not green) base line', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // 22kn (green strength) but blowing from SW (225°) — not in the NW good set
  const svg = await seedOneDay(page, { dir: 225, code: 0, kn: 22 });
  expect(svg).toContain(GREY);          // base line is neutral grey
  expect(svg).not.toContain('#4ade80'); // no green window overlay either
});

test('a strong but RAINY day draws a grey base line', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // 22kn from NW (good dir) but rain (code 61) → not rideable
  const svg = await seedOneDay(page, { dir: 315, code: 61, kn: 22 });
  expect(svg).toContain(GREY);
});

test('a genuinely rideable day draws a coloured (green-strength) base line', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // 22kn from NW (good dir), clear → rideable
  const svg = await seedOneDay(page, { dir: 315, code: 0, kn: 22 });
  expect(svg).not.toContain(GREY);   // base line is NOT the neutral grey
  expect(svg).toContain('#4ade80');  // green good-window overlay present
});

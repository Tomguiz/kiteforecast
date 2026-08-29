import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The "16-day overview" strip should reflect a genuine 16-day forecast, and the
// spot-detail rideable header / strip must render up to 16 day-cards.
//
// forecast_days=16 is no longer the client's business: forecasts go through the
// shared cache function, which builds the Open-Meteo URL server-side. These two
// tests now pin what the client is still responsible for — that both the spot
// view and the chips go through that function, on the same coordinates. The
// 16-day window itself is asserted in unit/forecast-cache-mirror.test.ts,
// against the function's own source.

test('the spot-detail forecast fetch goes through the shared cache', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const req = page.waitForRequest((r) => r.url().includes('/functions/v1/forecast'));
  await page.evaluate(() => {
    // fetchForecast geocodes by NAME first, so use a real place name
    fetchForecast('Knokke-Heist');
  });
  expect((await req).url()).toContain('/functions/v1/forecast');
});

test('the homepage good-days fetch uses the same shared cache', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const req = page.waitForRequest((r) =>
    r.url().includes('/functions/v1/forecast') && r.url().includes('lat=51.35'));
  await page.evaluate(() => {
    fetchChipQualDays({ name: 'T', loc: '', lat: 51.35, lon: 3.28, dirs: [270, 315] });
  });
  // The chips used to ask Open-Meteo for their own narrower variable set. They
  // now share the spot view's row, which is where the saved requests come from.
  expect((await req).url()).toContain('lon=3.28');
});

test('the 16-day strip renders one day-card per day for a 16-day dataset', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const count = await page.evaluate(() => {
    windDirs = new Set([315]);
    const days: string[] = [];
    const codes: number[] = [];
    cachedHrMap = new Map();
    // 16 consecutive days starting 2026-06-27
    for (let d = 0; d < 16; d++) {
      const day = new Date(Date.UTC(2026, 5, 27 + d));
      const ds = day.toISOString().slice(0, 10);
      days.push(ds);
      codes.push(0);
      const m = new Map<number, any>();
      for (let h = 9; h <= 17; h++) m.set(h, { kn: 18 + (h % 3), dir: 315, code: 0, gustKn: 24 });
      cachedHrMap.set(ds, m);
    }
    cachedLoc = { name: 'Test Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: days, weather_code: codes,
      temperature_2m_max: days.map(() => 22), temperature_2m_min: days.map(() => 15),
      windgusts_10m_max: days.map(() => 13),
      sunrise: days.map((d) => `${d}T05:54`), sunset: days.map((d) => `${d}T21:29`),
    } };
    renderGrid();
    return document.querySelectorAll('#tdsCols .tds-day-card').length;
  });
  expect(count).toBe(16);
});

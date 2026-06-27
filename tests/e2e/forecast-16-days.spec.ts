import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The "16-day overview" strip should reflect a genuine 16-day forecast: every
// open-meteo forecast fetch must request forecast_days=16, and the spot-detail
// rideable header / strip must render up to 16 day-cards.

test('the spot-detail forecast fetch requests 16 forecast days', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // capture the main wind forecast request (has windspeed_10m + temperature_2m)
  const reqUrl = page.waitForRequest((req) =>
    req.url().includes('api.open-meteo.com/v1/forecast') &&
    req.url().includes('temperature_2m') &&
    req.url().includes('windspeed_10m'));
  await page.evaluate(() => {
    // fetchForecast geocodes by NAME first, so use a real place name
    fetchForecast('Knokke-Heist');
  });
  const url = (await reqUrl).url();
  expect(url).toContain('forecast_days=16');
});

test('the homepage good-days fetch also requests 16 forecast days', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const reqUrl = page.waitForRequest((req) =>
    req.url().includes('api.open-meteo.com/v1/forecast') &&
    req.url().includes('windspeed_10m') &&
    !req.url().includes('temperature_2m')); // the chip fetch omits temperature
  await page.evaluate(() => {
    fetchChipQualDays({ name: 'T', loc: '', lat: 51.35, lon: 3.28, dirs: [270, 315] });
  });
  const url = (await reqUrl).url();
  expect(url).toContain('forecast_days=16');
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

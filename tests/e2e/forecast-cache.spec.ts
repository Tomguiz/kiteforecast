import { test, expect } from '../fixtures/auth';

// Forecasts are served from a shared Supabase row so that one rider's fetch
// answers for every rider on the same spot. The cache is an optimisation:
// when it is unreachable the app must still show a forecast.

const FN = /functions\/v1\/forecast/;

function wxPayload(D: string) {
  const times: string[] = [], t: number[] = [], c: number[] = [],
        ws: number[] = [], wd: number[] = [], wg: number[] = [];
  for (let h = 0; h < 24; h++) {
    times.push(`${D}T${String(h).padStart(2, '0')}:00`);
    t.push(18); c.push(1); ws.push(h >= 11 && h <= 17 ? 11 : 4); wd.push(250); wg.push(14);
  }
  return {
    hourly: { time: times, temperature_2m: t, weather_code: c,
              windspeed_10m: ws, winddirection_10m: wd, windgusts_10m: wg },
    daily: { time: [D], weather_code: [1], temperature_2m_max: [22], temperature_2m_min: [14],
             windgusts_10m_max: [14], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] },
  };
}

test('a spot is served from the shared cache, and reports that row age as its own', async ({ gotoApp, page }) => {
  const D = new Date().toISOString().slice(0, 10);
  // The row was fetched by someone else 40 minutes ago.
  const rowFetchedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  let calls = 0;
  let authSeen = false;

  let direct = 0;
  await gotoApp('signedOut');
  await page.route(FN, route => {
    calls++;
    const h = route.request().headers();
    authSeen = !!(h['authorization'] && h['apikey']);
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ wx: wxPayload(D), marine: null, fetched_at: rowFetchedAt, source: 'cache' }) });
  });
  // Nothing may reach Open-Meteo directly while the function answers.
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, r => { direct++; r.abort(); });
  await page.evaluate(() => { localStorage.removeItem('kf_wxCache_v2'); });
  await page.evaluate(async () => {
    if (window._spotsReady) await window._spotsReady;
    pickSpot(SPOTS.find((s: any) => /Riverwoods/i.test(s.name)));
  });
  await expect(page.locator('#forecastGrid .fday').first()).toBeVisible({ timeout: 15000 });

  expect(calls).toBeGreaterThan(0);
  expect(direct).toBe(0);
  // Every function in this project answers 401 without one, so a call that
  // forgets it would 401 in production and fall through to Open-Meteo for
  // ever — a shared cache nobody ever reads. Mocks cannot see that; assert it.
  expect(authSeen).toBe(true);

  // The timestamp must show when the DATA was fetched, not when this rider
  // happened to ask. Claiming "updated just now" for a 40-minute-old row is
  // the one thing a shared cache must not do.
  const drift = await page.evaluate((iso: string) =>
    Math.abs(lastFetchTime - Date.parse(iso)), rowFetchedAt);
  expect(drift).toBeLessThan(2000);
});

test('the app still shows a forecast when the cache is unreachable', async ({ gotoApp, page }) => {
  const D = new Date().toISOString().slice(0, 10);
  let direct = 0;
  await gotoApp('signedOut');
  await page.route(FN, route => route.fulfill({ status: 503, body: 'down' }));
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, route => {
    direct++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wxPayload(D)) });
  });
  await page.evaluate(() => { localStorage.removeItem('kf_wxCache_v2'); });
  await page.evaluate(async () => {
    if (window._spotsReady) await window._spotsReady;
    pickSpot(SPOTS.find((s: any) => /Riverwoods/i.test(s.name)));
  });
  await expect(page.locator('#forecastGrid .fday').first()).toBeVisible({ timeout: 15000 });
  expect(direct).toBeGreaterThan(0);
});

test('a manual refresh asks the server for fresh data, not the stored row', async ({ gotoApp, page }) => {
  const D = new Date().toISOString().slice(0, 10);
  const urls: string[] = [];
  await gotoApp('signedOut');
  await page.route(FN, route => {
    urls.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ wx: wxPayload(D), marine: null, fetched_at: new Date().toISOString(), source: 'live' }) });
  });
  await page.evaluate(async () => {
    if (window._spotsReady) await window._spotsReady;
    pickSpot(SPOTS.find((s: any) => /Riverwoods/i.test(s.name)));
  });
  await expect(page.locator('#forecastGrid .fday').first()).toBeVisible({ timeout: 15000 });

  urls.length = 0;
  await page.evaluate(() => refreshForecast());
  await page.waitForTimeout(1500);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.some(u => u.includes('force=1'))).toBe(true);
});

test('the refresh bar is quiet by default but always tappable', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => {
    lastFetchTime = Date.now() - 30 * 60 * 1000;   // half an hour: normal now
    updateFetchTimestamp();
  });
  const bar = page.locator('#fetchTimestamp');
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveClass(/stale/);           // no alarm in the normal case
  await expect(bar).toContainText('Updated');
  await expect(bar.locator('.fetch-ts-btn')).toBeVisible();
  // It was unhittable on a phone once; it must stay a real tap target.
  const box = await bar.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => typeof document.getElementById('fetchTimestamp')!.onclick)).toBe('function');
});

test('past the window it still says so', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => {
    lastFetchTime = Date.now() - 5 * 60 * 60 * 1000;    // auto-refresh could not reach anything
    updateFetchTimestamp();
  });
  await expect(page.locator('#fetchTimestamp')).toHaveClass(/stale/);
  await expect(page.locator('#fetchTimestamp')).toContainText('outdated');
});

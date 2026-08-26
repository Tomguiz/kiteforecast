import { test, expect } from '../fixtures/auth';

// Pulling down to refresh did nothing for a full hour after opening a spot.
// Every refresh path — pull-to-refresh, the stale bar, returning to a
// backgrounded tab — went through fetchForecastFromSpot, which serves a
// 1-hour localStorage cache before touching the network. The spinner span,
// the app redrew byte-identical data, and the rider concluded it was broken.
//
// A deliberate refresh now forces a real request; ordinary navigation still
// uses the cache, which is what the cache is for.

const FX = ['2026-08-26', '2026-08-27', '2026-08-28'];
function forecast() {
  const time: string[] = [], ws: number[] = [], wd: number[] = [], wg: number[] = [], wc: number[] = [], t2: number[] = [];
  for (const d of FX) for (let h = 0; h < 24; h++) {
    time.push(`${d}T${String(h).padStart(2,'0')}:00`);
    ws.push(9); wd.push(270); wg.push(11); wc.push(0); t2.push(20);
  }
  return { latitude: 51.3627, longitude: 3.3062, timezone: 'Europe/Brussels',
    hourly: { time, temperature_2m: t2, weather_code: wc, windspeed_10m: ws, winddirection_10m: wd, windgusts_10m: wg },
    daily: { time: FX, weather_code: FX.map(()=>0), temperature_2m_max: FX.map(()=>22), temperature_2m_min: FX.map(()=>14),
      windgusts_10m_max: FX.map(()=>20), sunrise: FX.map(d=>`${d}T05:30`), sunset: FX.map(d=>`${d}T22:00`) } };
}

async function setup(page: any) {
  let calls = 0;
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r: any) => {
    // The favourites chips hit the SAME endpoint with their own cache, so
    // counting every call to it measures the wrong thing. temperature_2m is
    // requested only by the spot forecast; the chip fetch omits it.
    if (decodeURIComponent(r.request().url()).includes('temperature_2m')) calls++;
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(forecast()) });
  });
  await page.route(/marine-api\.open-meteo\.com/, (r: any) => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ hourly:{ time:[], wave_height:[], wave_period:[], wave_direction:[] } }) }));
  return { calls: () => calls };
}

const openSpot = (page: any) => page.evaluate(async () => {
  await (window as any)._spotsReady;
  await pickSpot({ name:'Riverwoods Beachclub', loc:'Knokke-Heist, Belgium', lat:51.3627, lon:3.3062, dirs:[270,315] });
});

test('a forced refresh hits the network even with a warm cache', async ({ gotoApp, page }) => {
  const c = await setup(page);
  await gotoApp('signedIn');
  await openSpot(page);
  await page.waitForTimeout(900);
  const afterOpen = c.calls();
  expect(afterOpen).toBeGreaterThan(0);

  // ordinary navigation to the same spot: the cache answers, no new request
  await openSpot(page);
  await page.waitForTimeout(900);
  expect(c.calls()).toBe(afterOpen);

  // the explicit gesture: this must go out to the network
  await page.evaluate(() => refreshForecast());
  await page.waitForTimeout(1200);
  expect(c.calls()).toBeGreaterThan(afterOpen);
});

test('the stale bar appears after 15 minutes, not 3 hours', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const states = await page.evaluate(() => {
    const read = () => (document.getElementById('fetchTimestamp') as HTMLElement).className;
    lastFetchTime = Date.now() - 10 * 60 * 1000; updateFetchTimestamp();
    const at10 = read();
    lastFetchTime = Date.now() - 20 * 60 * 1000; updateFetchTimestamp();
    const at20 = read();
    return { at10, at20 };
  });
  expect(states.at10).not.toContain('stale');   // 10 min: still fresh
  expect(states.at20).toContain('stale');       // 20 min: offer the refresh
});

test('the bar clears once the refresh has actually landed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const after = await page.evaluate(() => {
    lastFetchTime = Date.now() - 20 * 60 * 1000; updateFetchTimestamp();
    const stale = (document.getElementById('fetchTimestamp') as HTMLElement).className;
    lastFetchTime = Date.now(); updateFetchTimestamp();
    return { stale, fresh: (document.getElementById('fetchTimestamp') as HTMLElement).className };
  });
  expect(after.stale).toContain('stale');
  expect(after.fresh).not.toContain('stale');
});

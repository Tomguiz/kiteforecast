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
  // Forecasts now go through the shared Supabase cache, and the spot view and
  // the chips call it with the same URL shape — so the old "count only the
  // requests carrying temperature_2m" trick no longer separates them. What
  // still distinguishes an explicit refresh is force=1, so count that.
  // Count per coordinate. The favourites chips call the same endpoint on a
  // queue, so a bare total picks up Tarifa and Dakhla arriving in the
  // background and measures the wrong thing — which is exactly what the old
  // temperature_2m filter existed to avoid.
  const calls: string[] = [];
  let forced = 0;
  await page.route(/functions\/v1\/forecast/, (r: any) => {
    const url = r.request().url();
    calls.push(url);
    if (url.includes('force=1')) forced++;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      wx: forecast(), marine: null, fetched_at: new Date().toISOString(), source: 'live' }) });
  });
  // Safety net: nothing should reach Open-Meteo while the function answers.
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r: any) =>
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(forecast()) }));
  await page.route(/marine-api\.open-meteo\.com/, (r: any) => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ hourly:{ time:[], wave_height:[], wave_period:[], wave_direction:[] } }) }));
  return {
    calls: () => calls.length,
    // calls for one spot only, which is what "did this spot refetch?" means
    spotCalls: (lat: number) => calls.filter(u => u.includes(`lat=${lat}`)).length,
    forced: () => forced,
  };
}

const openSpot = (page: any) => page.evaluate(async () => {
  await (window as any)._spotsReady;
  await pickSpot({ name:'Riverwoods Beachclub', loc:'Knokke-Heist, Belgium', lat:51.3627, lon:3.3062, dirs:[270,315] });
});

test('a forced refresh hits the network even with a warm cache', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const c = await setup(page);
  await openSpot(page);
  await page.waitForTimeout(900);
  const afterOpen = c.spotCalls(51.3627);
  expect(afterOpen).toBeGreaterThan(0);
  expect(c.forced()).toBe(0);            // opening a spot never forces

  // ordinary navigation to the same spot: the on-device cache answers
  await openSpot(page);
  await page.waitForTimeout(900);
  expect(c.spotCalls(51.3627)).toBe(afterOpen);

  // the explicit gesture: this must go out to the network
  await page.evaluate(() => refreshForecast());
  await page.waitForTimeout(1200);
  expect(c.spotCalls(51.3627)).toBeGreaterThan(afterOpen);
  // and it must tell the server to skip the shared row, or a "refresh" would
  // hand back the very same data it already had
  expect(c.forced()).toBeGreaterThan(0);
});

test('the bar warns only past the window the app itself uses', async ({ gotoApp, page }) => {
  // The original bug this pinned: the bar warned at 15 min while the app only
  // re-fetched at 30, so for a quarter of an hour it asked the rider to do
  // something it was willing to do itself. Both are STALE_AFTER_MS, now two
  // hours to match the shared cache — the invariant is that they agree.
  await gotoApp('signedIn');
  const states = await page.evaluate(() => {
    const read = () => (document.getElementById('fetchTimestamp') as HTMLElement).className;
    lastFetchTime = Date.now() - 40 * 60 * 1000; updateFetchTimestamp();
    const inside = read();
    lastFetchTime = Date.now() - 3 * 60 * 60 * 1000; updateFetchTimestamp();
    const outside = read();
    return { inside, outside, window: STALE_AFTER_MS };
  });
  expect(states.window).toBe(2 * 60 * 60 * 1000);
  expect(states.inside).not.toContain('stale');   // 40 min: normal, served from cache
  expect(states.outside).toContain('stale');      // 3 h: the refresh really did not land
});

test('the bar clears once the refresh has actually landed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const after = await page.evaluate(() => {
    lastFetchTime = Date.now() - 3 * 60 * 60 * 1000; updateFetchTimestamp();
    const stale = (document.getElementById('fetchTimestamp') as HTMLElement).className;
    lastFetchTime = Date.now(); updateFetchTimestamp();
    return { stale, fresh: (document.getElementById('fetchTimestamp') as HTMLElement).className };
  });
  expect(after.stale).toContain('stale');
  expect(after.fresh).not.toContain('stale');
});

// ── Refresh refreshes the page you are on ──────────────────────────────────
//
// On the home screen refreshForecast did loadLastSpot() and navigated to
// whichever spot the rider had opened last — a jarring answer to "refresh
// what I am looking at", and the thing they actually reported: tapping the
// bar threw them into a spot detail page.

test('refreshing from the home screen does not navigate to a spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  await page.evaluate(async () => {
    await (window as any)._spotsReady;
    // a spot HAS been opened before, so loadLastSpot() would find one
    saveLastSpot({ name: 'Riverwoods Beachclub', loc: 'Knokke-Heist, Belgium', lat: 51.3627, lon: 3.3062, dirs: [270, 315] });
    cachedLoc = null;                       // but none is open now
    (window as any)._navigated = null;
    (window as any).pickSpot = (s: any) => { (window as any)._navigated = s.name; };
  });

  await page.evaluate(() => refreshForecast());
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => (window as any)._navigated)).toBe(null);
});

test('it refreshes the home chips instead, and clears the stale bar', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  const r = await page.evaluate(async () => {
    await (window as any)._spotsReady;
    cachedLoc = null;
    saveFavs([{ name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 }]);
    // a warm chip cache, and a stale bar showing
    chipFxCache['51.3627,3.3062|270,315'] = 3;
    lastFetchTime = Date.now() - 3 * 60 * 60 * 1000;
    updateFetchTimestamp();
    const before = (document.getElementById('fetchTimestamp') as HTMLElement).className;

    refreshForecast();

    return {
      before,
      after: (document.getElementById('fetchTimestamp') as HTMLElement).className,
      stalePlantGone: chipFxCache['51.3627,3.3062|270,315'] !== 3,
    };
  });

  expect(r.before).toContain('stale');
  expect(r.stalePlantGone).toBe(true);   // the chips actually refetch
  expect(r.after).not.toContain('stale');
});

test('refreshing with a spot open still refreshes that spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  await page.evaluate(async () => {
    await (window as any)._spotsReady;
    cachedLoc = { name: 'Riverwoods Beachclub', latitude: 51.3627, longitude: 3.3062, admin1: 'Knokke-Heist', country: 'Belgium' };
    (window as any)._navigated = null;
    (window as any)._forced = null;
    (window as any).pickSpot = (s: any, o: any) => { (window as any)._navigated = s.name; (window as any)._forced = o?.force; };
  });

  await page.evaluate(() => refreshForecast());
  expect(await page.evaluate(() => (window as any)._navigated)).toBe('Riverwoods Beachclub');
  expect(await page.evaluate(() => (window as any)._forced)).toBe(true);
});

// ── The two gestures must not drift apart again ────────────────────────────
//
// "Last forecast update" kept showing an old time however often the rider
// pulled down. Pull-to-refresh ran a bare renderHintChips() on the home
// screen — no cache clear, so the chips redrew from the 1-hour cache, and no
// lastFetchTime stamp, so the timestamp never moved. The stale bar had
// already been fixed; this gesture had not, so the two disagreed a second
// time. They now share one implementation.

const pullToRefresh = (page: any) => page.evaluate(() => {
  // Real Touch instances: TouchEventInit refuses plain objects.
  const t = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(10)], bubbles: true }));
  document.dispatchEvent(new TouchEvent('touchmove',  { touches: [t(60)], bubbles: true }));
  document.dispatchEvent(new TouchEvent('touchend',   { changedTouches: [t(120)], bubbles: true }));
});

test('pulling down on the home screen stamps the timestamp and clears the chip cache', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  await page.evaluate(async () => {
    await (window as any)._spotsReady;
    cachedLoc = null;
    window.scrollTo(0, 0);
    saveFavs([{ name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 }]);
    chipFxCache['51.3627,3.3062|270,315'] = 3;
    lastFetchTime = Date.now() - 3 * 60 * 60 * 1000;   // the "old timestamp"
    updateFetchTimestamp();
  });

  const before = await page.evaluate(() =>
    Math.round((Date.now() - lastFetchTime) / 60000));
  expect(before).toBeGreaterThan(120);

  await pullToRefresh(page);
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    ageMin: Math.round((Date.now() - lastFetchTime) / 60000),
    stalePlantGone: chipFxCache['51.3627,3.3062|270,315'] !== 3,
    shown: document.getElementById('fetchTimestamp')!.textContent,
  }));
  expect(after.ageMin).toBe(0);            // the timestamp actually moved
  expect(after.stalePlantGone).toBe(true); // and the chips really refetch
  expect(after.shown).toContain('Updated');
});

test('pulling down with a spot open refreshes that spot, not the home screen', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  await page.evaluate(async () => {
    await (window as any)._spotsReady;
    window.scrollTo(0, 0);
    cachedLoc = { name: 'Riverwoods Beachclub', latitude: 51.3627, longitude: 3.3062, admin1: 'Knokke-Heist', country: 'Belgium' };
    (window as any)._picked = null;
    (window as any)._forced = null;
    (window as any).pickSpot = (s: any, o: any) => { (window as any)._picked = s.name; (window as any)._forced = o?.force; };
  });

  await pullToRefresh(page);
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => (window as any)._picked)).toBe('Riverwoods Beachclub');
  expect(await page.evaluate(() => (window as any)._forced)).toBe(true);
});

// ── Opening the app is itself a refresh request ────────────────────────────
//
// The rider launched the app and was met with "Forecast may be outdated"
// immediately. Two thresholds disagreed: the bar showed at 15 minutes, the
// automatic refresh only fired at 30 — and only when a spot was open, and
// only via visibilitychange, which does not fire on a cold open at all. So
// between 15 and 30 minutes the app asked for something it was willing to do
// itself, and on launch it just asked.

test('stale data refreshes itself instead of asking', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  const r = await page.evaluate(() => {
    (window as any)._refreshed = false;
    (window as any).refreshForecast = () => { (window as any)._refreshed = true; };
    lastFetchTime = Date.now() - 3 * 60 * 60 * 1000;   // past the 2h window
    const acted = refreshIfStale();
    return { acted, refreshed: (window as any)._refreshed };
  });
  expect(r.acted).toBe(true);
  expect(r.refreshed).toBe(true);
});

test('fresh data is left alone — no request on every resume', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  const r = await page.evaluate(() => {
    (window as any)._refreshed = false;
    (window as any).refreshForecast = () => { (window as any)._refreshed = true; };
    lastFetchTime = Date.now() - 5 * 60 * 1000;
    return { acted: refreshIfStale(), refreshed: (window as any)._refreshed };
  });
  expect(r.acted).toBe(false);
  expect(r.refreshed).toBe(false);
});

test('a rider who has never fetched anything is not refreshed at', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await setup(page);
  const acted = await page.evaluate(() => {
    (window as any).refreshForecast = () => { throw new Error('should not run'); };
    lastFetchTime = 0;
    return refreshIfStale();
  });
  expect(acted).toBe(false);
});

test('the bar and the auto-refresh agree on when data is stale', async ({ gotoApp, page }) => {
  // The actual defect was two numbers, 15 and 30, drifting apart. Pin that
  // they are one number: whenever the bar decides to show, refreshIfStale
  // would also have acted.
  await gotoApp('signedIn');
  await setup(page);
  const rows = await page.evaluate(() => {
    (window as any).refreshForecast = () => {};
    return [5, 14, 16, 25, 40, 200].map(min => {
      lastFetchTime = Date.now() - min * 60 * 1000;
      updateFetchTimestamp();
      return {
        min,
        barShown: (document.getElementById('fetchTimestamp') as HTMLElement).className.includes('stale'),
        wouldRefresh: refreshIfStale(),
      };
    });
  });
  for (const r of rows) expect(r.barShown).toBe(r.wouldRefresh);
});

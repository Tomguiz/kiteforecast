import { test, expect } from '../fixtures/auth';

// Riders cross-check against Windfinder and Windguru. Both links are built from
// the spot's COORDINATES rather than its name: Windfinder does have per-spot
// pages at /forecast/<slug>, but a slug derived from our spot name resolves
// only about a third of the time (Brouwersdam, Domburg and Tarifa work;
// Oesterdam, Oostduinkerke and Sycod are 404s). A link that misses half the
// time is worse than none.

const D = '2026-09-01';

// The links now live in the footer of an OPEN day, next to Details / Columns /
// I'm going — where a rider is reading the very hours they might want a second
// opinion on, rather than in the spot header two screens up.
async function openSpot(page: any, lat: number, lon: number) {
  await page.evaluate(({ D, lat, lon }: any) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: 18, gustKn: 24, dir: 250, code: 1, temp: 18 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: "T'Hekje Ouddorp", admin1: 'Zeeland', latitude: lat, longitude: lon, country: 'NL' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [20], temperature_2m_min: [14],
      windgusts_10m_max: [24], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
    // Open it, do not toggle: this helper runs twice in one test, and a second
    // toggle would close the day and take the footer with it.
    if (!_openForecastDays.has(D)) toggleForecastDay(D, 0);
  }, { D, lat, lon });
}

test('both links appear in the open day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  await expect(page.locator('.fg-foot a', { hasText: 'Windfinder' })).toBeVisible();
  await expect(page.locator('.fg-foot a', { hasText: 'Windguru' })).toBeVisible();
});

test('they carry the spot coordinates, not its name', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  const wf = await page.locator('.fg-foot a', { hasText: 'Windfinder' }).getAttribute('href');
  const wg = await page.locator('.fg-foot a', { hasText: 'Windguru' }).getAttribute('href');
  expect(wf).toBe('https://www.windfinder.com/#13/51.3627/3.3062');
  expect(wg).toBe('https://www.windguru.cz/map?lat=51.3627&lon=3.3062&zoom=13');
  // the apostrophe in the spot name must not appear anywhere in either
  expect(wf).not.toContain('Hekje');
  expect(wg).not.toContain('Hekje');
});

test('they follow the spot when it changes', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  await openSpot(page, 36.0143, -5.6044);          // Tarifa
  const wf = await page.locator('.fg-foot a', { hasText: 'Windfinder' }).getAttribute('href');
  expect(wf).toContain('36.0143');
  expect(wf).toContain('-5.6044');                  // a negative longitude survives
});

test('they open in a new tab, without leaking the referrer', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  for (const name of ['Windfinder', 'Windguru']) {
    const a = page.locator('.fg-foot a', { hasText: name });
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', /noopener/);
    await expect(a).toHaveAttribute('rel', /noreferrer/);
  }
});

test('the URL builders round consistently', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => ({
    wf: windfinderUrl(51.36271234, 3.30619876),
    wg: windguruUrl(51.36271234, 3.30619876),
  }));
  // four decimals is ~11 m — far finer than either site's map needs, and it
  // keeps the URL stable rather than jittering with float noise.
  expect(r.wf).toBe('https://www.windfinder.com/#13/51.3627/3.3062');
  expect(r.wg).toContain('lat=51.3627&lon=3.3062');
});

test('the Windfinder path is one the iOS app does NOT claim', async ({ gotoApp, page }) => {
  // Deliberate, and the reverse of what this test asserted before. Windfinder's
  // apple-app-site-association claims /forecast/*, /weatherforecast/*,
  // /report/*, /webcams/*, /maps/* and /map/* — and NOT the site root. A
  // claimed path hands off to the native app, and the app ignores the
  // #zoom/lat/lon fragment: it opens on wherever it was last, not on this spot.
  // The root keeps the link in the browser, which does honour the fragment.
  //
  // A claimed path is only right once it NAMES the spot (/forecast/<slug>).
  // Until then, this guards against quietly handing the rider back to an app
  // that will show them the wrong beach.
  await gotoApp('signedOut');
  const url = await page.evaluate(() => windfinderUrl(51.3627, 3.3062));
  const path = new URL(url).pathname;
  const CLAIMED = ['/forecast/', '/weatherforecast/', '/report/', '/webcams/', '/maps/', '/map/'];
  expect(CLAIMED.some(p => path.startsWith(p)), `${path} hands off to the app`).toBe(false);
  expect(new URL(url).hash).toBe('#13/51.3627/3.3062');
});

test('both open close enough in to see the spot itself', async ({ gotoApp, page }) => {
  // A rider clicking from one spot's day expects to arrive AT that spot. Zoom 9
  // (Windfinder) and 10 (Windguru) were centred correctly but showed a hundred
  // kilometres of coast, so the spot was a pixel among its neighbours. Anything
  // from 12 up is close enough to recognise the beach; the two also stay in
  // step with each other.
  await gotoApp('signedOut');
  const { wf, wg } = await page.evaluate(() => ({
    wf: windfinderUrl(51.3627, 3.3062),
    wg: windguruUrl(51.3627, 3.3062),
  }));
  const wfZoom = Number(new URL(wf).hash.slice(1).split('/')[0]);
  const wgZoom = Number(new URL(wg).searchParams.get('zoom'));
  expect(wfZoom).toBeGreaterThanOrEqual(12);
  expect(wgZoom).toBeGreaterThanOrEqual(12);
  expect(wfZoom).toBe(wgZoom);
});

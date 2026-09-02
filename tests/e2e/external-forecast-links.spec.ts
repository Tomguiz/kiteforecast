import { test, expect } from '../fixtures/auth';

// Riders cross-check against Windfinder and Windguru, and expect to land on the
// spot they clicked from. Two routes, in order:
//
//   1. the provider's own page for this spot, when SPOTS carries a verified id
//      (`wf` slug / `wg` number) — the only form the native apps land on;
//   2. otherwise the provider's map at the spot's coordinates, which is right
//      for every spot but only lands correctly in a browser.
//
// The ids are never derived from the spot name — a guessed slug resolves about
// a third of the time and the misses are silent 404s.

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
  expect(wf).toBe('https://www.windfinder.com/maps/#13/51.3627/3.3062');
  expect(wg).toBe('https://www.windguru.cz/map/spot/?lat=51.3627&lon=3.3062&zoom=13');
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
  expect(r.wf).toBe('https://www.windfinder.com/maps/#13/51.3627/3.3062');
  expect(r.wg).toContain('lat=51.3627&lon=3.3062');
});

test('the coordinate fallback uses a path the iOS app claims', async ({ gotoApp, page }) => {
  // Windfinder's apple-app-site-association claims /forecast/*,
  // /weatherforecast/*, /report/*, /webcams/*, /maps/* and /map/* — and NOT the
  // site root. A root URL cannot hand off to the app at all, however it is
  // opened. The fallback uses /maps/, which is claimed and which a rider on a
  // device confirms lands on the right coast.
  await gotoApp('signedOut');
  const url = await page.evaluate(() => windfinderUrl(51.3627, 3.3062));
  const path = new URL(url).pathname;
  const CLAIMED = ['/forecast/', '/weatherforecast/', '/report/', '/webcams/', '/maps/'];
  expect(CLAIMED.some(p => path.startsWith(p)), `${path} is not a claimed path`).toBe(true);
  expect(path).not.toBe('/');
});

test('the Windguru fallback uses the route that reads lat/lon', async ({ gotoApp, page }) => {
  // The bug this pins: /map?lat=..&lon=.. is not a Windguru route, so the query
  // was dropped and a rider clicking a Belgian spot landed on Windguru's own
  // default spot, in Spain. The routes that read the coordinates are /map/,
  // /map/spot/ and /map/station/ — all with the trailing slash.
  await gotoApp('signedOut');
  const url = await page.evaluate(() => windguruUrl(51.3627, 3.3062));
  const u = new URL(url);
  expect(u.pathname).toMatch(/^\/map\/(spot|station)?\/?$/);
  expect(u.pathname.endsWith('/')).toBe(true);
  expect(u.searchParams.get('lat')).toBe('51.3627');
  expect(u.searchParams.get('lon')).toBe('3.3062');
});

// ── the per-spot route ───────────────────────────────────────────────────────

test('a spot with verified ids goes to the provider\'s own page', async ({ gotoApp, page }) => {
  // Zeebrugge carries both ids. This is the only form the native apps land on:
  // /forecast/<slug> is a claimed path that names one spot, and windguru.cz/<id>
  // is the spot itself. No coordinates, no fragment, nothing for an app to drop.
  await gotoApp('signedOut');
  await openSpot(page, 51.3280, 3.1705);
  const wf = await page.locator('.fg-foot a', { hasText: 'Windfinder' }).getAttribute('href');
  const wg = await page.locator('.fg-foot a', { hasText: 'Windguru' }).getAttribute('href');
  expect(wf).toBe('https://www.windfinder.com/forecast/zeebrugge');
  expect(wg).toBe('https://www.windguru.cz/48332');
});

test('a spot without ids still falls back to the map', async ({ gotoApp, page }) => {
  // Riverwoods has no verified id yet, and most of the catalogue is in the same
  // position. The fallback must stay reachable rather than 404 on a guess.
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  const wf = await page.locator('.fg-foot a', { hasText: 'Windfinder' }).getAttribute('href');
  expect(wf).toBe('https://www.windfinder.com/maps/#13/51.3627/3.3062');
});

test('ids belong to the spot at those exact coordinates', async ({ gotoApp, page }) => {
  // A spot a rider adds through the OSM search can carry a catalogue name from
  // a different coast. Matching on name would hand it that spot's pages; the
  // lookup is on coordinates, so a near-miss gets the map instead.
  await gotoApp('signedOut');
  const urls = await page.evaluate(() => ({
    exact: windfinderUrl(51.3280, 3.1705),
    nearby: windfinderUrl(51.3300, 3.1705),   // 220 m away — not the same spot
  }));
  expect(urls.exact).toBe('https://www.windfinder.com/forecast/zeebrugge');
  expect(urls.nearby).toContain('/maps/#13/');
});

test('every id in the catalogue is well formed', async ({ gotoApp, page }) => {
  // A typo here is a 404 the rider meets, not a test failure, so the shape is
  // checked for the whole catalogue rather than the handful used above.
  await gotoApp('signedOut');
  const bad = await page.evaluate(() => (SPOTS || [])
    .filter(s => s.wf !== undefined || s.wg !== undefined)
    .filter(s => (s.wf !== undefined && !/^[a-z0-9][a-z0-9_-]*$/.test(s.wf))
              || (s.wg !== undefined && !(Number.isInteger(s.wg) && s.wg > 0)))
    .map(s => s.name));
  expect(bad).toEqual([]);
});

// ── the look ─────────────────────────────────────────────────────────────────

test('each link wears its own provider colour and mark', async ({ gotoApp, page }) => {
  // In a footer where every other control is the same slate grey, the colour is
  // what tells the two apart before the label is read. The mark is the
  // provider's own favicon, so it must be their URL and not a copy in this repo.
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  const wf = page.locator('.fg-foot a', { hasText: 'Windfinder' });
  const wg = page.locator('.fg-foot a', { hasText: 'Windguru' });
  await expect(wf).toHaveClass(/fg-ext--wf/);
  await expect(wg).toHaveClass(/fg-ext--wg/);
  const colors = await page.evaluate(() => {
    const pick = (t: string) => [...document.querySelectorAll('.fg-foot a')]
      .find(a => a.textContent!.includes(t))!;
    return { wf: getComputedStyle(pick('Windfinder')).color, wg: getComputedStyle(pick('Windguru')).color };
  });
  expect(colors.wf).toBe('rgb(255, 138, 147)');   // Windfinder red, lightened
  expect(colors.wg).toBe('rgb(143, 176, 238)');   // Windguru blue, lightened
  expect(colors.wf).not.toBe(colors.wg);
  // The marks come from the providers, and stay decorative: an empty alt, so a
  // screen reader reads the label once rather than "image, link, Windfinder".
  await expect(wf.locator('img.fg-ext-ico')).toHaveAttribute('src', /windfinder\.com/);
  await expect(wg.locator('img.fg-ext-ico')).toHaveAttribute('src', /windguru\.cz/);
  await expect(wf.locator('img.fg-ext-ico')).toHaveAttribute('alt', '');
});

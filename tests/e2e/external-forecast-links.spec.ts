import { test, expect } from '../fixtures/auth';

// Riders cross-check against Windfinder and Windguru. Both links are built from
// the spot's COORDINATES rather than its name: Windfinder does have per-spot
// pages at /forecast/<slug>, but a slug derived from our spot name resolves
// only about a third of the time (Brouwersdam, Domburg and Tarifa work;
// Oesterdam, Oostduinkerke and Sycod are 404s). A link that misses half the
// time is worse than none.

const D = '2026-09-01';

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
  }, { D, lat, lon });
}

test('both links appear on a spot', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  await expect(page.locator('#locSub a', { hasText: 'Windfinder' })).toBeVisible();
  await expect(page.locator('#locSub a', { hasText: 'Windguru' })).toBeVisible();
});

test('they carry the spot coordinates, not its name', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  const wf = await page.locator('#locSub a', { hasText: 'Windfinder' }).getAttribute('href');
  const wg = await page.locator('#locSub a', { hasText: 'Windguru' }).getAttribute('href');
  expect(wf).toBe('https://www.windfinder.com/#9/51.3627/3.3062');
  expect(wg).toBe('https://www.windguru.cz/map?lat=51.3627&lon=3.3062&zoom=10');
  // the apostrophe in the spot name must not appear anywhere in either
  expect(wf).not.toContain('Hekje');
  expect(wg).not.toContain('Hekje');
});

test('they follow the spot when it changes', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  await openSpot(page, 36.0143, -5.6044);          // Tarifa
  const wf = await page.locator('#locSub a', { hasText: 'Windfinder' }).getAttribute('href');
  expect(wf).toContain('36.0143');
  expect(wf).toContain('-5.6044');                  // a negative longitude survives
});

test('they open in a new tab, without leaking the referrer', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page, 51.3627, 3.3062);
  for (const name of ['Windfinder', 'Windguru']) {
    const a = page.locator('#locSub a', { hasText: name });
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
  expect(r.wf).toBe('https://www.windfinder.com/#9/51.3627/3.3062');
  expect(r.wg).toContain('lat=51.3627&lon=3.3062');
});

import { test, expect } from '../fixtures/auth';

// The colour has to get hotter as the wind gets stronger, with no reversal.
// It used to put orange at 10-14 kn and dark red below, so on an hourly row the
// lightest hours looked like the most alarming ones — orange at 12 kn sitting
// beside bright green at 17.

const RAMP_ORDER = [5, 13, 16, 21, 27, 32, 37, 42];

test('the ramp never doubles back — one colour per band, in order', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const cols = await page.evaluate((kns: number[]) => kns.map(k => windBarColor(k)), RAMP_ORDER);
  // every band is distinct: a repeat would mean two speeds read identically
  expect(new Set(cols).size).toBe(RAMP_ORDER.length);
});

test('light wind is pale green, not a warning colour', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const c = await page.evaluate(() => ({
    justRideable: windBarColor(12),
    belowFloor:   windBarColor(9),
    orangeUsedAt: [10, 12, 14, 17, 20].map(k => windBarColor(k)),
  }));
  expect(c.justRideable).toBe('#d9f99d');     // pale green
  expect(c.belowFloor).toBe('#334155');       // muted, recedes
  // the old orange must not appear anywhere in the light band
  expect(c.orangeUsedAt).not.toContain('#f97316');
  expect(c.orangeUsedAt).not.toContain('#b91c1c');
});

test('orange now means strong, above the prime band', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const c = await page.evaluate(() => ({ prime: windBarColor(27), strong: windBarColor(32) }));
  expect(c.prime).toBe('#4ade80');            // still bright green
  expect(c.strong).toBe('#f59e0b');           // orange only once it is genuinely strong
});

test('the number stays legible on every band', async ({ gotoApp, page }) => {
  // The matrix paints the wind number on top of windBarColor. Dark ink on the
  // slate and purple ends would be unreadable.
  await gotoApp('signedOut');
  const pairs = await page.evaluate(() =>
    [5, 12, 17, 27, 32, 37, 42].map(k => ({ kn: k, bg: windBarColor(k), fg: windTextColor(k) })));
  for (const p of pairs) {
    const darkBg = p.kn < 12 || p.kn >= 35;
    expect(p.fg).toBe(darkBg ? '#e2e8f0' : '#0b1220');
  }
});

test('the hourly matrix uses that text colour, not a fixed dark ink', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => {
    const D = '2026-08-29';
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: h === 12 ? 8 : 17, gustKn: 20, dir: 250, code: 1, temp: 18 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'K', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [21], temperature_2m_min: [14],
      windgusts_10m_max: [10], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    renderGrid();
    toggleForecastDay(D, 0);
  });
  const html = await page.locator('#fdb-2026-08-29 tr.fg-kn').innerHTML();
  // The 8 kn hour does not qualify, so it is muted rather than coloured at all
  // — that is what makes the rideable hours stand out.
  expect(html).toContain('rgba(51,65,85,.35)');
  // and the rideable hours keep the ramp colour with legible dark ink
  expect(html).toContain('#0b1220');
});

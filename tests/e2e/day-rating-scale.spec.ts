import { test, expect } from '../fixtures/auth';

// The day rating is expert-tuned and reads the AVERAGE wind over a window of
// consecutive good hours: Expert mode 38+, Epic 30+, Very Good 25+, Good 18+,
// Chill 15-18. Each wants 3h+; a 2h window at the same average lands one tier
// lower. The badge gets redder as the wind gets stronger.

const D = ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27'];

async function seed(page: any) {
  await page.evaluate((D: string[]) => {
    const mk = (kns: number[], gust = (k: number) => k + 4, from = 10) => {
      const m = new Map<number, any>();
      kns.forEach((kn, i) => m.set(from + i, { kn, dir: 315, code: 1, gustKn: gust(kn), temp: 18 }));
      return m;
    };
    const map = new Map<string, Map<number, any>>([
      [D[0], mk([32, 33, 31, 30, 34, 32])],         // 6h at ~32 → Epic
      [D[1], mk([40, 40])],                         // 2h at 40 → Expert demoted to Epic
      [D[2], mk([15, 16, 17, 30, 31, 32])],         // light morning, epic afternoon → Epic
      [D[3], mk([16, 17, 16, 17])],                 // 15-18 → Chill
      [D[4], mk([13, 13, 13], () => 22)],           // gust rule only → Light wind
      [D[5], mk([20, 20, 20])],                     // 18+ → Good
      [D[6], mk([39, 38, 40, 38])],                 // 4h at 38+ → Expert mode
      [D[7], (() => {                               // 21-26 all day with an hour lost → Very Good
        const m = mk([18, 21, 21, 24], undefined, 8);
        m.set(12, { kn: 23, dir: 200, code: 1, gustKn: 30, temp: 18 });   // wrong direction
        m.set(13, { kn: 26, dir: 315, code: 1, gustKn: 36, temp: 18 });
        m.set(14, { kn: 25, dir: 315, code: 1, gustKn: 36, temp: 18 });
        return m;
      })()],
    ]);
    // @ts-expect-error app globals — script-level lets, not window props
    cachedHrMap = map;
    // @ts-expect-error app globals
    cachedLoc = { name: 'Test Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    // @ts-expect-error app globals
    cachedWx = { daily: {
      time: D, weather_code: D.map(() => 1),
      temperature_2m_max: D.map(() => 21), temperature_2m_min: D.map(() => 14),
      windgusts_10m_max: D.map(() => 12),
      sunrise: D.map(d => `${d}T06:00`), sunset: D.map(d => `${d}T21:00`),
    } };
    // @ts-expect-error app globals
    windDirs = new Set([315]);
    renderGrid();
  }, D);
}

test('each day carries the tier its window average earns', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);

  const badge = (i: number) => page.locator(`#forecastGrid .fday[data-date="${D[i]}"] .rating-badge`);
  await expect(badge(0)).toHaveText('✅ 6h · Epic');
  await expect(badge(0)).toHaveClass(/rating-epic/);
  await expect(badge(1)).toHaveText('✅ 2h · Epic');           // 38+ but only 2h
  await expect(badge(2)).toHaveText('✅ 6h · Epic');           // the afternoon carries the day
  await expect(badge(3)).toHaveText('✅ 4h · Chill');
  await expect(badge(3)).toHaveClass(/rating-chill/);
  await expect(badge(4)).toHaveText('⚡ 3h · Light wind');
  await expect(badge(5)).toHaveText('✅ 3h · Good');
  await expect(badge(5)).toHaveClass(/rating-good/);
  await expect(badge(6)).toHaveText('✅ 4h · Expert mode');
  await expect(badge(6)).toHaveClass(/rating-expert/);
  // the best three hours (26, 25, 24) average 25, even with a gap between them
  await expect(badge(7)).toHaveText('✅ 6h · Very Good');
  await expect(badge(7)).toHaveClass(/rating-verygood/);
});

test('the badge gets redder as the wind gets stronger', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  const bg = async (i: number) =>
    page.locator(`#forecastGrid .fday[data-date="${D[i]}"] .rating-badge`)
      .evaluate((el: Element) => getComputedStyle(el).backgroundColor);
  const [good, epic, expert] = await Promise.all([bg(5), bg(0), bg(6)]);
  // redness = red minus green: green is negative, orange positive, red most
  const redness = (c: string) => { const [r, g] = c.match(/\d+/g)!.map(Number); return r - g; };
  expect(redness(good)).toBeLessThan(redness(epic));
  expect(redness(epic)).toBeLessThan(redness(expert));
});

test('the day modal shows the real average next to the peak', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  await page.evaluate((d: string) => openModal(d, 2), D[2]);
  await expect(page.locator('#mSession')).toContainText('Best 3h · 31 kn');
  await expect(page.locator('#mSession')).toContainText('Avg 24 kn');
  await expect(page.locator('#mSession')).toContainText('Peak 32 kn');
  await expect(page.locator('#mSession .rating-badge')).toHaveText('✅ 6h · Epic');
});

test('the hourly Conditions column uses the same tiers and colours as the day badge', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  await page.evaluate((d: string) => openModal(d, 2), D[2]);   // 15,16,17 then 30,31,32
  const pills = page.locator('.m-row .c-sp');
  await expect(pills.nth(0)).toHaveText('✓ Chill');
  await expect(pills.nth(0)).toHaveClass(/cond-chill/);
  await expect(pills.nth(3)).toHaveText('⚡ Epic');
  await expect(pills.nth(3)).toHaveClass(/cond-epic/);
  // the hour pill and the day badge at the same tier share one colour
  const pill = await pills.nth(3).evaluate((el: Element) => getComputedStyle(el).backgroundColor);
  const badge = await page.locator('#mSession .rating-badge').evaluate((el: Element) => getComputedStyle(el).backgroundColor);
  expect(pill).toBe(badge);
  await page.evaluate((d: string) => openModal(d, 6), D[6]);   // 39,38,40,38
  await expect(page.locator('.m-row .c-sp').first()).toHaveText('🔥 Expert mode');
});

test('the legend explains the expert scale', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const legend = await page.evaluate(() => buildLegendHTML());
  for (const t of ['Expert mode', 'Epic', 'Very Good', 'Good', 'Chill', 'Bad', 'Danger']) expect(legend).toContain(t);
  expect(legend).toContain('38+ kn avg');
  expect(legend).toContain('30+ kn avg');
  expect(legend).not.toContain('Perfect');
  expect(legend).not.toContain('Marginal');
});

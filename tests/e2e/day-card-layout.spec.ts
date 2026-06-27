import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

function seed16(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    windDirs = new Set([315]);
    const days: string[] = [], codes: number[] = [];
    cachedHrMap = new Map();
    for (let d = 0; d < 16; d++) {
      const dt = new Date(Date.UTC(2026, 5, 27 + d));
      const ds = dt.toISOString().slice(0, 10);
      days.push(ds); codes.push(0);
      const m = new Map<number, any>();
      for (let h = 9; h <= 17; h++) m.set(h, { kn: 18, dir: 315, code: 0, gustKn: 27 });
      cachedHrMap.set(ds, m);
    }
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE', admin1: '' };
    cachedWx = { daily: { time: days, weather_code: codes,
      temperature_2m_max: days.map(() => 22), temperature_2m_min: days.map(() => 15),
      windgusts_10m_max: days.map(() => 13.9),
      sunrise: days.map((d) => `${d}T05:54`), sunset: days.map((d) => `${d}T21:29`) } };
    renderGrid();
  });
}

test('at least 5 full day-cards fit in the strip viewport on mobile', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed16(page);
  const card = page.locator('#tdsCols .tds-day-card').first();
  const box = (await card.boundingBox())!;
  const chart = (await page.locator('#tdsChart').boundingBox())!;
  // read the real flex gap from the rendered CSS so the math can't silently
  // drift from the stylesheet
  const gap = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('tdsCols')!).columnGap) || 0);
  // cards visible = chartWidth / (cardWidth + gap). Must show 5 full cards plus
  // a visible slice of the 6th (Surfr-style), i.e. >= 5.25 on a 390px viewport.
  const visible = chart.width / (box.width + gap);
  expect(visible).toBeGreaterThanOrEqual(5.25);
});

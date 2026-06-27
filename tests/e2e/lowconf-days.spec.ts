import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// Days 11-16 (index >= 10) come from the free GFS model and are low-confidence.
// They are de-emphasised (opacity fade) in BOTH the 16-day strip and the
// forecast grid, via `tds-lowconf` / `day-lowconf` classes, plus a caption.

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
      for (let h = 9; h <= 17; h++) m.set(h, { kn: 18, dir: 315, code: 0, gustKn: 24 });
      cachedHrMap.set(ds, m);
    }
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: days, weather_code: codes,
      temperature_2m_max: days.map(() => 22), temperature_2m_min: days.map(() => 15),
      windgusts_10m_max: days.map(() => 13),
      sunrise: days.map((d) => `${d}T05:54`), sunset: days.map((d) => `${d}T21:29`),
    } };
    renderGrid();
  });
}

test('the 16-day strip fades days 11-16 (index >= 10) only', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed16(page);
  const cards = page.locator('#tdsCols .tds-day-card');
  await expect(cards).toHaveCount(16);
  // day 10 (index 9) is NOT low-conf; day 11 (index 10) IS
  await expect(cards.nth(9)).not.toHaveClass(/tds-lowconf/);
  await expect(cards.nth(10)).toHaveClass(/tds-lowconf/);
  await expect(cards.nth(15)).toHaveClass(/tds-lowconf/);
});

test('the forecast grid fades days 11-16 (index >= 10) only', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed16(page);
  const cards = page.locator('#forecastGrid .day-card');
  await expect(cards).toHaveCount(16);
  await expect(cards.nth(9)).not.toHaveClass(/day-lowconf/);
  await expect(cards.nth(10)).toHaveClass(/day-lowconf/);
});

test('a low-confidence caption appears under the strip header', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed16(page);
  await expect(page.locator('#tenDayStripWrap')).toContainText('lower-confidence outlook');
});

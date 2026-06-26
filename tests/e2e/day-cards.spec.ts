import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('16-day rail renders one day-card per day with min/max, emoji and session glow', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  await page.evaluate(() => {
    // @ts-expect-error app globals
    const w: any = window;
    const D0 = '2026-06-26', D1 = '2026-06-27';

    // Build cachedHrMap: per-day Map(hour -> { kn, dir, code, gustKn })
    // toKnotsR is applied at fetch time, so we set .kn directly in knots.
    const mk = (entries: Array<[number, number, number, number]>) => {
      const m = new Map<number, any>();
      for (const [hr, kn, dir, code] of entries) m.set(hr, { kn, dir, code, gustKn: kn + 4 });
      return m;
    };
    // Day0: windy NW (315°) session 10:00-15:00 at 14-25kn, clear (code 0)
    const day0 = mk([
      [9, 14, 315, 0], [10, 18, 315, 0], [11, 22, 315, 0],
      [12, 25, 315, 0], [13, 23, 315, 0], [14, 16, 315, 0],
    ]);
    // Day1: light 6-9kn, rainy (code 61) — no qualifying session
    const day1 = mk([
      [10, 6, 315, 61], [11, 7, 315, 61], [12, 9, 315, 61], [13, 8, 315, 61],
    ]);

    // The app uses script-level `let` variables (not window properties), so we
    // assign directly to the lexical globals rather than via window.
    // @ts-expect-error app globals — let cachedHrMap is not on window
    cachedHrMap = new Map([[D0, day0], [D1, day1]]);
    // @ts-expect-error app globals — let cachedLoc is not on window
    cachedLoc = { name: 'Test Spot', latitude: 50, longitude: 4, country: 'BE' };
    // @ts-expect-error app globals — let cachedWx is not on window
    cachedWx = {
      daily: {
        time: [D0, D1],
        weather_code: [0, 61],
        temperature_2m_max: [24, 18], temperature_2m_min: [16, 14],
        windgusts_10m_max: [14.4, 6.2], // m/s-ish; only used by removed bars / grid badge
        sunrise: [`${D0}T05:54`, `${D1}T05:54`],
        sunset:  [`${D0}T21:29`, `${D1}T21:29`],
      },
    };

    // windDirs is a Set in this app (see index.html ~line 1676). Include NW (315°)
    // so day0's NW hours qualify.
    // @ts-expect-error app globals — let windDirs is not on window
    if (!(windDirs instanceof Set)) windDirs = new Set();
    // @ts-expect-error app globals
    windDirs.add(315);

    w.renderGrid();
  });

  const cards = page.locator('#tdsCols .tds-day-card');
  await expect(cards).toHaveCount(2);

  // Day 0: sunny session card shows max 25 and the clear emoji, with session glow
  const card0 = cards.nth(0);
  await expect(card0).toHaveClass(/has-session/);
  await expect(card0.locator('.tds-dc-range')).toContainText('25');
  await expect(card0.locator('.tds-dc-wx')).toContainText('☀️');

  // Day 1: light/rainy card — no session glow
  const card1 = cards.nth(1);
  await expect(card1).not.toHaveClass(/has-session/);
});

test('tapping a day-card opens the day modal for that date', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  await page.evaluate(() => {
    // @ts-expect-error app globals
    const w: any = window;
    const D0 = '2026-06-26';
    const day0 = new Map<number, any>();
    [[10, 18], [11, 22], [12, 25], [13, 20]].forEach(([hr, kn]) =>
      day0.set(hr, { kn, dir: 315, code: 0, gustKn: kn + 4 }));

    // @ts-expect-error app globals — let cachedHrMap is not on window
    cachedHrMap = new Map([[D0, day0]]);
    // @ts-expect-error app globals — let cachedLoc is not on window
    cachedLoc = { name: 'Test Spot', latitude: 50, longitude: 4, country: 'BE' };
    // @ts-expect-error app globals — let cachedWx is not on window
    cachedWx = { daily: {
      time: [D0], weather_code: [0],
      temperature_2m_max: [24], temperature_2m_min: [16], windgusts_10m_max: [14.4],
      sunrise: [`${D0}T05:54`], sunset: [`${D0}T21:29`],
    } };
    // @ts-expect-error app globals — let windDirs is not on window
    if (!(windDirs instanceof Set)) windDirs = new Set();
    // @ts-expect-error app globals
    windDirs.add(315);

    // spy on openModal
    w.__openedWith = null;
    const orig = w.openModal;
    w.openModal = (dateStr: string, i: number) => { w.__openedWith = [dateStr, i]; };
    w.__origOpenModal = orig;

    w.renderGrid();
  });

  await page.locator('#tdsCols .tds-day-card').first().click();

  const opened = await page.evaluate(() => (window as any).__openedWith);
  expect(opened).toEqual(['2026-06-26', 0]);
});

import { test, expect } from '../fixtures/auth';

// Step 2: the rider never changes view. Every path that used to open the day
// modal now lands on the day row itself, and confirming a session happens in
// the attend sheet, which already did the whole job — start time, duration,
// confirm, cancel, notify friends.

const D0 = '2026-08-28';
const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(D0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

async function seed(page: any, n = 4) {
  await page.evaluate((dd: string[]) => {
    const hr = new Map();
    dd.forEach(d => {
      const m = new Map();
      for (let h = 0; h < 24; h++) m.set(h, { kn: h >= 10 && h <= 17 ? 20 : 8, gustKn: 25, dir: 250, code: 1, temp: 19 });
      hr.set(d, m);
    });
    cachedHrMap = hr;
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: dd,
      weather_code: dd.map(() => 1),
      temperature_2m_max: dd.map(() => 22),
      temperature_2m_min: dd.map(() => 15),
      windgusts_10m_max: dd.map(() => 25),
      sunrise: dd.map(d => `${d}T06:00`),
      sunset: dd.map(d => `${d}T21:00`),
    } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
  }, days(n));
}

test('nothing in the app opens the day modal any more', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  const calls = await page.evaluate(() => {
    // Count the reachable call sites left in the shipped source.
    const src = document.documentElement.innerHTML;
    return (src.match(/openModal\(/g) || []).length;
  });
  // only its own definition survives; every caller was rehomed
  expect(calls).toBeLessThanOrEqual(1);
  await expect(page.locator('#modalOverlay')).toBeHidden();
});

test('a 16-day strip card opens that day in place', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  const target = days(4)[2];
  await page.locator('#tdsCols .tds-day-card').nth(2).click();
  await expect(page.locator(`#fdb-${target}`)).toBeVisible();
  await expect(page.locator('#modalOverlay')).toBeHidden();
});

test('the day offers the session sheet directly, not a modal', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await seed(page);
  const d = days(1)[0];
  const row = page.locator('#forecastGrid .fday').first();
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await row.locator('.fday-head').click();
  await page.locator('.fg-going').first().click();

  await expect(page.locator('#attendSheet')).toBeVisible();
  await expect(page.locator('#attendStartTime')).toBeVisible();   // it can pick the hour
  await expect(page.locator('#attendDuration')).toBeVisible();    // and the duration
  await expect(page.locator('#modalOverlay')).toBeHidden();
});

test('a free rider is pointed at the upgrade, not left with a dead button', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');                       // signed in, not premium
  await seed(page);
  const row = page.locator('#forecastGrid .fday').first();
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await row.locator('.fday-head').click();
  await page.locator('.fg-going').first().click();
  await expect(page.locator('#attendSheet')).toHaveCount(0);
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('revealForecastDay expands, scrolls and flags the day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page);
  const d = days(4)[3];
  const found = await page.evaluate((d: string) => revealForecastDay(d, 3), d);
  expect(found).toBe(true);
  await expect(page.locator(`#fdb-${d}`)).toBeVisible();
  await expect(page.locator(`.fday[data-date="${d}"]`)).toHaveClass(/fday-flash/);
});

test('revealForecastDay says so when the day is not on screen', async ({ gotoApp, page }) => {
  // Callers fire it from deep links and pending invites, where the grid may not
  // hold that date at all. It must report rather than throw.
  await gotoApp('signedOut');
  await seed(page);
  expect(await page.evaluate(() => revealForecastDay('1999-01-01', 0))).toBe(false);
});

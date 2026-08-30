import { test, expect } from '../fixtures/auth';

// The hourly table is not the same table for every rider: some read direction
// in degrees, some only want the arrow; waves matter on the coast and are noise
// on a lake. The rider picks the rows, and the choice follows them between
// devices via profiles.display_prefs.

const D = '2026-08-28';

async function seedDay(page: any) {
  await page.evaluate((D: string) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: h >= 9 && h <= 17 ? 20 : 8, gustKn: 26, dir: 237, code: 1, temp: 19 });
    cachedHrMap = new Map([[D, m]]);
    cachedMarineHrMap = new Map(Array.from({ length: 24 }, (_, h) =>
      [`${D}T${String(h).padStart(2, '0')}`, { h: 1.2, p: 5, d: 250 }]));
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [22], temperature_2m_min: [15],
      windgusts_10m_max: [26], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
    toggleForecastDay(D, 0);
  }, D);
}

test('defaults show the useful rows and hide the noisy ones', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedDay(page);
  const body = page.locator(`#fdb-${D}`);
  await expect(body.locator('tr.fg-kn')).toHaveCount(1);
  await expect(body.locator('tr.fg-gust')).toHaveCount(1);
  await expect(body.locator('tr.fg-dir')).toHaveCount(1);
  await expect(body.locator('tr.fg-kite')).toHaveCount(1);
  await expect(body.locator('tr.fg-temp')).toHaveCount(1);
  // off by default
  await expect(body.locator('tr.fg-wave')).toHaveCount(0);
  await expect(body.locator('tr.fg-cond')).toHaveCount(0);
  await expect(body.locator('.fg-deg')).toHaveCount(0);
});

test('turning a row on repaints the open day immediately', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedDay(page);
  await page.evaluate(() => openDayPrefs());
  await page.locator('[data-daypref="waves"]').check();
  await expect(page.locator(`#fdb-${D} tr.fg-wave`)).toHaveCount(1);
  await expect(page.locator(`#fdb-${D} tr.fg-wave td`).first()).toHaveText('1.2');
  // and turning it back off removes it again
  await page.locator('[data-daypref="waves"]').uncheck();
  await expect(page.locator(`#fdb-${D} tr.fg-wave`)).toHaveCount(0);
});

test('degrees ride along with the direction row', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedDay(page);
  await page.evaluate(() => openDayPrefs());
  await page.locator('[data-daypref="degrees"]').check();
  await expect(page.locator(`#fdb-${D} .fg-deg`).first()).toHaveText('237°');
});

test('Details widens the table instead of opening another view', async ({ gotoApp, page }) => {
  // "Details" must show the rows the rider hid, not a different set of facts.
  await gotoApp('signedOut');
  await seedDay(page);
  const body = page.locator(`#fdb-${D}`);
  await expect(body.locator('tr.fg-wave')).toHaveCount(0);

  await body.locator('.fg-more').first().click();
  await expect(body.locator('tr.fg-wave')).toHaveCount(1);      // hidden rows appear
  await expect(body.locator('tr.fg-cond')).toHaveCount(1);
  await expect(body.locator('.fd-tides')).toHaveCount(1);       // and the tides strip
  await expect(page.locator('#modalOverlay')).toBeHidden();     // no view change

  await body.locator('.fg-more').first().click();
  await expect(body.locator('tr.fg-wave')).toHaveCount(0);      // and folds back
});

test('the day carries the summary that used to sit in the modal', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedDay(page);
  const summary = page.locator(`#fdb-${D} .fd-summary`).first();
  await expect(summary).toContainText('kn');
  await expect(summary).toContainText('Gusts');
  await expect(summary).toContainText('06:00');   // sunrise
  await expect(summary).toContainText('21:00');   // sunset
});

test('a preference set signed out is kept, and the profile copy wins on sign-in', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedDay(page);
  await page.evaluate(() => { const p = loadDayPrefs(); p.waves = true; p.temp = false; saveDayPrefs(p); });
  expect(await page.evaluate(() => loadDayPrefs())).toMatchObject({ waves: true, temp: false });

  // the server copy replaces it — that is the point of storing it there
  await page.evaluate(() => applyDayPrefsFromProfile({ display_prefs: { waves: false, conditions: true } }));
  const after = await page.evaluate(() => loadDayPrefs());
  expect(after.waves).toBe(false);
  expect(after.conditions).toBe(true);
  expect(after.temp).toBe(true);        // absent from the server blob → back to default
});

test('a blob written before a new toggle existed does not switch it off', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const prefs = await page.evaluate(() => {
    localStorage.setItem('kf_dayPrefs_v1', JSON.stringify({ gusts: false }));   // an old, partial blob
    return loadDayPrefs();
  });
  expect(prefs.gusts).toBe(false);      // what it did say is honoured
  expect(prefs.kite).toBe(true);        // what it did not say falls back to the default
  expect(prefs.dir).toBe(true);
});

test('a signed-in change is written to the profile', async ({ gotoApp, page }) => {
  // The write is fire-and-forget, so wait on the request itself rather than
  // polling a list afterwards. This is the test that caught the real bug: a
  // supabase-js builder is lazy, and without a .then() the upsert was built and
  // never sent — the preference would have stayed on one device forever.
  await gotoApp('premium');
  await seedDay(page);

  const pending = page.waitForRequest(r =>
    r.url().includes('/profiles') &&
    ['POST', 'PATCH'].includes(r.method()) &&
    (r.postData() || '').includes('display_prefs'), { timeout: 10000 });

  await page.evaluate(() => {
    const p = loadDayPrefs();
    p.conditions = true;
    saveDayPrefs(p);
  });

  const req = await pending;
  expect(req.postData()).toContain('"conditions":true');
  expect(req.postData()).toContain('user@test.dev');
});

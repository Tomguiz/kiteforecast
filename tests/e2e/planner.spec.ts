import { test, expect } from '../fixtures/auth';

// The planner asks one question — "where should I drive to ride in the next
// few days?" — and its cost is bounded on purpose: J..J+3 only, car only, and
// the candidate list is cut geographically BEFORE any forecast is fetched.

const withHome = (page: any) => page.evaluate(() => {
  const p = loadProfile();
  p.homeLat = 50.7175; p.homeLon = 4.3978; p.homeLabel = 'Waterloo, Belgique';
  p.weightKg = 80; p.kiteLevel = 'Advanced'; p.powerPref = 'overpowered';
  saveProfile(p);
});

test('the button is on the home screen', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await expect(page.locator('#planBtn')).toBeVisible();
});

test('without a home location it sends you to set one, rather than guessing', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => { const p = loadProfile(); p.homeLat = null; p.homeLon = null; saveProfile(p); });
  await page.locator('#planBtn').click();

  await expect(page.locator('#plannerOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('opens with the rider’s home, the day window and car spelled out', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await withHome(page);
  await page.locator('#planBtn').click();

  const body = page.locator('#plannerBody');
  await expect(body).toContainText('Waterloo');
  // the header names the days actually selected, not the whole window — the
  // default is today + tomorrow
  await expect(body).toContainText('2 days');
  await expect(body).toContainText('by car');
});

test('the shortlist is capped before any forecast is requested', async ({ gotoApp, page }) => {
  // This is the guard that keeps one search from firing 399 requests.
  await gotoApp('signedIn');
  const n = await page.evaluate(async () => {
    await (window as any)._spotsReady;
    return shortlistCandidates(
      SPOTS.map((s: any) => ({ name: s.name, lat: s.lat, lon: s.lon, dirs: s.dirs })),
      { lat: 50.7175, lon: 4.3978 },
      { maxDriveMin: 300, minSeparationKm: 25 }).length;
  });
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(14);
});

test('a failed routing call degrades to estimates instead of failing the search', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.route(/router\.project-osrm\.org/, r => r.abort());
  const res = await page.evaluate(async () => {
    await (window as any)._spotsReady;
    const spots = shortlistCandidates(
      SPOTS.map((s: any) => ({ name: s.name, lat: s.lat, lon: s.lon })),
      { lat: 50.7175, lon: 4.3978 }, { maxDriveMin: 180, minSeparationKm: 25 });
    return await fetchDriveMinutes({ lat: 50.7175, lon: 4.3978 }, spots);
  });
  expect(res.__estimated).toBe(true);
  expect(Object.keys(res).length).toBeGreaterThan(1);   // still answered for every spot
});

test('ranking drops spots with no day worth the drive', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const names = await page.evaluate(() => rankPlan([
    { name: 'calm', lat: 51, lon: 3, driveMin: 40, days: [{ dateStr: 'a', goodHours: 4, peakKn: 11 }] },
    { name: 'windy', lat: 51, lon: 3, driveMin: 40, days: [{ dateStr: 'a', goodHours: 4, peakKn: 26 }] },
  ], { minWindKn: 15, sort: 'best' }).map((s: any) => s.name));
  expect(names).toEqual(['windy']);
});

test('the date window really is capped at four days', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const d = await page.evaluate(() => planDates('2026-08-28', 14));
  expect(d).toHaveLength(4);
  expect(d[3]).toBe('2026-08-31');
});

// ── Choosing the day ───────────────────────────────────────────────────────
//
// "Where should I ride" is normally asked about a day the rider is free, so a
// four-day list buries the answer. Narrowing does NOT save forecast requests —
// one call per spot returns every day — but it narrows the result to what can
// actually be acted on.

const openPlanner = async (page: any) => {
  await page.evaluate(() => {
    const p = loadProfile();
    p.homeLat = 50.7175; p.homeLon = 4.3978; p.homeLabel = 'Waterloo'; saveProfile(p);
    _planState.days = null;              // start from the default each time
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);
};

test('offers exactly the four days the window allows', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openPlanner(page);
  const btns = page.locator('#plannerBody button[onclick^="togglePlanDay"]');
  await expect(btns).toHaveCount(4);
});

test('defaults to today and tomorrow, not the whole window', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openPlanner(page);
  expect(await page.evaluate(() => _planSelectedDays().length)).toBe(2);
});

test('a day can be turned off and the search follows', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openPlanner(page);
  const before = await page.evaluate(() => _planSelectedDays());
  await page.evaluate((d: string) => togglePlanDay(d), before[1]);
  const after = await page.evaluate(() => _planSelectedDays());
  expect(after).toEqual([before[0]]);
});

test('the last selected day cannot be turned off', async ({ gotoApp, page }) => {
  // searching zero days is not a state worth having
  await gotoApp('signedIn');
  await openPlanner(page);
  const after = await page.evaluate(() => {
    const d = _planSelectedDays();
    togglePlanDay(d[1]);                       // down to one
    const one = _planSelectedDays();
    togglePlanDay(one[0]);                     // try to remove the last
    return _planSelectedDays();
  });
  expect(after).toHaveLength(1);
});

test('a day outside the window cannot be smuggled in', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openPlanner(page);
  const got = await page.evaluate(() => {
    _planState.days = ['2027-01-01'];
    return _planSelectedDays();
  });
  const window4 = await page.evaluate(() => planDates(new Date().toISOString().slice(0,10)));
  expect(got.every((d: string) => window4.includes(d))).toBe(true);
});

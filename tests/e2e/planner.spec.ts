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

// The planner is premium. These tests therefore sign in as a premium rider —
// a free one is stopped at the gate, which is what planner-premium-gate.spec.ts
// covers.

test('the button is on the home screen', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await expect(page.locator('#planBtn')).toBeVisible();
});

test('without a home location it sends you to set one, rather than guessing', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => { const p = loadProfile(); p.homeLat = null; p.homeLon = null; saveProfile(p); });
  await page.locator('#planBtn').click();

  await expect(page.locator('#plannerOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('opens with the rider’s home, the day window and car spelled out', async ({ gotoApp, page }) => {
  await gotoApp('premium');
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
  await gotoApp('premium');
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
  await gotoApp('premium');
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
  await gotoApp('premium');
  const names = await page.evaluate(() => rankPlan([
    { name: 'calm', lat: 51, lon: 3, driveMin: 40, days: [{ dateStr: 'a', goodHours: 4, peakKn: 11 }] },
    { name: 'windy', lat: 51, lon: 3, driveMin: 40, days: [{ dateStr: 'a', goodHours: 4, peakKn: 26 }] },
  ], { minWindKn: 15, sort: 'best' }).map((s: any) => s.name));
  expect(names).toEqual(['windy']);
});

test('the date window really is capped at four days', async ({ gotoApp, page }) => {
  await gotoApp('premium');
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
  await gotoApp('premium');
  await openPlanner(page);
  const btns = page.locator('#plannerBody button[onclick^="togglePlanDay"]');
  await expect(btns).toHaveCount(4);
});

test('defaults to today and tomorrow, not the whole window', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await openPlanner(page);
  expect(await page.evaluate(() => _planSelectedDays().length)).toBe(2);
});

test('a day can be turned off and the search follows', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await openPlanner(page);
  const before = await page.evaluate(() => _planSelectedDays());
  await page.evaluate((d: string) => togglePlanDay(d), before[1]);
  const after = await page.evaluate(() => _planSelectedDays());
  expect(after).toEqual([before[0]]);
});

test('the last selected day can be turned off', async ({ gotoApp, page }) => {
  // Zero days is a legitimate mid-choice state. It used to be unreachable:
  // the tap on the last chip was dropped, so the chip looked broken. The
  // "at least one day" rule now lives on the CTA, where it is visible —
  // see 'the last day can be deselected, and the CTA then says why'.
  await gotoApp('premium');
  await openPlanner(page);
  const after = await page.evaluate(() => {
    const d = _planSelectedDays();
    togglePlanDay(d[1]);                       // down to one
    const one = _planSelectedDays();
    togglePlanDay(one[0]);                     // and the last one goes too
    return _planSelectedDays();
  });
  expect(after).toHaveLength(0);
});

test('a day outside the window cannot be smuggled in', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await openPlanner(page);
  const got = await page.evaluate(() => {
    _planState.days = ['2027-01-01'];
    return _planSelectedDays();
  });
  const window4 = await page.evaluate(() => planDates(new Date().toISOString().slice(0,10)));
  expect(got.every((d: string) => window4.includes(d))).toBe(true);
});

// ── Days the rider did not ask for ─────────────────────────────────────────
//
// One request per spot returns the whole window, so a day outside the
// selection has already been paid for. Saying nothing about it wastes
// information the rider would want: "Sunday is better than the day you asked
// about" is exactly the kind of thing a planner exists to say.

test('mentions a good day the rider did not select', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile();
    p.homeLat = 50.7175; p.homeLon = 4.3978; p.homeLabel = 'Waterloo'; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);

  const html = await page.evaluate(() => {
    const days = planDates(new Date().toISOString().slice(0, 10));
    _planState = { maxDriveMin: 180, minWindKn: 15, waterType: '', sort: 'best', days: [days[0]] };
    _planLast = { estimated: false, planned: [{
      name: 'Somewhere', loc: 'BE', lat: 51.3, lon: 3.3, dirs: [270], driveMin: 90,
      days:      [{ dateStr: days[0], goodHours: 3, peakKn: 18 }],
      otherDays: [{ dateStr: days[2], goodHours: 6, peakKn: 27 },
                  { dateStr: days[1], goodHours: 1, peakKn: 30 }],   // too short: not offered
    }] };
    renderPlanResults();
    return document.getElementById('planResults')!.innerHTML;
  });

  expect(html).toContain('also rideable');
  expect(html).toContain('27kn');      // the genuinely good other day
  expect(html).not.toContain('30kn');  // one hour is not a session, whatever the wind
});

test('says nothing about other days when there is nothing to say', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);

  const html = await page.evaluate(() => {
    const days = planDates(new Date().toISOString().slice(0, 10));
    _planState = { maxDriveMin: 180, minWindKn: 15, waterType: '', sort: 'best', days: [days[0]] };
    _planLast = { estimated: false, planned: [{
      name: 'Somewhere', loc: 'BE', lat: 51.3, lon: 3.3, dirs: [270], driveMin: 90,
      days:      [{ dateStr: days[0], goodHours: 4, peakKn: 22 }],
      otherDays: [{ dateStr: days[1], goodHours: 4, peakKn: 9 }],    // below the floor
    }] };
    renderPlanResults();
    return document.getElementById('planResults')!.innerHTML;
  });

  expect(html).not.toContain('also rideable');
});

test('offers another day instead of a dead end', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);

  const html = await page.evaluate(() => {
    const days = planDates(new Date().toISOString().slice(0, 10));
    _planState = { maxDriveMin: 180, minWindKn: 15, waterType: '', sort: 'best', days: [days[0]] };
    _planLast = { estimated: false, planned: [{
      name: 'Somewhere', loc: 'BE', lat: 51.3, lon: 3.3, dirs: [270], driveMin: 90,
      days:      [{ dateStr: days[0], goodHours: 0, peakKn: 6 }],   // flat: nothing today
      otherDays: [{ dateStr: days[2], goodHours: 5, peakKn: 24 }],
    }] };
    renderPlanResults();
    return document.getElementById('planResults')!.innerHTML;
  });

  expect(html).toContain('Nothing rideable');
  expect(html).toContain('But another day works');
  expect(html).toContain('24kn');
  expect(html).toContain('1h30');          // the drive time still has to be shown
});

// ── Timing is a required input, and it should say so ───────────────────────
//
// The last day used to be undeselectable: the tap was ignored, which is
// indistinguishable from a broken button. The selection may now go empty, and
// the CTA carries the rule instead.

test('the last day can be deselected, and the CTA then says why it cannot run', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; p.homeLabel = 'Waterloo'; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);

  const days = await page.evaluate(() => planDates(new Date().toISOString().slice(0, 10)));
  const go = page.locator('#planGoBtn');
  await expect(go).toBeEnabled();

  // Default is today + tomorrow, so clear both.
  await page.evaluate((d) => togglePlanDay(d), days[0]);
  await page.evaluate((d) => togglePlanDay(d), days[1]);

  expect(await page.evaluate(() => _planSelectedDays().length)).toBe(0);
  await expect(go).toBeDisabled();
  await expect(go).toHaveText(/pick a day/i);
  await expect(page.locator('#plannerBody')).toContainText('pick a day');

  // and picking one back brings it to life
  await page.evaluate((d) => togglePlanDay(d), days[2]);
  await expect(go).toBeEnabled();
  await expect(go).toHaveText(/find where to ride/i);
});

test('an empty selection cannot search even if the CTA is forced', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);
  const ran = await page.evaluate(async () => {
    _planState.days = [];
    _planLast = null;
    await runPlanner();
    return _planLast !== null;
  });
  expect(ran).toBe(false);
});

// ── The drive time is a control, not a label ───────────────────────────────

test('the drive time opens directions and does not open the spot', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate(() => {
    const p = loadProfile(); p.homeLat = 50.7175; p.homeLon = 4.3978; saveProfile(p);
  });
  await page.locator('#planBtn').click();
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const days = planDates(new Date().toISOString().slice(0, 10));
    _planState = { maxDriveMin: 180, minWindKn: 15, waterType: '', sort: 'best', days: [days[0]] };
    _planLast = { estimated: false, planned: [{
      name: 'Oesterdam', loc: 'Zeeland', lat: 51.4964, lon: 4.199, dirs: [270], driveMin: 79,
      days: [{ dateStr: days[0], goodHours: 4, peakKn: 20 }], otherDays: [],
    }] };
    renderPlanResults();
  });

  const btn = page.locator('.plan-drive').first();
  await expect(btn).toContainText('1h19');

  const url = await page.evaluate(() => planRouteUrl(51.4964, 4.199));
  expect(url).toContain('origin=50.7175,4.3978');
  expect(url).toContain('destination=51.4964,4.199');
  expect(url).toContain('travelmode=driving');

  // Clicking it must not fall through to the card, which would open the spot.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    btn.click(),
  ]);
  await popup.close();
  await expect(page.locator('#plannerOverlay')).toBeVisible();
});

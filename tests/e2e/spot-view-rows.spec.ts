import { test, expect } from '../fixtures/auth';

// Tall viewport so the day rows sit in view without a scroll. Playwright
// re-scrolls before every click and lands the target under the sticky hero,
// which is an actionability artefact, not something a rider hits: they scroll
// a row into view and click what they can see.
test.use({ viewport: { width: 1280, height: 1400 } });

// The spot view is now: the 16-day strip on top (on every screen), then one
// row per day, and the Windguru-style hourly matrix inside the day you open.
// It replaces a grid of 16 dense cards that showed every day's detail at once.

const D0 = '2026-08-28';
const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(D0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

async function seed(page: any, n = 3) {
  await page.evaluate((dd: string[]) => {
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    const hr = new Map();
    dd.forEach(d => {
      const m = new Map();
      for (let h = 0; h < 24; h++) {
        // a solid rideable afternoon in a steady SW
        const kn = h >= 11 && h <= 18 ? 22 : 8;
        m.set(h, { kn, dir: 240, code: 1, temp: 19, gustKn: kn + 5 });
      }
      hr.set(d, m);
    });
    cachedHrMap = hr;
    cachedWx = { daily: {
      time: dd,
      weather_code: dd.map(() => 1),
      temperature_2m_max: dd.map(() => 24),
      temperature_2m_min: dd.map(() => 15),
      windgusts_10m_max: dd.map(() => 27),
      sunrise: dd.map(d => `${d}T06:00`),
      sunset: dd.map(d => `${d}T21:00`),
    } };
    windDirs = new Set([225, 270]);
    // The kite column is only populated for a rider with a profile — without
    // one, suggestKiteSize correctly returns nothing.
    const pf = loadProfile();
    // The rider's own calibration: a 12 m held from 14 to 22 kn.
    pf.weightKg = 80; pf.kiteLevel = 'Advanced'; pf.powerPref = 'overpowered';
    saveProfile(pf);
    renderGrid();
  }, days(n));
}

test('the day rows replace the card grid, one row per day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  await expect(page.locator('#forecastGrid .fday')).toHaveCount(3);
  await expect(page.locator('#forecastGrid .day-card')).toHaveCount(0);
  // the summary each row carries
  const first = page.locator('#forecastGrid .fday').first();
  await expect(first.locator('.fd-win')).toContainText('11:00');
  await expect(first.locator('.fd-ribbon i')).toHaveCount(16);   // daylight hours 06–21
});

test('the 16-day strip is visible on desktop, not just mobile', async ({ gotoApp, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp('signedOut');
  await seed(page, 3);
  await expect(page.locator('#tenDayStripWrap')).toBeVisible();
  await expect(page.locator('#tdsCols .tds-day-card').first()).toBeVisible();
});

test('opening a day reveals the hourly matrix, and closing it puts it away', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  const row = page.locator('#forecastGrid .fday').first();
  const body = page.locator(`#fdb-${days(1)[0]}`);

  await expect(body).toBeHidden();
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await row.locator('.fday-head').click();
  await expect(body).toBeVisible();
  await expect(row).toHaveClass(/open/);
  await expect(row.locator('.fday-head')).toHaveAttribute('aria-expanded', 'true');

  // the matrix: hours across, parameters down
  await expect(body.locator('table.fg tr')).toHaveCount(7);
  await expect(body.locator('tr.fg-hr td')).toHaveCount(16);
  await expect(body.locator('tr.fg-kn td').nth(11)).toHaveText('22');   // 11:00 is rideable
  await expect(body.locator('tr.fg-kite td').nth(11)).toHaveText('12'); // the rider's 12 m band

  await row.locator('.fday-head').click();
  await expect(body).toBeHidden();
  await expect(row).not.toHaveClass(/open/);
});

test('an open day survives a re-render', async ({ gotoApp, page }) => {
  // renderGrid runs again on refresh and on a "Going" confirmation. Collapsing
  // the rider's open day underneath them would be its own small bug.
  await gotoApp('signedOut');
  await seed(page, 3);
  const d = days(1)[0];
  const r0 = page.locator('#forecastGrid .fday').first();
  await r0.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await r0.locator('.fday-head').click();
  await expect(page.locator(`#fdb-${d}`)).toBeVisible();
  await page.evaluate(() => renderGrid());
  await expect(page.locator(`#fdb-${d}`)).toBeVisible();
  await expect(page.locator('#forecastGrid .fday').first()).toHaveClass(/open/);
});

test('the notification bell does not also open the day', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  const row = page.locator('#forecastGrid .fday').first();
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await row.locator('.card-bell').click();
  await expect(page.locator(`#fdb-${days(1)[0]}`)).toBeHidden();
});

test('the row keeps the going indicator the attendance code writes into', async ({ gotoApp, page }) => {
  // Five call sites do document.getElementById(`going-${date}`) and set
  // textContent / display on it. The redesign must not strand them.
  await gotoApp('signedOut');
  await seed(page, 3);
  const d = days(1)[0];
  const ind = page.locator(`#going-${d}`);
  await expect(ind).toHaveCount(1);
  await expect(ind).toBeHidden();
  await page.evaluate((dd: string) => {
    const el = document.getElementById(`going-${dd}`)!;
    el.style.display = 'block'; el.textContent = '✓ Going · 14:00';
  }, d);
  await expect(ind).toHaveText('✓ Going · 14:00');
});

test('the day reaches session confirmation without leaving the view', async ({ gotoApp, page }) => {
  // Step 2: the modal is gone. Confirming a session happens in the attend
  // sheet, which already did the whole job — start time, duration, confirm,
  // cancel, notify friends — and is now reachable straight from the day.
  await gotoApp('premium');
  await seed(page, 3);
  const r1 = page.locator('#forecastGrid .fday').first();
  await r1.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await r1.locator('.fday-head').click();
  await page.locator('.fg-going').first().click();
  await expect(page.locator('#attendSheet')).toBeVisible();
  await expect(page.locator('#modalOverlay')).toBeHidden();
});

test('a confirmed session can be changed or cancelled from the row', async ({ gotoApp, page }) => {
  // Once "Going" was set there was no way back: the green bar was an inert div,
  // and the sheet that can edit or cancel the session was unreachable from the
  // day row. Tapping the bar now reopens that sheet.
  //
  // The session is seeded through the Supabase mock rather than by poking
  // _attendCache: loadAttendances() rebuilds that cache from the server a
  // moment after load and would wipe anything set by hand.
  const D = '2026-08-28';
  await gotoApp('premium', { sessions: [{
    email: 'test@example.com', spot_name: 'Knokke', session_date: D,
    start_time: '09:00', duration_h: 2,
  }] });
  await page.evaluate((D: string) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: h >= 10 && h <= 18 ? 20 : 8, gustKn: 24, dir: 250, code: 1, temp: 19 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [22], temperature_2m_min: [15],
      windgusts_10m_max: [12], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
  }, D);

  const bar = page.locator(`#going-${D}`);
  await expect(bar).toBeVisible({ timeout: 10000 });
  await bar.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await bar.click();

  await expect(page.locator('#attendSheet')).toBeVisible();
  await expect(page.locator('#attendStartTime')).toHaveValue('09:00');
  // and it must not have toggled the day open underneath
  await expect(page.locator(`#fdb-${D}`)).toBeHidden();
});

test('a row showing only friends is not editable', async ({ gotoApp, page }) => {
  // The same bar carries friends' names, and those are not the rider's to
  // change. What is under test is the handler's guard, not the bar's
  // visibility — and the mock cannot tell "my session" from "a friend's",
  // since both come from session_attendances and it ignores the email filter.
  // So the click is dispatched directly at the element: the real listener runs,
  // without a fight over whether the async repaint has hidden the bar again.
  const D = '2026-08-28';
  await gotoApp('premium');                       // no session of our own
  await page.evaluate((D: string) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: h >= 10 && h <= 18 ? 20 : 8, gustKn: 24, dir: 250, code: 1, temp: 19 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [22], temperature_2m_min: [15],
      windgusts_10m_max: [12], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
  }, D);

  const opened = await page.evaluate((D: string) => {
    delete _attendCache[D];                       // nobody of ours is going
    const el = document.getElementById(`going-${D}`)!;
    el.innerHTML = '\u{1F465} Sam';
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!document.getElementById('attendSheet');
  }, D);
  expect(opened).toBe(false);

  // and the guard is the only thing stopping it: with a session of our own the
  // very same click does open the sheet
  const openedMine = await page.evaluate((D: string) => {
    _attendCache[D] = { session_date: D, start_time: '09:00', duration_h: 2, spot_name: 'Knokke' };
    document.getElementById(`going-${D}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!document.getElementById('attendSheet');
  }, D);
  expect(openedMine).toBe(true);
});

// ── The going button answers the question it asks ──────────────────────────
//
// "🏄 I'm going" was one static green button. It read the same whether the
// rider had committed to 13:00 or had not decided at all, and the only signal
// either way was a separate green bar higher up the row — so the row could
// show "✓ Going · 12:00" while the button under it still invited you to go.
// Green means committed now, and the button says when.

const openFirstDay = async (page: any) => {
  await page.locator('#forecastGrid .fday').first().click();
  await expect(page.locator('#forecastGrid table.fg').first()).toBeVisible();
};

test('undecided, the going button asks rather than claims', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  await openFirstDay(page);
  const btn = page.locator(`#goingBtn-${days(1)[0]}`);
  await expect(btn).toBeVisible();
  await expect(btn).toContainText("I'm going");
  // Green is reserved for a confirmed session — an invitation must not wear it.
  await expect(btn).not.toHaveClass(/fg-going/);
});

test('once confirmed, the same button shows the time and turns green', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  await openFirstDay(page);
  const d = days(1)[0];
  await page.evaluate((dd: string) => {
    _attendCache[dd] = { start_time: '13:00', session_date: dd };
    refreshGoingUI();
  }, d);
  const btn = page.locator(`#goingBtn-${d}`);
  await expect(btn).toContainText('✓ Going · 13:00');
  await expect(btn).toHaveClass(/fg-going/);
  // And the bar above it agrees, rather than being filled by a separate path.
  await expect(page.locator(`#going-${d}`)).toContainText('✓ Going · 13:00');
});

test('cancelling puts the button back to the question', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seed(page, 3);
  await openFirstDay(page);
  const d = days(1)[0];
  await page.evaluate((dd: string) => {
    _attendCache[dd] = { start_time: '13:00', session_date: dd };
    refreshGoingUI();
  }, d);
  await expect(page.locator(`#goingBtn-${d}`)).toHaveClass(/fg-going/);
  await page.evaluate((dd: string) => { delete _attendCache[dd]; refreshGoingUI(); }, d);
  const btn = page.locator(`#goingBtn-${d}`);
  await expect(btn).toContainText("I'm going");
  await expect(btn).not.toHaveClass(/fg-going/);
  await expect(page.locator(`#going-${d}`)).toBeHidden();
});

test('a friend going still shows when the rider has not decided', async ({ gotoApp, page }) => {
  // Cancelling used to hide the whole bar by hand, taking the friends line
  // with it even when a friend was still going.
  await gotoApp('signedOut');
  await seed(page, 3);
  await openFirstDay(page);
  const d = days(1)[0];
  await page.evaluate((dd: string) => {
    _friendsAttendCache[dd] = [{ nickname: 'Ruben' }];
    refreshGoingUI();
  }, d);
  await expect(page.locator(`#going-${d}`)).toContainText('Ruben');
  await expect(page.locator(`#goingBtn-${d}`)).not.toHaveClass(/fg-going/);
});

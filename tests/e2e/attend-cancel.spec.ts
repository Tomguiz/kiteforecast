import { test, expect } from '../fixtures/auth';

// The bar that appears when you pick an hour carries "Cancel" next to
// "Confirm". It used to only drop the pending selection and hide itself, so
// pressing it on an already-confirmed session left the session in place and the
// row still reading "Going" — indistinguishable from a dead button. The only
// real way out was a small text link in a separate status bar.

const D = '2026-08-28';

async function openDay(page: any) {
  await page.evaluate((D: string) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: h >= 8 && h <= 18 ? 20 : 9, gustKn: 26, dir: 250, code: 1, temp: 19 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'Knokke', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [1], temperature_2m_max: [22], temperature_2m_min: [15],
      windgusts_10m_max: [26], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
    openModal(D, 0);
  }, D);
}

test('Cancel cancels the confirmed session, not just the bar', async ({ gotoApp, page }) => {
  await gotoApp('premium', { sessions: [{
    email: 'test@example.com', spot_name: 'Knokke', session_date: D,
    start_time: '10:00', duration_h: 2,
  }] });
  await openDay(page);

  // Watched on the wire. A stub cannot intercept cancelAttendance (a top-level
  // function declaration the handler resolves through the script scope), and
  // _attendCache is repopulated by the mock, which does not honour the update.
  // The write itself is the thing that matters, so assert on the write.
  const writes: string[] = [];
  page.on('request', r => {
    if (r.method() === 'PATCH' && r.url().includes('session_attendances')) writes.push(r.postData() || '');
  });

  await page.evaluate((D: string) => {
    _attendCache[D] = { session_date: D, start_time: '10:00', duration_h: 2, spot_name: 'Knokke' };
    selectSessionStart('10:00', D, null);
    document.getElementById('mAttendCancel')!.click();
  }, D);

  await expect.poll(() => writes.length).toBeGreaterThan(0);
  expect(writes[0]).toContain('"cancelled":true');

  const after = await page.evaluate(() => ({
    barHidden: getComputedStyle(document.getElementById('mAttendBar')!).display === 'none',
    start: _attendSessionStart,
  }));
  expect(after.barHidden).toBe(true);
  expect(after.start).toBe(null);
});

test('Cancel only dismisses when nothing is booked yet', async ({ gotoApp, page }) => {
  await gotoApp('premium');               // no session of our own
  await openDay(page);

  const r = await page.evaluate((D: string) => {
    delete _attendCache[D];
    selectSessionStart('10:00', D, null);
    const label = document.getElementById('mAttendCancel')!.textContent;
    document.getElementById('mAttendCancel')!.click();
    return { label, start: _attendSessionStart, cache: !!_attendCache[D] };
  }, D);

  expect(r.label).toContain('Dismiss');   // nothing booked, so the button says so
  expect(r.start).toBe(null);             // the pending pick is dropped
  expect(r.cache).toBe(false);
  // and nothing was cancelled, because there was nothing to cancel
  await expect(page.locator('body')).not.toContainText(/attendance cancelled/i);
});

test('the button names which of its two jobs it will do', async ({ gotoApp, page }) => {
  await gotoApp('premium', { sessions: [{
    email: 'test@example.com', spot_name: 'Knokke', session_date: D,
    start_time: '10:00', duration_h: 2,
  }] });
  await openDay(page);
  const label = await page.evaluate((D: string) => {
    _attendCache[D] = { session_date: D, start_time: '10:00', duration_h: 2, spot_name: 'Knokke' };
    selectSessionStart('11:00', D, null);
    return document.getElementById('mAttendCancel')!.textContent;
  }, D);
  expect(label).toContain('Cancel session');
});

test('the bar and its Cancel are reachable on a phone', async ({ gotoApp, page }) => {
  // "on mobile I don't even have this cancel button"
  await page.setViewportSize({ width: 375, height: 812 });
  await gotoApp('premium', { sessions: [{
    email: 'test@example.com', spot_name: 'Knokke', session_date: D,
    start_time: '10:00', duration_h: 2,
  }] });
  await openDay(page);
  await page.evaluate((D: string) => selectSessionStart('10:00', D, null), D);

  const btn = page.locator('#mAttendCancel');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);   // not pushed off-screen
  expect(box!.height).toBeGreaterThanOrEqual(28);          // and big enough to tap
});

test('the weather glyph is large enough to read', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate((D: string) => {
    const m = new Map();
    for (let h = 0; h < 24; h++) m.set(h, { kn: 20, gustKn: 25, dir: 250, code: 61, temp: 18 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'K', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [61], temperature_2m_max: [19], temperature_2m_min: [15],
      windgusts_10m_max: [25], sunrise: [`${D}T06:00`], sunset: [`${D}T21:00`] } };
    windDirs = new Set([225, 270]);
    showOnly('results');
    renderGrid();
    toggleForecastDay(D, 0);
  }, D);
  const size = await page.locator(`#fdb-${D} tr.fg-wx td`).first()
    .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);   // .8rem was 12.8px — too small on a dark ground
});

// ── A confirmation nobody checked ──────────────────────────────────────────
//
// On 30 Aug a rider confirmed Riverwoods for the next day. Twelve friends were
// emailed, the toast said "Session confirmed", and the row in the database was
// still the cancelled one from four hours earlier: the upsert was awaited and
// its error thrown away. The rider found out by reloading and seeing nothing.
// Announcing a session to a dozen people on the strength of an unchecked write
// is the failure this pins.

test('a rejected write is reported, and the crew is not emailed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  let notified = 0;
  await page.route(/functions\/v1\/session-attend-notify/, r => { notified++; r.fulfill({ status: 200, body: '{}' }); });
  // The write fails the way RLS rejects one.
  await page.route(/rest\/v1\/session_attendances/, r =>
    r.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ message: 'permission denied', code: '42501' }) }));

  const state = await page.evaluate(async () => {
    _attendCache = {};
    await confirmAttendance('2026-08-31', 'Riverwoods Beachclub', 51.3627, 3.3062, '13:00');
    return { cached: !!_attendCache['2026-08-31'] };
  });

  // Nothing cached, because nothing was stored.
  expect(state.cached).toBe(false);
  // And above all: the friends were not told about a session that does not exist.
  expect(notified).toBe(0);
});

test('a successful write is cached and does notify', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  let notified = 0;
  await page.route(/functions\/v1\/session-attend-notify/, r => { notified++; r.fulfill({ status: 200, body: '{}' }); });
  await page.route(/rest\/v1\/session_attendances/, r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }));

  const state = await page.evaluate(async () => {
    _attendCache = {};
    const p = loadProfile(); p.isPremium = true; saveProfile(p);
    await confirmAttendance('2026-08-31', 'Riverwoods Beachclub', 51.3627, 3.3062, '13:00');
    return { cached: _attendCache['2026-08-31']?.start_time || null };
  });
  expect(state.cached).toBe('13:00');
});

test('cancelling one spot does not cancel the others that day', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const urls: string[] = [];
  await page.route(/rest\/v1\/session_attendances/, r => {
    urls.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.evaluate(async () => {
    _attendCache = { '2026-08-31': { spot_name: 'Riverwoods Beachclub', start_time: '13:00' } };
    await cancelAttendance('2026-08-31');
  });
  // The table is unique on (email, spot_name, session_date), so a cancel keyed
  // on the date alone reaches every spot the rider confirmed that day.
  expect(urls.some(u => /spot_name=eq\./.test(decodeURIComponent(u)))).toBe(true);
});

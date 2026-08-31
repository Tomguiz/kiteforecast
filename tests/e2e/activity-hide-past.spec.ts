import { test, expect } from '../fixtures/auth';

// "Riding soon" was filtered by DATE only, so a session that ended at 17:00 was
// still listed as upcoming at 20:00 — the feed kept announcing something that
// had already happened.

const today = new Date().toISOString().slice(0, 10);
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
// Returns BOTH the date and the time for a moment relative to now. Returning
// only HH:MM and pairing it with today's date breaks either side of midnight:
// at 00:10, "six hours ago" is 18:10 YESTERDAY, and stapling it to today makes
// a finished session look like a future one.
const at = (offsetHours: number) => {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    session_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    start_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

test('a session that has finished is dropped', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    sessions: [
      // started 6h ago, lasted 2h — over
      { email: 'ruben@test.dev', spot_name: 'GoneSpot', ...at(-6), duration_h: 2, cancelled: false },
      // starts in 2h — still ahead
      { email: 'ruben@test.dev', spot_name: 'ComingSpot', ...at(2), duration_h: 3, cancelled: false },
    ],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  const feed = page.locator('#activityFeed');
  await expect(feed).toContainText('ComingSpot', { timeout: 8000 });
  await expect(feed).not.toContainText('GoneSpot');
});

test('a session still running is kept', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    sessions: [
      // started 1h ago, lasts 4h — on the water right now
      { email: 'ruben@test.dev', spot_name: 'OnWaterSpot', ...at(-1), duration_h: 4, cancelled: false },
    ],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  await expect(page.locator('#activityFeed')).toContainText('OnWaterSpot', { timeout: 8000 });
});

test('tomorrow is always kept, yesterday never', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    sessions: [
      { email: 'ruben@test.dev', spot_name: 'TomorrowSpot', session_date: tomorrow, start_time: '06:00', duration_h: 2, cancelled: false },
      { email: 'ruben@test.dev', spot_name: 'YesterdaySpot', session_date: yesterday, start_time: '23:00', duration_h: 5, cancelled: false },
    ],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  const feed = page.locator('#activityFeed');
  await expect(feed).toContainText('TomorrowSpot', { timeout: 8000 });
  await expect(feed).not.toContainText('YesterdaySpot');
});

test('a session with no start time survives its own day', async ({ gotoApp, page }) => {
  // Nothing better to go on than the date, so it should not vanish at midnight
  // past — dropping it early would hide a session that may still happen.
  await gotoApp('signedIn', {
    sessions: [
      { email: 'ruben@test.dev', spot_name: 'NoTimeSpot', session_date: today, start_time: null, cancelled: false },
    ],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  await expect(page.locator('#activityFeed')).toContainText('NoTimeSpot', { timeout: 8000 });
});

test('the predicate is exercised directly at its edges', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const r = await page.evaluate((today: string) => ({
    // ends one minute from now
    endingSoon: _sessionIsOver({ session_date: today, start_time: '00:00', duration_h: 999 }),
    // no date at all — cannot judge, so keep
    noDate: _sessionIsOver({ start_time: '10:00' }),
    // zero duration must not mean "already over the second it starts"
    zeroDuration: _sessionIsOver({ session_date: today, start_time: '23:59', duration_h: 0 }),
  }), today);
  expect(r.endingSoon).toBe(false);
  expect(r.noDate).toBe(false);
  expect(r.zeroDuration).toBe(false);
});

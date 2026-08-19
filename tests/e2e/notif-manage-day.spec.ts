import { test, expect } from '../fixtures/auth';
import { mockSupabase } from '../fixtures/supabase-mock';
import { TEST_EMAIL } from '../fixtures/seed-data';

// The "Manage this alert" button in a reminder email lands here:
//   ?tab=notifs&spot=<spot>&date=<session_date>
// The point of the link is that the user can switch off one day they can't
// make without dropping the spot, so these cover the landing and the opt-out.

const SPOT = 'Test Spot';
const D1 = '2099-03-01';
const D2 = '2099-03-02';

// Two confirmed sessions on the same spot. "Confirmed" means the 72h reminder
// genuinely went out (sent && !skipped) — that is what renderNotifList keys on.
function reminderRows() {
  const rows: unknown[] = [];
  for (const d of [D1, D2]) {
    for (const h of [72, 24, 1]) {
      rows.push({
        spot_name: SPOT, session_date: d, reminder_hours: h,
        sent: h === 72, skipped: false, notif_type: 'spot',
        send_at: `${d}T06:00:00Z`,
      });
    }
  }
  return rows;
}

// NOTE: navigate to '/' and not '/index.html'. The static test server
// (`npx serve --single`) 301s /index.html to /index and drops the query string
// with it, so a deep link asserted against /index.html silently arrives bare.
async function openNotifsDeepLink(page: import('@playwright/test').Page, date: string) {
  await page.evaluate(() => {
    localStorage.setItem('kf_notifs', JSON.stringify([{
      id: 'n1', type: 'spot', spotName: 'Test Spot', spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }]));
  });
  await page.goto(`/?tab=notifs&spot=${encodeURIComponent(SPOT)}&date=${date}`);
}

test('the email link opens the spot card and marks the day the mail was about', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', { reminders: reminderRows() });
  await openNotifsDeepLink(page, D2);

  // Panel opens on Notifications without the user touching anything.
  await expect(page.locator('#ppPanelNotifs')).toBeVisible();

  // The card is expanded — it renders collapsed by default, so this only
  // passes if the deep link opened it.
  const card = page.locator(`.pp-notif-item[data-spot="${SPOT}"]`);
  await expect(card.locator('.pp-notif-body')).toBeVisible();

  // Exactly the mailed day is highlighted, not the spot's other session.
  await expect(page.locator(`.pp-notif-session[data-date="${D2}"]`)).toHaveClass(/pp-notif-day-focus/);
  await expect(page.locator(`.pp-notif-session[data-date="${D1}"]`)).not.toHaveClass(/pp-notif-day-focus/);
});

test('the query string is scrubbed, so a refresh does not re-trigger the deep link', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', { reminders: reminderRows() });
  await openNotifsDeepLink(page, D2);
  await expect(page.locator('#ppPanelNotifs')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('cancelling a day takes two clicks and cancels only that day', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', { reminders: reminderRows() });
  await openNotifsDeepLink(page, D2);

  const btn = page.locator(`.pp-notif-session[data-date="${D2}"] .pp-notif-day-cancel`);
  await expect(btn).toBeVisible();

  // First click arms, it does not fire.
  const patches: string[] = [];
  page.on('request', r => {
    if (r.method() === 'PATCH' && r.url().includes('/reminders')) patches.push(r.url());
  });
  await btn.click();
  await expect(btn).toHaveText('Turn off this day?');
  await page.waitForTimeout(200);
  expect(patches).toHaveLength(0);

  // Second click cancels — scoped to this spot and this date only.
  await btn.click();
  await expect.poll(() => patches.length).toBeGreaterThan(0);
  expect(patches[0]).toContain(`session_date=eq.${D2}`);
  expect(patches[0]).toContain('cancelled=eq.false');
  expect(patches[0]).not.toContain(D1);
});

test('an armed cancel disarms itself rather than staying hot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', { reminders: reminderRows() });
  await openNotifsDeepLink(page, D2);

  const btn = page.locator(`.pp-notif-session[data-date="${D1}"] .pp-notif-day-cancel`);
  await btn.click();
  await expect(btn).toHaveText('Turn off this day?');
  await expect(btn).toHaveText('✕', { timeout: 6000 });
});

test('a link for a spot the user already unfollowed lands without throwing', async ({ page }) => {
  await mockSupabase(page, { email: TEST_EMAIL, reminders: [] });
  await page.addInitScript(() => {
    localStorage.setItem('kf_profile', JSON.stringify({ email: 'test@example.com', nickname: 'Tester' }));
    localStorage.setItem('kf_notifs', JSON.stringify([]));
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?tab=notifs&spot=${encodeURIComponent('Gone Spot')}&date=${D1}`);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

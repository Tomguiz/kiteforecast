import { test, expect } from '../fixtures/auth';

// The Activity tab answers "what is happening". Its hardest constraint is that
// it must not be empty: on the day it was written the whole database held two
// upcoming confirmed sessions, both cancelled, so a friends-only feed would
// have shown nothing to anybody. Hence four sources, the last two of which
// always have something.

const D = new Date().toISOString().slice(0, 10);
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

test('the tab exists and is reachable', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('activity'));
  await expect(page.locator('#ppPanelActivity')).toBeVisible();
});

test('it shows who is riding, and where', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    sessions: [
      { email: 'ruben@test.dev', spot_name: 'Riverwoods', session_date: tomorrow, start_time: '13:00', duration_h: 3, cancelled: false },
      { email: 'user@test.dev', spot_name: 'Oesterdam', session_date: tomorrow, start_time: '10:00', duration_h: 2, cancelled: false },
    ],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  const feed = page.locator('#activityFeed');
  await expect(feed).toContainText('Riding soon', { timeout: 8000 });
  await expect(feed).toContainText('Riverwoods');
  await expect(feed).toContainText('Oesterdam');
  await expect(feed).toContainText('Tomorrow');
  // the rider's own session says "You", a friend's says their name
  await expect(feed).toContainText('You');
  await expect(feed).toContainText('Ruben');
});

test('a pending friend request is actionable from here', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    friendships: [{ id: 'f9', requester: 'ruben@test.dev', recipient: 'user@test.dev', status: 'pending' }],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  const feed = page.locator('#activityFeed');
  await expect(feed).toContainText('Waiting for you', { timeout: 8000 });
  await expect(feed).toContainText('Ruben');
  await expect(feed.locator('button', { hasText: 'Accept' })).toBeVisible();
  await expect(feed.locator('button', { hasText: 'Decline' })).toBeVisible();
});

test('the badge counts only what needs an answer', async ({ gotoApp, page }) => {
  // Sessions and past emails are information, not chores. A badge that counts
  // them never goes away and stops meaning anything.
  await gotoApp('signedIn', {
    friendships: [{ id: 'f9', requester: 'ruben@test.dev', recipient: 'user@test.dev', status: 'pending' }],
    sessions: [{ email: 'ruben@test.dev', spot_name: 'X', session_date: tomorrow, start_time: '10:00', cancelled: false }],
  });
  await page.evaluate(() => openProfilePanel('activity'));
  await expect(page.locator('#activityFeed')).toContainText('Waiting for you', { timeout: 8000 });
  await expect(page.locator('#ppActivityCount')).toHaveText('1');
});

test('it says something useful when there is genuinely nothing', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', { friendships: [], sessions: [] });
  await page.evaluate(() => openProfilePanel('activity'));
  await expect(page.locator('#activityFeed')).toContainText(/Nothing yet|Alerts you will get|Recently sent/, { timeout: 8000 });
});

test('a signed-out visitor is told to sign in, not shown a spinner forever', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => { const el = document.getElementById('activityFeed'); if (el) renderActivity(); });
  await expect(page.locator('#activityFeed')).toContainText('Sign in', { timeout: 6000 });
});

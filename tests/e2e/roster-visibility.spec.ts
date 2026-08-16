import { test, expect } from '../fixtures/auth';

// Two things that were invisible in the UI until now:
//   1. Whether a user is premium (admin Users list) — previously you had to
//      check Stripe to find out.
//   2. Whether a friend has their own "Receive" toggle off, meaning they never
//      get your session alerts however many times you confirm a session.

const usersRpc = [
  { email: 'paid@example.com', created_at: '2026-06-22T10:00:00Z', last_seen_at: '2026-06-24T07:00:00Z',
    nickname: 'Payer', is_premium: true,  fav_count: 3, follow_count: 2 },
  { email: 'free@example.com', created_at: '2026-06-20T09:00:00Z', last_seen_at: '2026-06-23T08:00:00Z',
    nickname: 'Freebie', is_premium: false, fav_count: 0, follow_count: 0 },
];

async function openUsers(page: any) {
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Users');
}

test('admin Users list marks who is premium and who is free', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc });
  await openUsers(page);

  const paid = page.locator('[data-email="paid@example.com"]');
  const free = page.locator('[data-email="free@example.com"]');
  await expect(paid.locator('.pp-user-plan')).toHaveText('PREMIUM');
  await expect(free.locator('.pp-user-plan')).toHaveText('FREE');
});

test('every user card carries a plan badge, so none is ambiguous', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc });
  await openUsers(page);

  await expect(page.locator('#ppAdminUsersContent .pp-user-plan')).toHaveCount(usersRpc.length);
});

test('collapsed user cards show favourite and follow counts', async ({ gotoApp, page }) => {
  // Regression: the detail panel only renders for the EXPANDED user, so every
  // other card looked as though it had no favourites and followed nothing.
  await gotoApp('admin', { usersRpc });
  await openUsers(page);

  await expect(page.locator('[data-email="paid@example.com"]')).toContainText('★ 3');
  await expect(page.locator('[data-email="paid@example.com"]')).toContainText('🔔 2');
  await expect(page.locator('[data-email="free@example.com"]')).toContainText('★ 0');
});

test('treats a missing is_premium as free rather than blank', async ({ gotoApp, page }) => {
  await gotoApp('admin', {
    usersRpc: [{ email: 'old@example.com', created_at: '2026-06-20T09:00:00Z',
                 last_seen_at: null, nickname: 'Legacy' }],
  });
  await openUsers(page);

  await expect(page.locator('[data-email="old@example.com"] .pp-user-plan')).toHaveText('FREE');
});

test('friends list flags a friend who has session alerts turned off', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    friendsNotifRpc: [{ email: 'ruben@test.dev', nickname: 'Ruben', receives: false }],
  });
  await page.evaluate(() => {
    // @ts-expect-error app global
    window._friendsCache = null;
    // @ts-expect-error app global
    openProfilePanel('friends');
  });

  const list = page.locator('#friendsList');
  await expect(list).toContainText('Ruben');
  await expect(list).toContainText('alerts off');
});

test('a friend who does receive alerts is not flagged', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    friendsNotifRpc: [{ email: 'ruben@test.dev', nickname: 'Ruben', receives: true }],
  });
  await page.evaluate(() => {
    // @ts-expect-error app global
    window._friendsCache = null;
    // @ts-expect-error app global
    openProfilePanel('friends');
  });

  const list = page.locator('#friendsList');
  await expect(list).toContainText('Ruben');
  await expect(list).not.toContainText('alerts off');
});

test('an RPC failure leaves the friends list usable rather than blank', async ({ gotoApp, page }) => {
  // friends_notif_status is supplementary — losing it must not cost you the
  // friends list itself.
  await page.route(/.*\/rpc\/friends_notif_status.*/, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    window._friendsCache = null;
    // @ts-expect-error app global
    openProfilePanel('friends');
  });

  await expect(page.locator('#friendsList')).toContainText('Ruben');
});

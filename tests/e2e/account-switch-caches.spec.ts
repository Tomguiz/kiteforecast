import { test, expect } from '../fixtures/auth';

// Reported against a second account: the friends list showed the same person
// several times, while the database held exactly ONE friendship for that
// account.
//
// renderFriendsPanel skips its fetch when _friendsCache is already set, and
// nothing cleared that cache when the signed-in rider changed. So the new
// account was rendered the PREVIOUS rider's rows — and because the "other
// person" in a row is computed against the *current* email, every row the
// previous rider had initiated resolved back to that same previous rider.
// One friendship in the table, the same name repeated on screen.

test('the friends cache does not survive a change of account', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  // Rider A's friendships, as they would sit in memory after opening the panel.
  await page.evaluate(() => {
    _friendsCache = [
      { id: 'a1', requester: 'guiz@x.com', recipient: 'a@x.com', status: 'accepted' },
      { id: 'a2', requester: 'guiz@x.com', recipient: 'b@x.com', status: 'accepted' },
      { id: 'a3', requester: 'guiz@x.com', recipient: 'c@x.com', status: 'accepted' },
    ];
    _attendCache['2026-08-31'] = { session_date: '2026-08-31', start_time: '10:00', spot_name: 'X' };
  });

  // Rider B signs in.
  const after = await page.evaluate(() => {
    clearPerUserCaches();
    return { friends: _friendsCache, attend: Object.keys(_attendCache).length };
  });

  expect(after.friends).toBe(null);   // forces a real fetch for the new rider
  expect(after.attend).toBe(0);       // and B is not shown A's confirmed sessions
});

test('signing out drops the caches with the profile', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    _friendsCache = [{ id: 'x', requester: 'guiz@x.com', recipient: 'a@x.com', status: 'accepted' }];
  });
  await page.evaluate(async () => { await signOut(); });
  expect(await page.evaluate(() => _friendsCache)).toBe(null);
});

test('a stale cache would have rendered one friendship as several people', async ({ gotoApp, page }) => {
  // The shape of the bug, pinned: three rows from the previous rider all
  // resolve to that rider once the current email no longer matches.
  const names = await page.evaluate(() => {
    const email = 'info@pfpclub.com';
    const rows = [
      { requester: 'tom@x.com', recipient: 'a@x.com', status: 'accepted' },
      { requester: 'tom@x.com', recipient: 'b@x.com', status: 'accepted' },
      { requester: 'tom@x.com', recipient: 'c@x.com', status: 'accepted' },
    ];
    return rows.map(r => (r.requester === email ? r.recipient : r.requester));
  });
  expect(names).toEqual(['tom@x.com', 'tom@x.com', 'tom@x.com']);
});

test('the notifications section says what it is for', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => openProfilePanel('notifs'));
  await page.waitForTimeout(400);
  await expect(page.locator('#profileOverlay')).toContainText('Manage notifications');
});

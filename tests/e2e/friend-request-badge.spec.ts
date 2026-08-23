import { test, expect } from '../fixtures/auth';

// An incoming friend request has to be visible without going looking for it.
//
// updateTabBadges() is what queries friendships and lights ppFriendReqCount,
// which feeds the burger dot. Every caller of it used to be a user action —
// openProfilePanel, renderBurgerList, openSection, or editing an alert — so the
// badge was only computed AFTER the user opened the menu it exists to draw them
// to. Nothing queried friendships at page load at all. Eleven real requests sat
// unanswered for two and a half months behind that.
//
// The seeded fixture has one INCOMING pending request (f2, nikite@test.dev).

test.use({ viewport: { width: 390, height: 844 } });

test('friendships are queried at load, before the user opens anything', async ({ gotoApp, page }) => {
  const hits: string[] = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/rest/v1/friendships') && u.includes('status=eq.pending')) hits.push(u);
  });

  await gotoApp('signedIn');
  await expect.poll(() => hits.length, { timeout: 6000 }).toBeGreaterThan(0);

  // and it asks the right question: requests addressed TO me, still pending
  expect(hits[0]).toContain('recipient=eq.');
  expect(hits[0]).toContain('status=eq.pending');
});

test('the burger dot shows the pending request without any interaction', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const dot = page.locator('#burgerDot');
  await expect(dot).toBeVisible({ timeout: 6000 });
  await expect(dot).toHaveText('1');
});

test('a user with nothing pending gets no dot', async ({ gotoApp, page }) => {
  // same signed-in user, but the only friendship is already accepted
  await gotoApp('signedIn', {
    friendships: [{ id: 'f1', requester: 'ruben@test.dev', recipient: 'user@test.dev', status: 'accepted' }],
  });
  await page.waitForTimeout(2500);
  await expect(page.locator('#burgerDot')).toBeHidden();
});

test('a signed-out visitor triggers no friendship lookup', async ({ gotoApp, page }) => {
  const hits: string[] = [];
  page.on('request', r => { if (r.url().includes('/rest/v1/friendships')) hits.push(r.url()); });
  await gotoApp('signedOut');
  await page.waitForTimeout(2500);
  expect(hits).toEqual([]);
});

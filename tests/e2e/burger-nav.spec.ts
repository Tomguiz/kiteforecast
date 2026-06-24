import { test, expect } from '../fixtures/auth';

test('burger menu opens and lists feature sections', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerOverlay')).toBeVisible();
  const list = page.locator('#burgerList');
  await expect(list).toContainText('Notifications');
  await expect(list).toContainText('Stats');
  await expect(list).toContainText('Friends');
});

test('admin sees Admin in the burger menu', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).toContainText('Admin');
});

test('tapping Friends opens the full-screen section with a back arrow', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Friends').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Friends');
  await expect(page.locator('#ppBackBtn')).toBeVisible();
  await expect(page.locator('#friendsList')).toContainText('Ruben');
  // back arrow returns to the burger list
  await page.locator('#ppBackBtn').click();
  await expect(page.locator('#burgerOverlay')).toBeVisible();
});

test('profile bubble opens Profile only (no tab strip, no back arrow)', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Profile');
  await expect(page.locator('#ppBackBtn')).toBeHidden();
  await expect(page.locator('.pp-tab')).toHaveCount(0); // old tab strip gone
});

// An unseen alert mirrors its count onto the profile bubble badge (#profileDot) and,
// once the burger is opened, onto the Notifications ITEM badge inside the list.
test('an unseen alert badges the profile icon', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    localStorage.setItem('kf_notifsSeenAt', '1'); // last seen = epoch ms 1
    const notifs = [{
      id: 'n1', type: 'spot', spotName: 'Test Spot', spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(), // after seenAt
    }];
    localStorage.setItem('kf_notifs', JSON.stringify(notifs));
    // @ts-expect-error app global
    if (typeof updateTabBadges === 'function') updateTabBadges();
  });
  await expect(page.locator('#profileDot')).toHaveText('1');
  await expect(page.locator('#profileDot')).toHaveClass(/visible/);
  // and the Notifications item badge inside the burger
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burger_notifs_badge')).toHaveText('1');
});

// sectionVisible() gates Admin behind loadProfile().isAdmin, and My Spot /
// Contributions behind hidden data carriers — a plain signed-in user sees none.
test('non-admin does not see Admin in the burger', async ({ gotoApp, page }) => {
  await gotoApp('signedIn'); // not admin
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).not.toContainText('Admin');
  // My Spot / Contributions also hidden with no data
  await expect(page.locator('#burgerList')).not.toContainText('My Spot');
  await expect(page.locator('#burgerList')).not.toContainText('Contributions');
});

// Stats isn't gated by sectionVisible, so a signed-out user can open it from the
// burger — but renderStats shows a sign-in prompt instead of session data.
test('opening Stats while signed out shows a sign-in prompt', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Stats').click();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Stats');
  await expect(page.locator('#profileOverlay')).toContainText(/sign in to see your session stats/i);
});

// A notification badges ONLY the bubble it belongs to. Notifs → profile dot;
// friends/contrib/admin → burger dot.
test('an unread alert badges the profile dot but not the burger dot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    localStorage.setItem('kf_notifsSeenAt', '1');
    const notifs = [{
      id: 'n1', type: 'spot', spotName: 'Test Spot', spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }];
    localStorage.setItem('kf_notifs', JSON.stringify(notifs));
    // @ts-expect-error app global
    if (typeof updateTabBadges === 'function') updateTabBadges();
  });
  await expect(page.locator('#profileDot')).toHaveText('1');
  await expect(page.locator('#profileDot')).toHaveClass(/visible/);
  await expect(page.locator('#burgerDot')).not.toHaveClass(/visible/);
});

test('a pending friend request badges the burger dot but not the profile dot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // Simulate the friends badge being set (the real count comes from a mocked
    // Supabase query); drive the carrier span + recompute directly.
    const c = document.getElementById('ppFriendReqCount');
    if (c) { c.textContent = '2'; c.style.display = 'inline'; }
    // @ts-expect-error app global
    if (typeof recomputeProfileBtnBadge === 'function') recomputeProfileBtnBadge();
  });
  await expect(page.locator('#burgerDot')).toHaveText('2');
  await expect(page.locator('#burgerDot')).toHaveClass(/visible/);
  await expect(page.locator('#profileDot')).not.toHaveClass(/visible/);
});

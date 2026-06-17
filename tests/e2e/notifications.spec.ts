import { test, expect } from '../fixtures/auth';

// When a user creates an alert, the Notifications tab + profile bubble show a
// "new" badge; opening the Notifications section clears both.
test('creating an alert badges the tab + bubble, opening notifs clears them', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  // Seed an unseen alert directly via the app's storage + recompute (simulates
  // following a spot: a fresh 'spot' notif created after the last seen time).
  await page.evaluate(() => {
    // ensure "last seen" is in the past so the new alert counts as unseen
    localStorage.setItem('kf_notifsSeenAt', '1');
    const notifs = [{
      id: 'n1', type: 'spot', spotName: 'Test Spot', spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }];
    localStorage.setItem('kf_notifs', JSON.stringify(notifs));
    // @ts-expect-error app global
    if (typeof updateTabBadges === 'function') updateTabBadges();
  });

  // Badge "1" on the Notifications tab and visible on the profile bubble.
  await expect(page.locator('#ppNotifCount')).toHaveText('1');
  await expect(page.locator('#profileDot')).toHaveText('1');
  await expect(page.locator('#profileDot')).toHaveClass(/visible/);

  // Open the Notifications section → both badges clear.
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('notifs');
  });

  await expect(page.locator('#ppNotifCount')).toHaveText('0');
  await expect(page.locator('#ppNotifCount')).toBeHidden();
  await expect(page.locator('#profileDot')).not.toHaveClass(/visible/);
});

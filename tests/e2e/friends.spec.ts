import { test, expect } from '../fixtures/auth';

test('friends panel renders accepted friends and pending requests', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // open profile panel on the friends tab via the app's own function (bare global)
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('friends');
  });
  // accepted friends render in #friendsList
  await expect(page.locator('#friendsList')).toContainText('Ruben');
  // pending incoming requests render in a separate section
  await expect(page.locator('#friendRequestsList')).toContainText('Nikite');
});

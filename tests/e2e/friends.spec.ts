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

test('premium friends show a crown', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('friends');
  });
  const list = page.locator('#friendsList');
  await expect(list).toContainText('Ruben'); // wait for render
  // Ruben is premium → his name carries a crown and a "premium friend" label.
  // Assert against the whole list's text (crown + label both present for Ruben).
  await expect(list).toContainText('👑');
  await expect(list).toContainText('premium friend');
  // The crown sits in the same name div as "Ruben".
  const rubenName = list.locator('div', { hasText: /^Ruben/ }).filter({ hasText: '👑' });
  await expect(rubenName.first()).toBeVisible();
});

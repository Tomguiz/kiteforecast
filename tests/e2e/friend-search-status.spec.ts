import { test, expect } from '../fixtures/auth';
import { TEST_EMAIL } from '../fixtures/seed-data';

// The "✓ Friends" badge in the friend search used to be computed from every
// friendship row involving the caller, whatever its status. A `declined` row —
// which respondFriendRequest leaves in the table — therefore read as a
// friendship: the person showed as "✓ Friends" while being absent from "My
// friends", and no "Add friend" button was ever offered again, so the pair
// could never re-connect. The search badge must agree with the friends list.

// The mock ignores the ilike filter and returns every public profile, so assert
// against the ROW for the person under test, not the whole results container.
function resultRow(page: import('@playwright/test').Page, nickname: string) {
  return page.locator('#friendSearchResults > div').filter({ hasText: nickname });
}

async function openFriendsAndSearch(page: import('@playwright/test').Page, q: string) {
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('friends');
  });
  // let renderFriendsPanel populate _friendsCache before the search reads it
  await expect(page.locator('#friendsList')).not.toContainText('Loading…');
  await page.evaluate((query) => {
    // @ts-expect-error app global
    return doFriendSearch(query);
  }, q);
}

test('a declined friendship offers "Add friend" again, not "✓ Friends"', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    friendships: [{ id: 'f3', requester: 'ruben@test.dev', recipient: TEST_EMAIL, status: 'declined' }],
  });
  await openFriendsAndSearch(page, 'Ruben');

  const row = resultRow(page, 'Ruben');
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText('Friends');
  await expect(row.getByRole('button', { name: 'Add friend' })).toBeVisible();
  // and he is genuinely not a friend
  await expect(page.locator('#friendsList')).toContainText('No friends yet');
});

test('an incoming pending request reads as pending, not as an existing friendship', async ({ gotoApp, page }) => {
  // default seed: Nikite has a pending INCOMING request to the signed-in user
  await gotoApp('signedIn');
  await openFriendsAndSearch(page, 'Nikite');

  const row = resultRow(page, 'Nikite');
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText('✓ Friends');
  await expect(row).toContainText(/pending/i);
  await expect(row.getByRole('button', { name: 'Add friend' })).toHaveCount(0);
});

test('an accepted friendship still reads as "✓ Friends"', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openFriendsAndSearch(page, 'Ruben');
  await expect(resultRow(page, 'Ruben')).toContainText('✓ Friends');
});

import { test, expect } from '../fixtures/auth';

// 28 users and growing, with only a sort control — finding one meant scrolling.
// The search box sits OUTSIDE the list it filters: _renderAdminUsersList
// replaces the whole of ppAdminUsersContent, so an input inside it would be
// destroyed on every keystroke and lose focus mid-word.

const USERS = [
  { email: 'tom.guisgand@gmail.com', nickname: 'Guiz', is_premium: true, created_at: '2026-04-12T00:00:00Z', last_seen_at: '2026-08-31T09:00:00Z', fav_count: 3, follow_count: 1 },
  { email: 'info@pfpclub.com', nickname: 'Pfp', is_premium: false, created_at: '2026-05-31T00:00:00Z', last_seen_at: '2026-08-31T08:00:00Z', fav_count: 1, follow_count: 1 },
  { email: 'lionelconvent@gmail.com', nickname: 'Lionel POWSEY', is_premium: false, created_at: '2026-07-11T00:00:00Z', last_seen_at: '2026-08-30T09:00:00Z', fav_count: 2, follow_count: 0 },
  { email: 'carlvancau@gmail.com', nickname: 'Carl', is_premium: true, created_at: '2026-06-16T00:00:00Z', last_seen_at: '2026-08-29T09:00:00Z', fav_count: 2, follow_count: 0 },
];

async function openUsers(page: any) {
  // Open first and let renderAdminUsers finish its RPC — it assigns _adminUsers
  // from the response, so seeding before would simply be overwritten.
  await page.evaluate(() => openProfilePanel('users'));
  await page.waitForTimeout(600);
  await page.evaluate((users: unknown[]) => {
    _adminUsers = users;
    _adminUsersExpanded = null;
    _renderAdminUsersList();
  }, USERS);
  await page.waitForSelector('.pp-user-email');
}

test('the box filters on nickname', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await expect(page.locator('.pp-user-email')).toHaveCount(4);

  await page.fill('#ppUserSearch', 'lionel');
  await expect(page.locator('.pp-user-email')).toHaveCount(1);
  await expect(page.locator('.pp-user-email').first()).toContainText('Lionel POWSEY');
});

test('and on email', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'pfpclub');
  await expect(page.locator('.pp-user-email')).toHaveCount(1);
  await expect(page.locator('.pp-user-email').first()).toContainText('info@pfpclub.com');
});

test('it ignores case', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'GUIZ');
  await expect(page.locator('.pp-user-email')).toHaveCount(1);
});

test('a filtered list says so, so it is not mistaken for all of them', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'gmail');
  await expect(page.locator('#ppAdminUsersContent')).toContainText('of 4');
});

test('no match says which query found nothing', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'zzzznobody');
  await expect(page.locator('#ppAdminUsersContent')).toContainText('zzzznobody');
  await expect(page.locator('.pp-user-email')).toHaveCount(0);
});

test('clearing the box brings everyone back', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'carl');
  await expect(page.locator('.pp-user-email')).toHaveCount(1);
  await page.fill('#ppUserSearch', '');
  await expect(page.locator('.pp-user-email')).toHaveCount(4);
  await expect(page.locator('#ppAdminUsersContent')).not.toContainText('of 4');
});

test('the box keeps focus while typing', async ({ gotoApp, page }) => {
  // The list is rebuilt on every keystroke. An input inside it would be
  // destroyed and the caret lost after the first letter.
  await gotoApp('admin');
  await openUsers(page);
  const box = page.locator('#ppUserSearch');
  await box.click();
  await page.keyboard.type('lion', { delay: 40 });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('lion');
  await expect(page.locator('.pp-user-email')).toHaveCount(1);
});

test('sorting still works on the filtered set', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await openUsers(page);
  await page.fill('#ppUserSearch', 'gmail');
  const before = await page.locator('.pp-user-email').count();
  await page.locator('#ppUsersSortBar button', { hasText: 'Created' }).click();
  await expect(page.locator('.pp-user-email')).toHaveCount(before);
});

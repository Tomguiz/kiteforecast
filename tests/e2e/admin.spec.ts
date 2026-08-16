import { test, expect } from '../fixtures/auth';
import { adminUserRows, adminFavourites, adminReminders } from '../fixtures/seed-data';

test('admin can open the Admin panel', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('admin');
  });
  await expect(page.locator('#ppAdminContent')).toBeVisible();
});

test('Review & add opens the edit form (regression: apostrophe in name)', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('admin');
  });

  // the suggestion with an apostrophe must render
  await expect(page.getByText("Surfer's Paradise")).toBeVisible();

  // clicking the button must open the edit form (previously a silent no-op)
  await page.getByRole('button', { name: /Review & add/i }).first().click();
  await expect(page.locator('#adminEditForm')).toBeVisible();
});

test('spot requests have a Reject button that updates the suggestion', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('admin');
  });

  await expect(page.getByText("Surfer's Paradise")).toBeVisible();

  // capture the PATCH the reject sends (auto-accept the confirm dialog)
  page.on('dialog', (d) => d.accept());
  const patch = page.waitForRequest((req) =>
    req.url().includes('/rest/v1/spot_suggestions') && req.method() === 'PATCH');

  await page.getByRole('button', { name: /^Reject$/i }).first().click();
  const req = await patch;
  // body marks it reviewed + not approved → requester sees "Declined"
  expect(req.postData() || '').toContain('"reviewed":true');
  expect(req.postData() || '').toContain('"approved":false');
});

test('admin sees Users in the burger menu; non-admin does not', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).toContainText('Users');
});

test('non-admin does not see Users in the burger', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).not.toContainText('Users');
});

test('Users section lists each account with created + last-seen', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Users');
  const content = page.locator('#ppAdminUsersContent');
  await expect(content).toContainText('Users (3)');
  await expect(content).toContainText('newbie@example.com');
  await expect(content).toContainText('alice@example.com');
  // default sort is last activity: alice (seen Jun 23) appears before newbie (never seen → sinks last)
  const text = await content.innerText();
  expect(text.indexOf('alice@example.com')).toBeLessThan(text.indexOf('newbie@example.com'));
  // a user who never logged in shows "never"
  await expect(content).toContainText('never');
});

test('Users section shows empty state when there are no users', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: [] });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppAdminUsersContent')).toContainText('No users');
});

test('Users section shows an error state when the RPC fails', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  // Override just the admin_list_users RPC with a 500 (registered last = wins).
  await page.route(/.*\/rest\/v1\/rpc\/admin_list_users.*/, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) }));
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppAdminUsersContent')).toContainText(/couldn.?t load users/i);
});

test('Users cards show the nickname when present, email-only when null', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');
  // The email LINE (not the whole card) shows "email · nickname" when present.
  await expect(content.locator('[data-email="alice@example.com"] .pp-user-email')).toHaveText('alice@example.com · Alice');
  // newbie has null nickname → email line is the bare email, no separator.
  await expect(content.locator('[data-email="newbie@example.com"] .pp-user-email')).toHaveText('newbie@example.com');
});

test('Users list sorts by last seen (default) then by created, and flips direction', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');

  const order = async () => (await content.innerText());
  // Default: last seen desc → admin (Jun 24) before alice (Jun 23); newbie (null) last.
  let t = await order();
  expect(t.indexOf('admin@test.dev')).toBeLessThan(t.indexOf('alice@example.com'));
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('newbie@example.com'));

  // Sort by Created → newbie (Jun 22) before alice (Jun 20) before admin (Jan 1)
  await content.locator('#ppUsersSortBar [data-sort="created"]').click();
  t = await order();
  expect(t.indexOf('newbie@example.com')).toBeLessThan(t.indexOf('alice@example.com'));
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('admin@test.dev'));

  // Click active Created again → flip to asc → admin (Jan 1) before alice before newbie.
  await content.locator('#ppUsersSortBar [data-sort="created"]').click();
  t = await order();
  expect(t.indexOf('admin@test.dev')).toBeLessThan(t.indexOf('alice@example.com'));
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('newbie@example.com'));
});

test('clicking a user expands their favourites and following spots', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const alice = page.locator('#ppAdminUsersContent [data-email="alice@example.com"]');
  await alice.click();
  const detail = alice.locator('.pp-user-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Favourites (2)');
  await expect(detail).toContainText('Knokke');
  await expect(detail).toContainText('Oostende beach');   // spot_label preferred
  await expect(detail).toContainText('Following (2)');     // 3 reminder rows, Knokke dup → 2 distinct
  await expect(detail).toContainText('De Panne');

  // Clicking again collapses
  await alice.click();
  await expect(detail).toBeHidden();
});

test('expanding a second user collapses the first (accordion)', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');
  const alice = content.locator('[data-email="alice@example.com"]');
  const newbie = content.locator('[data-email="newbie@example.com"]');
  await alice.click();
  await expect(alice.locator('.pp-user-detail')).toBeVisible();
  await newbie.click();
  await expect(alice.locator('.pp-user-detail')).toBeHidden();
  await expect(newbie.locator('.pp-user-detail')).toBeVisible();
});

test('an expanded user stays expanded after re-sorting the list', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');
  const alice = content.locator('[data-email="alice@example.com"]');
  await alice.click();
  await expect(alice.locator('.pp-user-detail')).toBeVisible();
  // Re-sort the list while alice is open — her card must stay expanded.
  await content.locator('#ppUsersSortBar [data-sort="seen"]').click();
  await expect(content.locator('[data-email="alice@example.com"] .pp-user-detail')).toBeVisible();
  await expect(content.locator('[data-email="alice@example.com"] .pp-user-detail')).toContainText('Favourites (2)');
});

test('a user with no favourites or follows shows empty states', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const newbie = page.locator('#ppAdminUsersContent [data-email="newbie@example.com"]');
  await newbie.click();
  const detail = newbie.locator('.pp-user-detail');
  await expect(detail).toContainText('No favourites');
  await expect(detail).toContainText('Not following any spots');
});

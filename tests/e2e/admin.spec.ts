import { test, expect } from '../fixtures/auth';
import { adminUserRows } from '../fixtures/seed-data';

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
  // newest signup first: newbie (Jun 22) appears before alice (Jun 20)
  const text = await content.innerText();
  expect(text.indexOf('newbie@example.com')).toBeLessThan(text.indexOf('alice@example.com'));
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

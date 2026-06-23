import { test, expect } from '../fixtures/auth';

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

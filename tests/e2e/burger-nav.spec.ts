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

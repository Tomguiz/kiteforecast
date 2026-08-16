import { test, expect } from '../fixtures/auth';

// The "* required" hint next to the NICKNAME label should only show while the
// field is empty — once there's a value (typed or already-saved), it hides.

test.use({ viewport: { width: 390, height: 844 } });

async function openProfile(page: any) {
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel('profile');
  });
  await page.waitForTimeout(150);
}

test('hint is hidden when a saved nickname pre-fills the field', async ({ gotoApp, page }) => {
  await gotoApp('signedIn'); // profileSeed → nickname "Tester"
  await openProfile(page);

  await expect(page.locator('#ppNicknameInput')).toHaveValue('Tester');
  await expect(page.locator('#ppNicknameReq')).toBeHidden();
});

test('hint shows when the field is empty and hides once a value is typed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openProfile(page);

  const input = page.locator('#ppNicknameInput');
  const req = page.locator('#ppNicknameReq');

  // Clear the field → hint appears.
  await input.fill('');
  await input.dispatchEvent('input');
  await expect(req).toBeVisible();

  // Type a value → hint hides.
  await input.fill('Guiz');
  await input.dispatchEvent('input');
  await expect(req).toBeHidden();

  // Whitespace-only counts as empty → hint reappears.
  await input.fill('   ');
  await input.dispatchEvent('input');
  await expect(req).toBeVisible();
});

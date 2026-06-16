import { test, expect } from '../fixtures/auth';

test('signed-out users see a sign-in call to action', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // profile button is present and NOT in the logged-in state
  const btn = page.locator('#profileBtn');
  await expect(btn).toBeVisible();
  await expect(btn).not.toHaveClass(/logged-in/);
  // opening the panel reveals the passwordless sign-in copy
  await page.evaluate(() => {
    // @ts-expect-error app global
    if (typeof openProfilePanel === 'function') openProfilePanel();
  });
  await expect(page.getByText(/no password/i).first()).toBeVisible();
});

test('seeded session is treated as signed in', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // The optimistic boot sets _authSession from kf_profile; assert via app state.
  // App globals are top-level consts in a non-module <script>; visible as bare
  // names inside page scope, but NOT on window. Reference them bare.
  const email = await page.evaluate(() => {
    // @ts-expect-error app global
    return typeof _authSession !== 'undefined' ? (_authSession?.user?.email ?? null) : null;
  });
  expect(email).toBe('user@test.dev');
});

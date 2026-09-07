import { test, expect } from '../fixtures/auth';

// The home screen told a new rider "Get started in 3 steps" and then did
// nothing to help: only the first card was tappable, no card ever showed as
// done, and the whole block vanished the moment a favourite existed, alerts
// on or not. It is a checklist now. Every step is a button that performs the
// step, done steps are ticked, the next one is highlighted, and it stays
// until all three are done (or the rider hides it).

const RW = { name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062, dirs: [270, 315] };

const steps = (page: any) => page.locator('#hintSteps .hint-step');

async function rerender(page: any, fn: string) {
  await page.evaluate(async (f: string) => {
    await (window as any)._spotsReady;
    // eslint-disable-next-line no-new-func
    new Function(f)();
    renderHintChips();
  }, fn);
  await page.waitForTimeout(200);
}

test('a signed-out rider sees three open steps, the first marked next', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.waitForTimeout(600);
  await expect(page.locator('#hintSteps')).toBeVisible();
  await expect(page.locator('.hint-steps-title')).toHaveText('Get started in 3 steps');
  await expect(steps(page)).toHaveCount(3);
  await expect(steps(page).nth(0)).toHaveClass(/next/);
  for (let i = 0; i < 3; i++) await expect(steps(page).nth(i)).not.toHaveClass(/done/);
  // step 2 asks the guest to sign in; it is not a dead card any more
  await expect(steps(page).nth(1)).toContainText('Sign in');
});

test('for a guest, the favourite and alert steps open the sign-in panel with the matching pitch', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.waitForTimeout(600);
  await steps(page).nth(1).click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppSignInContext')).toContainText('Save your go-to spots');
  await page.evaluate(() => closeProfilePanel());

  await steps(page).nth(2).click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppSignInContext')).toContainText('Never miss a session');
});

test('the first step focuses the search box', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.waitForTimeout(600);
  await steps(page).nth(0).click();
  await expect(page.locator('#searchInput')).toBeFocused();
});

test('a signed-in rider who looked at a spot has step 1 ticked and step 2 next, worded for a member', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await rerender(page, `saveRecent([${JSON.stringify(RW)}])`);
  await expect(page.locator('.hint-steps-title')).toHaveText('2 steps left');
  await expect(steps(page).nth(0)).toHaveClass(/done/);
  await expect(steps(page).nth(1)).toHaveClass(/next/);
  await expect(steps(page).nth(1)).not.toContainText('Sign in');
  await expect(steps(page).nth(1)).toContainText('tap ★');
});

test('with a favourite saved but no alert, only the alert step is left, beside the favourite card', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await rerender(page, `saveFavs([${JSON.stringify(RW)}])`);
  await expect(page.locator('#hintSteps')).toBeVisible();
  await expect(page.locator('.hint-steps-title')).toHaveText('1 step left');
  await expect(steps(page).nth(0)).toHaveClass(/done/);
  await expect(steps(page).nth(1)).toHaveClass(/done/);
  await expect(steps(page).nth(2)).toHaveClass(/next/);
  await expect(page.locator('.fav-card')).toHaveCount(1);
});

test('once a spot alert is on, the checklist is gone', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await rerender(page, `saveFavs([${JSON.stringify(RW)}]); saveNotifs([{type:'spot',spotName:'Riverwoods Beachclub',lat:51.3627,lon:3.3062}])`);
  await expect(page.locator('#hintSteps')).toBeHidden();
});

test('hiding the checklist sticks across re-renders', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.waitForTimeout(600);
  await page.locator('.hint-steps-dismiss').click();
  await expect(page.locator('#hintSteps')).toBeHidden();
  await rerender(page, '');
  await expect(page.locator('#hintSteps')).toBeHidden();
});

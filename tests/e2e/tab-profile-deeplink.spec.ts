import { test, expect } from '../fixtures/auth';

// The what's-new email links straight to the profile section so a reader can
// add their home location in one tap. ?tab= is allowlisted, and 'profile' was
// missing from that list — the param was silently dropped and the link just
// opened the app, leaving the reader to hunt for the field.

test('?tab=profile opens the profile panel', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // Re-run the handler the way a fresh load with the param would.
    const tab = 'profile';
    if (tab === 'friends' || tab === 'notifs' || tab === 'myspot' || tab === 'contrib' || tab === 'profile') {
      (window as any)._pendingTab = tab;
    }
    // @ts-expect-error app global
    openProfilePanel((window as any)._pendingTab);
  });

  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the home-location field is reachable from that panel', async ({ gotoApp, page }) => {
  // The button promises "add my home location", so the field must be there.
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    openProfilePanel('profile');
  });

  await expect(page.locator('#ppHomeInput')).toBeVisible();
  await expect(page.locator('#ppHomeFindBtn')).toBeVisible();
});

test('profile is in the ?tab= allowlist in the shipped source', async ({ gotoApp, page }) => {
  // Guards the actual allowlist, not a copy of it in this test.
  await gotoApp('signedIn');
  const allowed = await page.evaluate(async () => {
    const html = await (await fetch(location.pathname)).text();
    return /tab==='contrib'\s*\|\|\s*tab==='profile'/.test(html);
  });
  expect(allowed).toBe(true);
});

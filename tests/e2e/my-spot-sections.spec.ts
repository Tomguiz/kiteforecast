import { test, expect } from '../fixtures/auth';

// The My Spot panel stacks three unrelated things: spots you REQUESTED (and got
// approved), a claim offer for whatever spot you currently have open, and your
// other claims. With no heading between them, the claim offer read as something
// you had done — a user asked why they "had a claim on Riverwoods" when
// spot_claims was empty for their account. Each block now names itself.

async function openMySpot(page: any) {
  await page.evaluate(() => {
    // @ts-expect-error app global
    openProfilePanel('myspot');
    // @ts-expect-error app global
    return renderMySpot();
  });
}

test('the claim offer is headed separately from requested spots', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // The claim offer targets the CURRENT spot. `cachedLoc` is declared with
    // `let` at script scope, so assign the binding directly — `window.cachedLoc`
    // would create a separate property the app never reads.
    // @ts-expect-error app global
    cachedLoc = { name: 'Riverwoods Beachclub', lat: 51.36, lon: 3.30 };
    // @ts-expect-error app global
    window.getSb = () => ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }),
                                                   order: async () => ({ data: [], error: null }) }) }) }),
    });
  });
  await openMySpot(page);

  const el = page.locator('#ppMySpotContent');
  await expect(el).toContainText('Own or manage a spot?');
  await expect(el).toContainText('Riverwoods Beachclub');
});

test('says plainly that the spot shown is the one currently open', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    cachedLoc = { name: 'Riverwoods Beachclub', lat: 51.36, lon: 3.30 };
    // @ts-expect-error app global
    window.getSb = () => ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }),
                                                   order: async () => ({ data: [], error: null }) }) }) }),
    });
  });
  await openMySpot(page);

  await expect(page.locator('#ppMySpotContent')).toContainText('the spot you have open right now');
});

test('with no spot open it explains what to do instead of naming nothing', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    cachedLoc = null;
    // @ts-expect-error app global
    window.getSb = () => ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }),
                                                   order: async () => ({ data: [], error: null }) }) }) }),
    });
  });
  await openMySpot(page);

  const el = page.locator('#ppMySpotContent');
  await expect(el).toContainText('Own or manage a spot?');
  await expect(el).toContainText("Open that spot's forecast page first");
  // Regression: `spotName` falling back to '' used to render a bare "🏴 Claim".
  await expect(el).not.toContainText('🏴 Claim');
});

test('escapes the current spot name rather than injecting it as HTML', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // @ts-expect-error app global
    cachedLoc = { name: '<img src=x onerror=alert(1)>', lat: 1, lon: 1 };
    // @ts-expect-error app global
    window.getSb = () => ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }),
                                                   order: async () => ({ data: [], error: null }) }) }) }),
    });
  });
  await openMySpot(page);

  const el = page.locator('#ppMySpotContent');
  await expect(el).toContainText('<img src=x');
  expect(await el.locator('img').count()).toBe(0);
});

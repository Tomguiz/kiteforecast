import { test, expect } from '../fixtures/auth';

// The admin edit form renders its wind-direction toggles from the spot being
// edited. dirs live in spot_overrides, never in spot_info, and the loaders
// copied across lat/lon/loc but dropped dirs — so every spot opened with every
// direction unselected.
//
// That is not cosmetic. Saving requires at least one direction (see
// wind-dirs-required.spec.ts) and writes spot_overrides.dirs unconditionally,
// so an admin fixing a typo in the description was forced to re-pick the
// directions from scratch, silently replacing the spot's real ones. Sycod lost
// its NW that way.
//
// These drive renderAdminPanel — the loader that actually does the annotating.
// Building _adminSpots by hand would put dirs on the row itself and test
// nothing (that version passed against the unfixed code).

const BELGIAN = [0, 45, 225, 270, 315];   // N NE SW W NW

const OPTS = {
  spotInfo: { spot_name: 'Sycod', verified: true, description: 'before' },
  overrides: [{ name: 'Sycod', lat: 51.34, lon: 2.67, loc: 'Koksijde, BE', dirs: BELGIAN }],
};

async function loadAdmin(page: any) {
  await page.evaluate(() => openProfilePanel('admin'));
  // _adminSpots is a script-scope `let`, so it is NOT a window property —
  // reference the binding directly, the way my-spot-sections.spec.ts does for
  // cachedLoc. `window._adminSpots` would just be undefined forever.
  await page.waitForFunction(() =>
    typeof _adminSpots !== 'undefined' && Array.isArray(_adminSpots) && _adminSpots.length > 0);
}

test('the loader carries dirs from spot_overrides onto the spot_info row', async ({ gotoApp, page }) => {
  await gotoApp('admin', OPTS);
  await loadAdmin(page);
  expect(await page.evaluate(() => _adminSpots[0].dirs)).toEqual(BELGIAN);
});

test('the spot’s current directions come up already selected', async ({ gotoApp, page }) => {
  await gotoApp('admin', OPTS);
  await loadAdmin(page);
  await page.evaluate(async () => { await adminOpenSpot('Sycod', null); });

  const active = await page.evaluate(() =>
    [...document.querySelectorAll('#adDirBtns .s-btn.active')]
      .map(b => +(b as HTMLElement).dataset.deg!).sort((a, b) => a - b));
  expect(active).toEqual(BELGIAN);
});

test('the directions NOT on the spot stay unselected', async ({ gotoApp, page }) => {
  await gotoApp('admin', OPTS);
  await loadAdmin(page);
  await page.evaluate(async () => { await adminOpenSpot('Sycod', null); });

  const inactive = await page.evaluate(() =>
    [...document.querySelectorAll('#adDirBtns .s-btn:not(.active)')]
      .map(b => +(b as HTMLElement).dataset.deg!).sort((a, b) => a - b));
  expect(inactive).toEqual([90, 135, 180]);   // E SE S
});

test('editing an unrelated field saves the directions back unchanged', async ({ gotoApp, page }) => {
  await gotoApp('admin', OPTS);
  await loadAdmin(page);
  await page.evaluate(async () => { await adminOpenSpot('Sycod', null); });

  const sent = page.waitForRequest(r =>
    r.url().includes('spot_overrides') && r.method() !== 'GET' && (r.postData() || '').includes('dirs'));
  await page.evaluate(() => {
    (document.getElementById('adDesc') as HTMLTextAreaElement).value = 'typo fixed';
    return adminSaveSpotInfo();
  });

  const payload = JSON.parse((await sent).postData() || '{}');
  const row = Array.isArray(payload) ? payload[0] : payload;
  expect(row.dirs).toEqual(BELGIAN);
});

test('a spot with no override row still opens, with nothing selected', async ({ gotoApp, page }) => {
  await gotoApp('admin', { spotInfo: { spot_name: 'No Override', verified: true }, overrides: [] });
  await loadAdmin(page);
  await page.evaluate(async () => { await adminOpenSpot('No Override', null); });

  expect(await page.locator('#adDirBtns .s-btn.active').count()).toBe(0);
  expect(await page.locator('#adDirBtns .s-btn').count()).toBe(8);
});

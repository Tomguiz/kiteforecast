import { test, expect } from '../fixtures/auth';

// Two behaviours around the "Good wind dirs" section:
//  1. FEATURE: an "Edit for all" affordance in the wind-dir section opens the
//     community "Suggest an update" panel (all signed-in users).
//  2. BUG FIX: when an admin approves a wind-direction update for a BUILT-IN
//     spot that has no spot_overrides row yet, the upsert must include the
//     spot's loc/lat/lon — those columns are NOT NULL, so without them the
//     insert was silently rejected and the approved dirs never reached anyone.

test.use({ viewport: { width: 390, height: 844 } });

test('the wind-dir section has an "Edit for all" button that opens the suggest panel', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  // The button lives in the relocated wind-dir panel.
  const btn = page.locator('.lwd-edit-all');
  await expect(btn).toHaveCount(1);
  await expect(btn).toContainText(/edit for all/i);

  // The wind-dir section lives inside #results (hidden until a forecast loads)
  // and, on mobile, behind a collapsed panel. Reveal both the way the app does
  // when a spot is open, then click the button as a user would.
  await page.evaluate(() => {
    cachedLoc = { name: 'Oostduinkerke', latitude: 51.142, longitude: 2.6976, country: 'BE' };
    (document.getElementById('results') as HTMLElement).style.display = 'block';
    document.getElementById('lwdPanel')?.classList.add('open');
  });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#suggestUpdateOverlay')).toBeVisible();
  // The panel pre-renders the wind-direction toggles.
  await expect(page.locator('#suDirBtns .s-btn')).toHaveCount(8);
});

test('approving a dir update for a built-in spot upserts spot_overrides WITH coords', async ({ gotoApp, page }) => {
  await gotoApp('admin');

  // Capture the spot_overrides write the approve handler sends.
  let overrideBody: any = null;
  await page.route(/.*\.supabase\.co\/rest\/v1\/spot_overrides.*/, (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      try { overrideBody = JSON.parse(req.postData() || 'null'); } catch { overrideBody = req.postData(); }
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.waitForTimeout(200);

  // Drive the exact approve path for a built-in spot (Oostduinkerke exists in
  // the SPOTS catalog with coords but has no override row).
  await page.evaluate(async () => {
    const u = {
      id: 'test-sugg-1',
      spot_name: 'Oostduinkerke',
      suggested_dirs: [0, 45, 225, 270, 315],
      email: 'contributor@example.com',
    };
    // @ts-expect-error app global
    await adminApplyUpdate(u);
  });

  // The upsert body may be a single object or an array of one.
  const row = Array.isArray(overrideBody) ? overrideBody[0] : overrideBody;
  expect(row, 'spot_overrides upsert must have been sent').toBeTruthy();
  expect(row.name).toBe('Oostduinkerke');
  expect(row.dirs).toEqual([0, 45, 225, 270, 315]);
  // The regression: these NOT NULL columns must be present so the INSERT succeeds.
  expect(row.lat).toBeCloseTo(51.142, 3);
  expect(row.lon).toBeCloseTo(2.6976, 3);
  expect(typeof row.loc).toBe('string');
});

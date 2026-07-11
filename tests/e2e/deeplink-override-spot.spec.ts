import { test, expect } from '../fixtures/auth';

// Regression: a shared link (?spot=<name>&share=1) to an ADMIN-ADDED spot
// (one that lives in spot_overrides, not the built-in SPOTS catalog) crashed
// with "Forecast unavailable — Cannot read properties of null (reading
// 'toFixed')". Cause: the deep-link handler ran SPOTS.find() synchronously at
// load, BEFORE spot_overrides had been merged into SPOTS asynchronously, so it
// fell back to {lat:null, lon:null} and the forecast render blew up on null
// coords. The handler must await window._spotsReady before resolving.

test.use({ viewport: { width: 390, height: 844 } });

// A spot that only exists as an override (mirrors "Sycod").
const SYCOD = { name: 'Sycod', loc: 'Koksijde, Belgium', lat: 51.135522, lon: 2.6784694, dirs: [270, 315], active: true };

test('after overrides load, an override-only spot is resolvable with real coords', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', { overrides: [SYCOD] });

  const resolved = await page.evaluate(async () => {
    await window._spotsReady;                       // the fix: handler awaits this
    const found = SPOTS.find((s: any) => s.name.toLowerCase() === 'sycod');
    return found ? { name: found.name, lat: found.lat, lon: found.lon } : null;
  });

  expect(resolved, 'Sycod must be found in SPOTS after overrides load').toBeTruthy();
  expect(resolved!.lat).toBeCloseTo(51.135522, 4);   // never null
  expect(resolved!.lon).toBeCloseTo(2.6784694, 4);
});

test('the deep-link handler resolves an override spot with real coords (never null)', async ({ gotoApp, page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await gotoApp('signedOut', { overrides: [SYCOD] });

  // Force the exact race the bug was about: the override ISN'T in SPOTS yet when
  // the handler is called, and only merges after _spotsReady resolves. A handler
  // that doesn't await _spotsReady (the bug) resolves to a null-coord fallback;
  // the fixed handler waits and resolves Sycod's real coords.
  await page.evaluate(() => {
    const real = (window as any).pickSpot;
    (window as any).__picked = null;
    (window as any).pickSpot = (s: any) => { (window as any).__picked = { name: s?.name, lat: s?.lat, lon: s?.lon }; return real(s); };

    // Remove Sycod from SPOTS and gate its re-addition behind a fresh _spotsReady.
    // SPOTS is a module-scope global (referenced bare, not via window).
    const arr = SPOTS as any[];
    const idx = arr.findIndex((s: any) => s.name === 'Sycod');
    const sycod = idx >= 0 ? arr.splice(idx, 1)[0] : { name: 'Sycod', loc: 'Koksijde, Belgium', lat: 51.135522, lon: 2.6784694, dirs: [270, 315] };
    let resolve: any;
    (window as any)._spotsReady = new Promise((r) => { resolve = r; });
    // Merge the override ~150ms later — after the handler has already been called.
    setTimeout(() => { arr.push(sycod); resolve(); }, 150);
  });

  // Call the real handler NOW, while Sycod is absent from SPOTS.
  await page.evaluate(async () => {
    // @ts-expect-error app global
    await handleSpotDeepLink('Sycod', null);
  });

  // pickSpot must have received Sycod with its REAL coords — never null. The
  // buggy synchronous handler would have passed {lat:null, lon:null} here.
  const picked = await page.evaluate(() => (window as any).__picked);
  expect(picked, 'handler must call pickSpot for Sycod').toBeTruthy();
  expect(picked.name).toBe('Sycod');
  expect(picked.lat).toBeCloseTo(51.135522, 4);
  expect(picked.lon).toBeCloseTo(2.6784694, 4);
  await expect(page.locator('#searchInput')).toHaveValue('Sycod');

  const toFixedCrash = pageErrors.find((m) => /toFixed/.test(m));
  expect(toFixedCrash, `unexpected toFixed crash: ${toFixedCrash}`).toBeFalsy();
});

test('the deep-link handler shows a message for an unknown spot instead of crashing', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', { overrides: [SYCOD] });

  await page.evaluate(async () => {
    // @ts-expect-error app global
    await handleSpotDeepLink('NoSuchSpotXYZ', null);
  });

  // No spot is opened (cachedLoc stays null) and a "couldn't find" toast shows.
  const cachedName = await page.evaluate(() => (window as any).cachedLoc?.name ?? null);
  expect(cachedName).toBeNull();
  await expect(page.getByText(/Couldn.t find "NoSuchSpotXYZ"/)).toBeVisible();
});

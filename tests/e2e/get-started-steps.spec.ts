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

test('there is no way to hide the checklist while steps remain', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.waitForTimeout(600);
  await expect(page.locator('#hintSteps')).toBeVisible();
  await expect(page.locator('.hint-steps-dismiss')).toHaveCount(0);
  // a dismissal flag left over from an earlier build changes nothing
  await rerender(page, "localStorage.setItem('kf_gs_dismissed','1')");
  await expect(page.locator('#hintSteps')).toBeVisible();
});

// ── the same checklist follows the rider into the spot view ──────────────

const FX = ['2026-08-26', '2026-08-27', '2026-08-28'];
function forecast() {
  const time: string[] = [], ws: number[] = [], wd: number[] = [], wg: number[] = [], wc: number[] = [], t2: number[] = [];
  for (const d of FX) for (let h = 0; h < 24; h++) {
    time.push(`${d}T${String(h).padStart(2, '0')}:00`);
    ws.push(22); wd.push(270); wg.push(28); wc.push(0); t2.push(20);
  }
  return { latitude: RW.lat, longitude: RW.lon, timezone: 'Europe/Brussels',
    hourly: { time, temperature_2m: t2, weather_code: wc, windspeed_10m: ws, winddirection_10m: wd, windgusts_10m: wg },
    daily: { time: FX, weather_code: FX.map(() => 0), temperature_2m_max: FX.map(() => 22), temperature_2m_min: FX.map(() => 14),
      windgusts_10m_max: FX.map(() => 28), sunrise: FX.map(d => `${d}T05:30`), sunset: FX.map(d => `${d}T22:00`) } };
}

async function openSpot(page: any) {
  await page.route(/functions\/v1\/forecast/, (r: any) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ wx: forecast(), marine: null, fetched_at: new Date().toISOString(), source: 'live' }) }));
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast()) }));
  await page.route(/marine-api\.open-meteo\.com/, (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly: { time: [], wave_height: [], wave_period: [], wave_direction: [] } }) }));
  await page.evaluate(async (spot: any) => {
    await (window as any)._spotsReady;
    await pickSpot(spot);
  }, RW);
  await expect(page.locator('#results')).toBeVisible();
  await page.waitForTimeout(300);
}

const spotBar = (page: any) => page.locator('#gsSpotBar .gs-spot-bar');

test('a guest with a spot open is told to sign in and save it, right under the spot name', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await openSpot(page);
  await expect(spotBar(page)).toBeVisible();
  await expect(spotBar(page)).toContainText('Step 2 of 3');
  await expect(spotBar(page)).toContainText('Riverwoods Beachclub');
  await spotBar(page).click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppSignInContext')).toContainText('Save your go-to spots');
});

test('for a member, tapping the bar saves the open spot, then asks for the bell', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openSpot(page);
  await expect(spotBar(page)).toContainText('Step 2 of 3: tap ★');
  await spotBar(page).click();
  await expect(page.locator('#favBtn')).toHaveClass(/active/);
  await expect(spotBar(page)).toContainText('Step 3 of 3: tap 🔔');
});

test('once the open spot has an alert, the bar is gone', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await rerender(page, `saveFavs([${JSON.stringify(RW)}]); saveNotifs([{type:'spot',spotName:'Riverwoods Beachclub',lat:51.3627,lon:3.3062}])`);
  await openSpot(page);
  await expect(page.locator('#gsSpotBar')).toBeHidden();
});

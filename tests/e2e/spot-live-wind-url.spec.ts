// Community-suggestable live-wind + webcam links (RWS spec, phase 2).
//
// Riders know their local live-wind page long before an admin does, and the
// nearest RWS mast only covers the Dutch/Belgian coast. These tests pin the
// three surfaces that carry the URL: the community suggest form, the admin
// edit form, and the resolver that decides which link the spot card shows.
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('the suggest form prefills the live-wind + webcam links and submits them', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Link Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = {
      spot_name: 'Link Spot',
      live_wind_url: 'https://windy.example/link-spot',
      livecam_url: 'https://cam.example/link-spot',
    };
    openSuggestUpdate();
  });

  await expect(page.locator('#suLiveWind')).toHaveValue('https://windy.example/link-spot');
  await expect(page.locator('#suLivecam')).toHaveValue('https://cam.example/link-spot');

  await page.locator('#suLiveWind').fill('https://meetnet.example/station/42');
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  const body = (await req).postData() || '';
  expect(body).toContain('"live_wind_url":"https://meetnet.example/station/42"');
  expect(body).toContain('"livecam_url":"https://cam.example/link-spot"');
});

test('a live-wind link is enough on its own — no dir, tip or attribute needed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Link Only', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Link Only' };
    openSuggestUpdate();
    document.querySelectorAll('#suDirBtns .s-btn.active').forEach(b => b.classList.remove('active'));
    (document.getElementById('suLiveWind') as HTMLInputElement).value = 'https://meetnet.example/x';
  });
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  expect((await req).postData() || '').toContain('https://meetnet.example/x');
});

test('a javascript: link is refused at submit and never reaches the table', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  let posted = false;
  page.on('request', r => {
    if (r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST') posted = true;
  });
  await page.evaluate(() => {
    cachedLoc = { name: 'Bad Link', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Bad Link' };
    openSuggestUpdate();
    (document.getElementById('suLiveWind') as HTMLInputElement).value = 'javascript:alert(1)';
  });
  await page.evaluate(() => submitSuggestUpdate());
  await page.waitForTimeout(300);
  expect(posted).toBe(false);
  // the button is released again so the user can correct the URL
  await expect(page.locator('#suSubmitBtn')).toBeEnabled();
});

test('the admin edit form prefills and saves the live-wind URL', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.evaluate(() => { openProfilePanel('admin'); });
  await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  await page.evaluate(() => {
    adminOpenSpot(null, {
      spot_name: 'Wind Spot', _lat: 51, _lon: 3, _loc: 'BE',
      live_wind_url: 'https://windy.example/wind-spot',
    });
  });
  await expect(page.locator('#adLiveWind')).toHaveValue('https://windy.example/wind-spot');

  await page.locator('#adLiveWind').fill('https://windy.example/updated');
  const req = page.waitForRequest(r => r.url().includes('/rest/v1/spot_info') && r.method() === 'POST');
  await page.evaluate(() => adminSaveSpotInfo());
  expect((await req).postData() || '').toContain('"live_wind_url":"https://windy.example/updated"');
});

test('a suggested live-wind URL is applied to spot_info by the admin', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  const req = page.waitForRequest(r => r.url().includes('/rest/v1/spot_info') && r.method() === 'POST');
  await page.evaluate(() => adminApplyUpdate({
    id: 'sugg-1', spot_name: 'Applied Spot',
    live_wind_url: 'https://meetnet.example/applied',
  }));
  expect((await req).postData() || '').toContain('"live_wind_url":"https://meetnet.example/applied"');
});

test('a stored live-wind URL wins over the nearest RWS station', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(async () => ({
    // no coords at all: a station lookup is impossible, so anything returned
    // here can only have come from the user-submitted URL
    user: await _liveWindHref({ live_wind_url: 'https://meetnet.example/s' }, null),
    unsafe: await _liveWindHref({ live_wind_url: 'javascript:alert(1)' }, null),
    none: await _liveWindHref({}, null),
  }));
  expect(r.user?.url).toBe('https://meetnet.example/s');
  expect(r.unsafe).toBeNull();
  expect(r.none).toBeNull();
});

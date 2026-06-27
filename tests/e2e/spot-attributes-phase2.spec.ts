import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('suggest form shows prefilled attribute groups and submits them', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Sugg Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Sugg Spot', disciplines: ['Twintip'], facilities: null,
      water_type: 'Flat', tide_pref: null, crowd_level: null, skill_level: null };
    openSuggestUpdate();
  });
  // prefill: Twintip discipline + Flat water are active
  await expect(page.locator('#suDisciplines .s-btn.active[data-val="Twintip"]')).toHaveCount(1);
  await expect(page.locator('#suWaterType .s-btn.active[data-val="Flat"]')).toHaveCount(1);

  // add a facility + a crowd level, then submit and capture the insert
  await page.locator('#suFacilities .s-btn[data-val="Kiteshop"]').click();
  await page.locator('#suCrowdLevel .s-btn[data-val="Crowded"]').click();

  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('Kiteshop');
  expect(body).toContain('"crowd_level":"Crowded"');
});

test('an attributes-only suggestion (no dir/tip) is allowed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Attr Only', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Attr Only' };
    openSuggestUpdate();
    // clear any prefilled dirs so only an attribute is set
    document.querySelectorAll('#suDirBtns .s-btn.active').forEach(b => b.classList.remove('active'));
    (document.querySelector('#suDisciplines .s-btn[data-val="Wing"]') as HTMLButtonElement).click();
  });
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  const body = (await req).postData() || '';
  expect(body).toContain('Wing'); // submitted, not blocked by the dir/tip guard
});

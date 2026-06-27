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

test('suggestionAttrSummary joins present attributes and is empty when none', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { full, empty } = await page.evaluate(() => ({
    full: suggestionAttrSummary({ disciplines: ['Twintip','Wing'], facilities: ['Kiteshop'],
      water_type: 'Flat', tide_pref: null, crowd_level: 'Crowded', skill_level: null }),
    empty: suggestionAttrSummary({ disciplines: null, facilities: null, water_type: null,
      tide_pref: null, crowd_level: null, skill_level: null }),
  }));
  expect(full).toContain('Twintip');
  expect(full).toContain('Kiteshop');
  expect(full).toContain('Flat');
  expect(full).toContain('Crowded');
  expect(empty).toBe('');
});

test('approving a legacy dirs-only suggestion does NOT clobber spot attributes', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  // capture any spot_info write; if none fires that's also a pass
  let body = '';
  page.on('request', r => {
    if (r.url().includes('/rest/v1/spot_info') && (r.method()==='POST'||r.method()==='PATCH')) body = r.postData() || '';
  });
  await page.evaluate(() => adminApplyUpdate({
    id: 'legacy1', spot_name: 'Legacy Spot',
    suggested_dirs: [270, 315], tip: 'nice spot',
    disciplines: null, facilities: null, water_type: null,
    tide_pref: null, crowd_level: null, skill_level: null,
  }));
  await page.waitForTimeout(500);
  expect(body).not.toContain('"disciplines"'); // attributes NOT written for a dirs/tip-only suggestion
});

test('adminApplyUpdate writes the attribute fields to spot_info (replace, incl. clear)', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_info') && (r.method() === 'POST' || r.method() === 'PATCH'));
  await page.evaluate(() => {
    adminApplyUpdate({ id: 'x1', spot_name: 'Apply Spot',
      disciplines: ['Twintip'], facilities: null, // facilities explicitly cleared → null
      water_type: 'Flat', tide_pref: null, crowd_level: 'Crowded', skill_level: null });
  });
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('"facilities":null');     // cleared field applied as null
  expect(body).toContain('"crowd_level":"Crowded"');
});

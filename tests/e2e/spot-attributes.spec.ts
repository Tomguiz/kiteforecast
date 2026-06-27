import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('spotAttributesHTML renders chips + conditions for a fully-populated spot', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: ['Twintip', 'Wing'],
    facilities: ['Free parking', 'Kiteshop'],
    water_type: 'Flat', tide_pref: 'All tides',
    crowd_level: 'Crowded', skill_level: 'Beginner-friendly',
  }));
  expect(html).toContain('Twintip');
  expect(html).toContain('Wing');
  expect(html).toContain('Free parking');
  expect(html).toContain('🛍️'); // Kiteshop emoji
  expect(html).toContain('Flat');
  expect(html).toContain('Crowded');
  expect(html).toContain('Beginner-friendly');
  expect(html).toContain('spot-attr-block');
});

test('spotAttributesHTML returns empty string when no attribute is set', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: null, facilities: null, water_type: null,
    tide_pref: null, crowd_level: null, skill_level: null,
  }));
  expect(html).toBe('');
});

test('spotAttributesHTML omits unset sub-parts (only disciplines set)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: ['Hydrofoil'], facilities: null, water_type: null,
    tide_pref: null, crowd_level: null, skill_level: null,
  }));
  expect(html).toContain('Hydrofoil');
  expect(html).not.toContain('spot-attr-conditions'); // no scalar row
  expect(html).not.toContain('Facilities');
});

test('the spot-info card body shows the attributes block when set', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => {
    // stub fetchSpotInfo to return a populated info row, then render
    (window as any).fetchSpotInfo = async () => ({
      spot_name: 'Test Spot', verified: true,
      disciplines: ['Twintip'], facilities: ['Kiteshop'],
      water_type: 'Flat', tide_pref: null, crowd_level: 'Quiet', skill_level: null,
    });
  });
  // renderSpotInfoCard is async (awaits fetchSpotInfo); the #results view is
  // hidden in this isolated test, so reveal it before interacting (this is a
  // test-only setup, not an app change).
  await page.evaluate(async () => {
    await renderSpotInfoCard('Test Spot');
    document.getElementById('results')!.style.display = 'block';
  });
  // expand the card body (it starts collapsed)
  await page.locator('.spot-info-header').click();
  await expect(page.locator('.spot-attr-block')).toBeVisible();
  // disciplines + facilities each render their own labelled chip row; assert on
  // the disciplines chips specifically (.spot-chip-disc) to avoid strict-mode
  await expect(page.locator('.spot-chip-disc')).toContainText('Twintip');
  await expect(page.locator('.spot-attr-block')).toContainText('🪁 Disciplines');
  await expect(page.locator('.spot-attr-block')).toContainText('🏖️ Facilities');
  await expect(page.locator('.spot-attr-block')).toContainText('Kiteshop');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Flat');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Quiet');
});

test('the admin edit form prefills + toggles attribute buttons', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  // Open admin panel and wait for it to finish rendering (renderAdminPanel is async)
  await page.evaluate(() => { openProfilePanel('admin'); });
  await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  const result = await page.evaluate(() => {
    // render the form prefilled with a spot that has some attributes
    adminOpenSpot(null, {
      spot_name: 'Edit Me', _lat: 51, _lon: 3, _loc: 'BE',
      disciplines: ['Twintip'], facilities: [],
      water_type: 'Flat', tide_pref: null, crowd_level: null, skill_level: null,
    });
    // prefill: Twintip + Flat active
    const twintipActive = !!document.querySelector('#adDisciplines .s-btn.active[data-val="Twintip"]');
    const flatActive = !!document.querySelector('#adWaterType .s-btn.active[data-val="Flat"]');
    // toggle: add Wing discipline, switch water to Choppy (radio)
    (document.querySelector('#adDisciplines .s-btn[data-val="Wing"]') as HTMLButtonElement).click();
    (document.querySelector('#adWaterType .s-btn[data-val="Choppy"]') as HTMLButtonElement).click();
    return {
      twintipActive, flatActive,
      disciplines: readMultiAttr('adDisciplines'),
      water: readSingleAttr('adWaterType'),
      // single-select must have cleared 'Flat'
      flatStillActive: !!document.querySelector('#adWaterType .s-btn.active[data-val="Flat"]'),
    };
  });
  expect(result.twintipActive).toBe(true);
  expect(result.flatActive).toBe(true);
  expect(result.disciplines.sort()).toEqual(['Twintip', 'Wing']);
  expect(result.water).toBe('Choppy');
  expect(result.flatStillActive).toBe(false); // radio behaviour
});

test('read helpers return null when nothing selected', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  // Open admin panel and wait for it to finish rendering (renderAdminPanel is async)
  await page.evaluate(() => { openProfilePanel('admin'); });
  await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  const r = await page.evaluate(() => {
    adminOpenSpot(null, { spot_name: 'Empty', _lat: 51, _lon: 3, _loc: 'BE' });
    return { disc: readMultiAttr('adDisciplines'), water: readSingleAttr('adWaterType') };
  });
  expect(r.disc).toBeNull();
  expect(r.water).toBeNull();
});

test('saving the admin form sends the attribute fields to spot_info', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  // Open admin panel and wait for it to finish rendering (renderAdminPanel is async)
  await page.evaluate(() => { openProfilePanel('admin'); });
  await page.waitForFunction(() => !!document.getElementById('adminEditForm'));
  await page.evaluate(() => {
    adminOpenSpot(null, { spot_name: 'Attr Spot', _lat: 51, _lon: 3, _loc: 'BE',
      disciplines: ['Twintip'], facilities: null, water_type: null,
      tide_pref: null, crowd_level: null, skill_level: null });
    // also select a facility + crowd so the payload has both array + scalar
    (document.querySelector('#adFacilities .s-btn[data-val="Kiteshop"]') as HTMLButtonElement).click();
    (document.querySelector('#adCrowdLevel .s-btn[data-val="Crowded"]') as HTMLButtonElement).click();
  });
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_info') && (r.method() === 'POST' || r.method() === 'PATCH'));
  await page.evaluate(() => adminSaveSpotInfo());
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('Kiteshop');
  expect(body).toContain('"crowd_level":"Crowded"');
});

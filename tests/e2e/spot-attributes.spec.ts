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
  await page.evaluate(() => renderSpotInfoCard('Test Spot'));
  // expand the card body (it starts collapsed)
  await page.locator('.spot-info-header').click();
  await expect(page.locator('.spot-attr-block')).toBeVisible();
  await expect(page.locator('.spot-attr-chips')).toContainText('Twintip');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Flat');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Quiet');
});

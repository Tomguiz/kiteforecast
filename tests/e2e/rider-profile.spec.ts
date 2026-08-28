import { test, expect } from '../fixtures/auth';

// Riding level and weight. Both feed the kite-size suggestion, and the level
// is matched against spot_info.skill_level, so RIDER_LEVELS mirrors
// SPOT_SKILL_LEVELS by index rather than being a second, unrelated scale.
//
// Both are optional. A rider who never fills them in must keep working, which
// is why nothing downstream may assume a default body weight.

const openProfile = async (page: any) => {
  await page.evaluate(() => openProfilePanel('profile'));
  await page.waitForTimeout(300);
};

test('the rider scale lines up with the spot scale, index for index', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const r = await page.evaluate(() => ({
    rider: RIDER_LEVELS,
    spot: SPOT_SKILL_LEVELS,
    beginnerPair: [riderLevelIdx('Beginner'), spotLevelIdx('Beginner-friendly')],
    advancedPair: [riderLevelIdx('Advanced'), spotLevelIdx('Advanced')],
    unknown: riderLevelIdx(null as any),
  }));
  expect(r.rider).toHaveLength(r.spot.length);
  expect(r.beginnerPair[0]).toBe(r.beginnerPair[1]);
  expect(r.advancedPair[0]).toBe(r.advancedPair[1]);
  expect(r.unknown).toBe(-1);        // "not set" is distinguishable, not level 0
});

test('picking a level and a weight saves them', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openProfile(page);

  const sent = page.waitForRequest(r =>
    r.url().includes('/rest/v1/profiles') && r.method() !== 'GET' && (r.postData() || '').includes('kite_level'));

  await page.locator('#ppLevelBtns .s-btn', { hasText: 'Advanced' }).click();
  await page.locator('#ppWeightInput').fill('82');
  await page.locator('#ppRiderSaveBtn').click();

  const body = JSON.parse((await sent).postData() || '{}');
  const row = Array.isArray(body) ? body[0] : body;
  expect(row.kite_level).toBe('Advanced');
  expect(row.weight_kg).toBe(82);

  expect(await page.evaluate(() => loadProfile().kiteLevel)).toBe('Advanced');
  expect(await page.evaluate(() => loadProfile().weightKg)).toBe(82);
});

test('an implausible weight is refused, not clamped', async ({ gotoApp, page }) => {
  // Clamping 7 to 30 would hand back a kite size computed from a weight the
  // rider never gave — worse than asking again.
  await gotoApp('signedIn');
  await openProfile(page);

  // Match only the rider-profile write: the app upserts `profiles` for other
  // reasons (last_seen_at and friends), so a bare table match would catch
  // traffic this test is not about.
  let posted = false;
  page.on('request', r => {
    if (r.url().includes('/rest/v1/profiles') && r.method() !== 'GET'
        && (r.postData() || '').includes('weight_kg')) posted = true;
  });

  await page.locator('#ppWeightInput').fill('7');
  await page.locator('#ppRiderSaveBtn').click();
  await page.waitForTimeout(300);

  expect(posted).toBe(false);
  await expect(page.locator('#ppRiderStatus')).toContainText('between 30 and 150');
  expect(await page.evaluate(() => loadProfile().weightKg ?? null)).toBe(null);
});

test('both stay optional — saving nothing is allowed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openProfile(page);

  const sent = page.waitForRequest(r =>
    r.url().includes('/rest/v1/profiles') && r.method() !== 'GET' && (r.postData() || '').includes('weight_kg'));
  await page.locator('#ppRiderSaveBtn').click();

  const body = JSON.parse((await sent).postData() || '{}');
  const row = Array.isArray(body) ? body[0] : body;
  expect(row.kite_level).toBe(null);
  expect(row.weight_kg).toBe(null);
});

test('reopening the panel shows what was saved', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    const p = loadProfile(); p.kiteLevel = 'Intermediate'; p.weightKg = 74; saveProfile(p);
  });
  await openProfile(page);

  await expect(page.locator('#ppWeightInput')).toHaveValue('74');
  await expect(page.locator('#ppLevelBtns .s-btn.active')).toHaveText('Intermediate');
  expect(await page.locator('#ppLevelBtns .s-btn.active').count()).toBe(1);
});

// ── Power preference and the kite-size badge ───────────────────────────────

test('the power preference saves alongside level and weight', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openProfile(page);

  const sent = page.waitForRequest(r =>
    r.url().includes('/rest/v1/profiles') && r.method() !== 'GET' && (r.postData() || '').includes('power_pref'));

  await page.locator('#ppLevelBtns .s-btn', { hasText: 'Advanced' }).click();
  await page.locator('#ppPrefBtns .s-btn', { hasText: 'Over-powered' }).click();
  await page.locator('#ppWeightInput').fill('75');
  await page.locator('#ppRiderSaveBtn').click();

  const body = JSON.parse((await sent).postData() || '{}');
  const row = Array.isArray(body) ? body[0] : body;
  expect(row.power_pref).toBe('overpowered');
  expect(row.kite_level).toBe('Advanced');
});

test('the suggestion matches the rider’s own reference numbers', async ({ gotoApp, page }) => {
  // 75 kg at 20 kn: 9 beginner, 10 intermediate, 11-12 experienced. These are
  // his figures, not a table off the internet, so they are what the client
  // copy of the formula has to reproduce.
  await gotoApp('signedIn');
  const r = await page.evaluate(() => ({
    beg: suggestKiteSize({ weightKg: 75, level: 'Beginner',     pref: 'neutral', windKn: 20 })?.size,
    int: suggestKiteSize({ weightKg: 75, level: 'Intermediate', pref: 'neutral', windKn: 20 })?.size,
    adv: suggestKiteSize({ weightKg: 75, level: 'Advanced',     pref: 'neutral', windKn: 20 })?.size,
  }));
  expect(r.beg).toBe(9);
  expect(r.int).toBe(10);
  expect(r.adv).toBeGreaterThanOrEqual(11);
  expect(r.adv).toBeLessThanOrEqual(12);
});

test('no weight or no level means no suggestion, not a guess', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const r = await page.evaluate(() => [
    suggestKiteSize({ weightKg: null, level: 'Intermediate', windKn: 20 }),
    suggestKiteSize({ weightKg: 75, level: null, windKn: 20 }),
    suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: 8 }),
  ]);
  expect(r).toEqual([null, null, null]);
});

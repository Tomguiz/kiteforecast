import { test, expect } from '../fixtures/auth';

// SPOT_SKILL_LEVELS already existed. What was missing was the comparison
// against the rider — that is the whole feature.
//
// Two rules shape it. It only warns UPWARDS: an advanced rider on a beginner
// beach needs no notice. And it says nothing when either side is unknown,
// because "this spot suits you" on no evidence is worse than silence.

const verdict = (page: any, spot: any, rider: any) =>
  page.evaluate(([s, r]: any[]) => spotLevelVerdict(s, r), [spot, rider]);

test('warns when the spot is above the rider', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  expect(await verdict(page, 'Advanced', 'Beginner')).toMatchObject({ cls: 'far', gap: 2 });
  expect(await verdict(page, 'Intermediate', 'Beginner')).toMatchObject({ cls: 'above', gap: 1 });
  expect(await verdict(page, 'Advanced', 'Intermediate')).toMatchObject({ cls: 'above', gap: 1 });
});

test('stays quiet when the rider is at or above the spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  for (const [s, r] of [['Beginner-friendly','Beginner'], ['Beginner-friendly','Advanced'], ['Advanced','Advanced']])
    expect(await verdict(page, s, r)).toMatchObject({ cls: 'ok' });
});

test('says nothing at all when either side is unknown', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  expect(await verdict(page, 'Advanced', null)).toBeNull();      // rider never set a level
  expect(await verdict(page, null, 'Beginner')).toBeNull();      // spot has no rating
  expect(await verdict(page, 'Nonsense', 'Beginner')).toBeNull();
});

test('the warning reaches the spot card, and only when it should', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => { const p = loadProfile(); p.kiteLevel = 'Beginner'; saveProfile(p); });
  const html = await page.evaluate(() => spotAttributesHTML({ skill_level: 'Advanced' }));
  expect(html).toContain('spot-level-warn');
  expect(html).toContain('well above');

  const okHtml = await page.evaluate(() => {
    const p = loadProfile(); p.kiteLevel = 'Advanced'; saveProfile(p);
    return spotAttributesHTML({ skill_level: 'Beginner-friendly' });
  });
  expect(okHtml).not.toContain('spot-level-warn');
});

test('a rider with no level set sees no warning anywhere', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const html = await page.evaluate(() => {
    const p = loadProfile(); p.kiteLevel = null; saveProfile(p);
    return spotAttributesHTML({ skill_level: 'Advanced' });
  });
  expect(html).not.toContain('spot-level-warn');
  expect(html).toContain('Advanced');    // the rating itself still shows
});

test('the spot name in the warning is escaped, not injected', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const html = await page.evaluate(() => {
    const p = loadProfile(); p.kiteLevel = 'Beginner'; saveProfile(p);
    // skill_level is admin/community-suggestable, so it is not trusted markup
    return spotAttributesHTML({ skill_level: '<img src=x onerror=alert(1)>' });
  });
  expect(html).not.toContain('<img');
});

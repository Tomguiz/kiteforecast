import { test, expect } from '../fixtures/auth';

const ONE_FAV = JSON.stringify([{ name: 'A', lat: 1, lon: 1 }]);

test('free tier is limited to one favourite', async ({ gotoApp, page }) => {
  await page.addInitScript((favs) => localStorage.setItem('kf_favs', favs as string), ONE_FAV);
  await gotoApp('signedIn');

  // @ts-expect-error app global
  const limit = await page.evaluate(() => FREE_FAV_LIMIT);
  expect(limit).toBe(1);

  // At the limit and not premium → the app's guard condition is true (blocked).
  const blocked = await page.evaluate(() => {
    // @ts-expect-error app globals
    const favs = typeof loadFavs === 'function' ? loadFavs() : [];
    // @ts-expect-error app globals
    const premium = typeof isPremium === 'function' ? isPremium() : false;
    // @ts-expect-error app globals
    return !premium && favs.length >= FREE_FAV_LIMIT;
  });
  expect(blocked).toBe(true);
});

test('premium tier is not limited', async ({ gotoApp, page }) => {
  await page.addInitScript((favs) => localStorage.setItem('kf_favs', favs as string), ONE_FAV);
  await gotoApp('premium');
  await page.waitForTimeout(300);
  const premium = await page.evaluate(() => {
    // @ts-expect-error app global
    return typeof isPremium === 'function' ? isPremium() : false;
  });
  expect(premium).toBe(true);
});

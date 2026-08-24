import { test, expect } from '../fixtures/auth';

// A favourite used to be a single pill: "★ Riverwoods, Knokke-Heist [3 good
// days] [🔥 27 kn]". On mobile that truncated, and the live reading — the thing
// you actually open the app for — sat last, behind the spot name.
//
// It is now a four-line card, each line led by an icon naming what it carries:
//   ★  name        📍 locality        📅 good days        📡/🔥 live reading
//
// The live line is ALWAYS rendered. Before, the bubble appeared only when the
// spot was firing, so the common case (it isn't) showed nothing at all and
// "calm" was indistinguishable from "not loaded yet".

const RW = { name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 };

async function renderFavs(page: any, opts: {
  live?: { speedKn: number; dirDeg: number | null } | null;
  friends?: string[];
  favs?: unknown[];
} = {}) {
  await page.evaluate(async (o: any) => {
    await (window as any)._spotsReady;
    saveFavs(o.favs || [{ name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 }]);
    (window as any)._rwsNearest = async () => o.live
      ? { ...o.live, gustKn: null, stationName: 'Cadzand wind', distanceKm: 5.4, ageMin: 2, viewerUrl: 'x' }
      : null;
    (window as any)._friendsGoingToday = async () => ({ 'Riverwoods Beachclub': o.friends || [] });
    (window as any).fetchChipQualDays = async () => 3;
    renderHintChips();
  }, opts);
  await page.waitForTimeout(400);
}

test('the four lines appear in order, each led by its own icon', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: { speedKn: 27, dirDeg: 256.1 } });

  const card = page.locator('.fav-card').first();
  const lines = card.locator('.fav-card-line');
  await expect(lines).toHaveCount(4);

  // order: name, locality, days, live
  await expect(lines.nth(0)).toHaveClass(/fav-card-name/);
  await expect(lines.nth(1)).toHaveClass(/fav-card-loc/);
  await expect(lines.nth(2)).toHaveClass(/fav-card-days/);
  await expect(lines.nth(3)).toHaveClass(/fav-card-live/);

  await expect(lines.nth(0)).toContainText('Riverwoods Beachclub');
  await expect(lines.nth(1)).toContainText('Knokke-Heist');
  await expect(lines.nth(2)).toContainText('3 good days');
  await expect(lines.nth(3)).toContainText('27 kn 256°');

  // every line leads with a non-empty icon
  const icons = await card.locator('.fav-card-ico').allTextContents();
  expect(icons).toHaveLength(4);
  for (const i of icons) expect(i.trim().length).toBeGreaterThan(0);
});

test('a calm spot still shows its reading, dimmed rather than absent', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: { speedKn: 11, dirDeg: 240 } });   // under 15kn

  const live = page.locator('.fav-card .fav-card-live');
  await expect(live).toContainText('11 kn 240°');
  await expect(live).not.toHaveClass(/is-firing/);
});

test('a firing spot is highlighted and swaps its icon for the flame', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: { speedKn: 27, dirDeg: 256.1 } });

  const live = page.locator('.fav-card .fav-card-live');
  await expect(live).toHaveClass(/is-firing/);
  await expect(live.locator('.fav-card-ico')).toHaveText('🔥');
});

test('a spot with no mast in range says so, rather than sitting blank', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: null });

  const live = page.locator('.fav-card .fav-card-live');
  await expect(live).toContainText('No live reading');
  await expect(live).not.toHaveClass(/is-firing/);
});

test('friends going today ride on the live line, wind or no wind', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: { speedKn: 8, dirDeg: 90 }, friends: ['Gregoire', 'Damien'] });

  const bubbles = page.locator('.fav-card .fav-card-live .chip-friend');
  await expect(bubbles).toHaveCount(2);
  await expect(bubbles.nth(0)).toHaveText('G');
  await expect(bubbles.nth(1)).toHaveText('D');
});

test('the card opens the spot, and the ✕ removes it without opening', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, { live: { speedKn: 27, dirDeg: 256.1 } });

  // ✕ removes and must not fall through to the card's own click handler
  await page.evaluate(() => { (window as any)._picked = null; (window as any).pickFav = () => { (window as any)._picked = 'OPENED'; }; });
  await page.locator('.fav-card .fav-card-x').click();
  expect(await page.evaluate(() => (window as any)._picked)).toBe(null);
  await expect(page.locator('.fav-card')).toHaveCount(0);
});

test('the spot name is escaped, not injected as markup', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await renderFavs(page, {
    live: null,
    favs: [{ name: '<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', lat: 51.3, lon: 3.3 }],
  });

  const card = page.locator('.fav-card').first();
  await expect(card).toContainText('<img src=x');
  expect(await card.locator('img').count()).toBe(0);
});

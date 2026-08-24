import { test, expect } from '../fixtures/auth';

// "Good days ahead": every upcoming rideable day for the favourites you track
// with an alert, so the answer to "when do I ride, and where" needs no tapping
// into each spot.
//
// It is built entirely from chipBestCache.days10 — the per-day breakdown
// fetchChipQualDays already computes for the favourite cards — so it costs no
// extra forecast request. These tests seed that cache directly, which is also
// what keeps them independent of the network.

// The app fires its own forecast fetch on load, before any stub in the test
// body exists. Left alone it resolves mid-test and repopulates chipBestCache —
// which made the "still loading" case flake, and would let any of these assert
// against real weather. Cut it off at the wire so the seeded cache is the only
// source of days.
test.beforeEach(async ({ page }) => {
  await page.route(/api\.open-meteo\.com/, r => r.abort());
});

const RW = { name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 };
const OD = { name: 'Oostduinkerke', label: 'Oostduinkerke', lat: 51.142, lon: 2.6976 };

type Day = { dateStr: string; goodHours: number; peakKn: number; startHr: number | null; dir: string | null };
const day = (dateStr: string, goodHours: number, peakKn: number, startHr: number | null, dir: string | null): Day =>
  ({ dateStr, goodHours, peakKn, startHr, dir });

// favs: which spots are saved. belled: which of them carry an alert.
// cache: days10 per spot name.
async function seed(page: any, o: { favs: any[]; belled: string[]; cache: Record<string, Day[]> }) {
  await page.evaluate(async (o: any) => {
    await (window as any)._spotsReady;
    saveFavs(o.favs);
    localStorage.setItem('kf_notifs', JSON.stringify(o.belled.map((n: string, i: number) => ({
      id: 'n' + i, type: 'spot', spotName: n, spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }))));
    (window as any)._rwsNearest = async () => null;
    (window as any)._friendsGoingToday = async () => ({});
    (window as any).fetchChipQualDays = async () => 0;   // never hit the network
    renderHintChips();
  }, o);
  await page.waitForTimeout(300);
  // Seed AFTER the first render: chipBestCache is a script-scope `let`, not a
  // window property, and a live fetch would otherwise overwrite these rows.
  await page.evaluate((o: any) => {
    for (const [name, days] of Object.entries(o.cache)) {
      const f = o.favs.find((x: any) => x.name === name);
      const ks = SPOTS.find((x: any) => x.name === name);
      const dirs = (ks?.dirs?.length ? ks.dirs : f.dirs) || [];
      const key = `${f.lat},${f.lon}|${dirs.slice().sort((a: number, b: number) => a - b).join(',')}`;
      chipBestCache[key] = { days10: days };
    }
    renderGoodDaysSection();
  }, o);
  await page.waitForTimeout(150);
}

test('lists only the favourites that carry an alert', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW, OD], belled: ['Riverwoods Beachclub'],
    cache: {
      'Riverwoods Beachclub': [day('2026-08-25', 3, 17, 11, 'W')],
      'Oostduinkerke':        [day('2026-08-25', 4, 22, 10, 'W')],
    },
  });

  const names = await page.locator('#goodDaysSection .gd-spot-name').allTextContents();
  expect(names.join('|')).toContain('Riverwoods Beachclub');
  expect(names.join('|')).not.toContain('Oostduinkerke');
});

test('shows only days that clear the 2h bar, same rule as the badge', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [
      day('2026-08-24', 0, 0, null, null),   // nothing
      day('2026-08-25', 1, 24, 11, 'W'),     // a lone hour — not a session
      day('2026-08-26', 2, 21, 14, 'NW'),    // clears the bar
      day('2026-08-27', 6, 27, 9, 'SW'),
    ] },
  });

  const cards = page.locator('#goodDaysSection .gd-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('21 kn');
  await expect(cards.nth(1)).toContainText('27 kn');
});

test('each card carries the date, peak, direction, start and rating', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-26', 6, 27, 9, 'SW')] },
  });

  const card = page.locator('#goodDaysSection .gd-card').first();
  await expect(card.locator('.gd-date')).toContainText('Aug 26');
  await expect(card.locator('.gd-kn')).toContainText('27 kn');
  await expect(card.locator('.gd-kn')).toContainText('SW');
  await expect(card.locator('.gd-meta')).toContainText('from 09:00');
  // rateDay's own wording, so the section can never drift from the detail cards
  await expect(card.locator('.gd-rating')).toContainText('6h');
});

test('a light-wind day is labelled as such, not sold as a session', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-29', 2, 13, 14, 'NW')] },  // peak < 15kn
  });

  await expect(page.locator('#goodDaysSection .gd-rating')).toContainText('Light wind');
});

test('a tracked spot with nothing coming says so instead of vanishing', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-24', 0, 0, null, null)] },
  });

  await expect(page.locator('#goodDaysSection .gd-spot-name')).toContainText('Riverwoods');
  await expect(page.locator('#goodDaysSection .gd-empty')).toBeVisible();
});

test('no heading at all when no favourite carries an alert', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { favs: [RW], belled: [], cache: {} });

  await expect(page.locator('#goodDaysSection')).toBeEmpty();
});

test('no bare heading while the forecast is still loading', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // belled, but nothing in the cache yet — the cold-load case
  await seed(page, { favs: [RW], belled: ['Riverwoods Beachclub'], cache: {} });

  await expect(page.locator('#goodDaysSection')).toBeEmpty();
});

test('sits between the favourites and the suggestions', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-26', 6, 27, 9, 'SW')] },
  });

  const order = await page.evaluate(() => {
    const kids = [...document.getElementById('hintChips')!.children];
    return kids.map(k => k.id === 'goodDaysSection' ? 'GOOD_DAYS'
      : k.classList.contains('fav-card') ? 'FAV'
      : k.classList.contains('lbl-sugg') ? 'POPULAR' : '');
  });
  expect(order.indexOf('FAV')).toBeLessThan(order.indexOf('GOOD_DAYS'));
  expect(order.indexOf('GOOD_DAYS')).toBeLessThan(order.indexOf('POPULAR'));
});

test('a card opens its own spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-26', 6, 27, 9, 'SW')] },
  });

  await page.evaluate(() => { (window as any)._opened = null; (window as any).pickFav = (f: any) => { (window as any)._opened = f.name; }; });
  await page.locator('#goodDaysSection .gd-card').first().click();
  expect(await page.evaluate(() => (window as any)._opened)).toBe('Riverwoods Beachclub');
});

test('the spot name is escaped, not injected as markup', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  const evil = { name: '<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', lat: 51.3, lon: 3.3, dirs: [] };
  await seed(page, {
    favs: [evil], belled: ['<img src=x onerror=alert(1)>'],
    cache: { '<img src=x onerror=alert(1)>': [day('2026-08-26', 6, 27, 9, 'SW')] },
  });

  const sec = page.locator('#goodDaysSection');
  await expect(sec).toContainText('<img src=x');
  expect(await sec.locator('img').count()).toBe(0);
});

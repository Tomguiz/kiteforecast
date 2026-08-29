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
  // The cold-load case: no forecast has arrived yet. The beforeEach cuts
  // Open-Meteo off at the wire for exactly this reason; the shared-cache
  // function is now the other end of that same wire, so it goes too. Without
  // this the mock answers instantly and the app lands in the legitimately
  // different "nothing coming up" state, which the test above already covers.
  await page.route(/\/functions\/v1\/forecast/, r => r.abort());
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

test('a card opens its own spot, on the day it is about', async ({ gotoApp, page }) => {
  // The card already answered "which day" — dropping the rider on the 16-day
  // grid to find it again is a step backwards. _deepLinkDate is the hook
  // renderGrid reads to open the hourly modal once the forecast has loaded,
  // the same one the reminder emails use.
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [
      day('2026-08-26', 6, 27, 9, 'SW'),
      day('2026-08-29', 4, 21, 12, 'W'),
    ] },
  });

  await page.evaluate(() => { (window as any)._opened = null; (window as any).pickFav = (f: any) => { (window as any)._opened = f.name; }; });
  // click the SECOND card — the date must follow the card, not the first row
  await page.locator('#goodDaysSection .gd-card').nth(1).click();

  expect(await page.evaluate(() => (window as any)._opened)).toBe('Riverwoods Beachclub');
  expect(await page.evaluate(() => (window as any)._deepLinkDate)).toBe('2026-08-29');
});

test('the day is armed before the spot loads, so the modal cannot race the fetch', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [day('2026-08-26', 6, 27, 9, 'SW')] },
  });

  // record what _deepLinkDate held at the moment pickFav ran
  await page.evaluate(() => {
    (window as any)._seenAtPick = 'UNSET';
    (window as any).pickFav = () => { (window as any)._seenAtPick = (window as any)._deepLinkDate; };
  });
  await page.locator('#goodDaysSection .gd-card').first().click();
  expect(await page.evaluate(() => (window as any)._seenAtPick)).toBe('2026-08-26');
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

// ── The chain end to end ───────────────────────────────────────────────────
//
// Everything above proves the card ARMS the deep link. This proves the link
// actually lands: real pickFav, real forecast load, real renderGrid, and the
// hourly modal open on the right day. Worth its own test because
// `_deepLinkDate` — the hook the reminder emails also rely on — had no
// coverage anywhere in the suite before this.

const FX_DAYS = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27'];

function forecastFixture(lat: number, lon: number) {
  const time: string[] = [], windspeed_10m: number[] = [], winddirection_10m: number[] = [];
  const windgusts_10m: number[] = [], weather_code: number[] = [], temperature_2m: number[] = [];
  for (const d of FX_DAYS) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      const good = d === '2026-08-26' && h >= 12 && h <= 17;   // the day we click
      windspeed_10m.push(good ? 11.5 : 0.5);                   // ~22kn
      winddirection_10m.push(270);
      windgusts_10m.push(good ? 14 : 1);
      weather_code.push(0);
      temperature_2m.push(20);
    }
  }
  return {
    latitude: lat, longitude: lon, timezone: 'Europe/Brussels',
    hourly: { time, temperature_2m, weather_code, windspeed_10m, winddirection_10m, windgusts_10m },
    daily: {
      time: FX_DAYS,
      weather_code: FX_DAYS.map(() => 0),
      temperature_2m_max: FX_DAYS.map(() => 24),
      temperature_2m_min: FX_DAYS.map(() => 14),
      windgusts_10m_max: FX_DAYS.map(() => 20),
      sunrise: FX_DAYS.map(d => `${d}T05:30`),
      sunset: FX_DAYS.map(d => `${d}T22:00`),
    },
  };
}

test('clicking a good day lands on that day’s hourly view, not the 16-day grid', async ({ gotoApp, page }) => {
  // this one needs the forecast, so hand it to the shared-cache mock
  await gotoApp('signedIn', { forecastWx: forecastFixture(RW.lat, RW.lon) });
  await seed(page, {
    favs: [RW], belled: ['Riverwoods Beachclub'],
    cache: { 'Riverwoods Beachclub': [
      day('2026-08-25', 3, 17, 11, 'W'),
      day('2026-08-26', 6, 22, 12, 'W'),
    ] },
  });

  await page.locator('#goodDaysSection .gd-card').nth(1).click();   // Aug 26

  // the hourly modal opens on its own, headed with that date
  await expect(page.locator('#modalOverlay')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#mTitle')).toContainText('August 26');
});

import { test, expect } from '../fixtures/auth';

// Favourite chips carry two independent signals:
//   🔥 21 kn 270°  — measured wind at a station within 30km, at or above 15kn
//   (J)(M)    — one bubble per friend confirmed for today, initial only
// They are deliberately independent: a mate going matters on a light day, and
// wind matters with nobody going.

async function seedChip(page: any, opts: {
  live?: { speedKn: number; dirDeg: number | null } | null;
  friends?: string[];
  dirs?: number[];
}) {
  await page.evaluate(async (o: any) => {
    // @ts-expect-error app global
    await (window as any)._spotsReady;
    // @ts-expect-error app global
    saveFavs([{ name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062, dirs: o.dirs || [270, 315] }]);
    // @ts-expect-error app global — stub the station lookup, no network in tests
    window._rwsNearest = async () => o.live
      ? { ...o.live, gustKn: null, stationName: 'Cadzand wind', distanceKm: 5.4, ageMin: 2, viewerUrl: 'https://x' }
      : null;
    // @ts-expect-error app global
    window._todayAttendCache = null;
    // @ts-expect-error app global
    window._friendsGoingToday = async () => ({ 'Riverwoods Beachclub': o.friends || [] });
    // @ts-expect-error app global
    renderHintChips();
  }, opts);
  await page.waitForTimeout(250);
}

test('shows the firing bubble at 15kn from a good direction', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 21, dirDeg: 270 } });

  await expect(page.locator('.chip-firing')).toHaveText('🔥 21 kn 270°');
});

test('stays quiet below 15kn', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 14, dirDeg: 270 } });

  await expect(page.locator('.chip-firing')).toHaveCount(0);
});

test('stays quiet on a strong wind from the wrong direction', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 30, dirDeg: 135 } });

  await expect(page.locator('.chip-firing')).toHaveCount(0);
});

test('shows nothing when the spot has no station in range', async ({ gotoApp, page }) => {
  // Oostduinkerke's case: nearest mast is 54km away. No bubble, no placeholder
  // — an empty chip is the honest answer, and "no data" would read as "no wind".
  await gotoApp('signedIn');
  await seedChip(page, { live: null });

  await expect(page.locator('.chip-firing')).toHaveCount(0);
  await expect(page.locator('.fav-chip')).toBeVisible();
});

test('shows one initial bubble per friend going today', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: null, friends: ['James', 'Marie'] });

  await expect(page.locator('.chip-friend')).toHaveCount(2);
  await expect(page.locator('.chip-friend').nth(0)).toHaveText('J');
  await expect(page.locator('.chip-friend').nth(1)).toHaveText('M');
});

test('friend bubbles appear regardless of wind', async ({ gotoApp, page }) => {
  // Light day, mate going anyway — the whole reason these are independent.
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 6, dirDeg: 270 }, friends: ['Vass'] });

  await expect(page.locator('.chip-firing')).toHaveCount(0);
  await expect(page.locator('.chip-friend')).toHaveText('V');
});

test('shows both signals together when both are true', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 24, dirDeg: 300 }, friends: ['Ced'] });

  await expect(page.locator('.chip-firing')).toHaveText('🔥 24 kn 300°');
  await expect(page.locator('.chip-friend')).toHaveText('C');
});

test('no friend bubbles when nobody is going', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 22, dirDeg: 270 }, friends: [] });

  await expect(page.locator('.chip-friend')).toHaveCount(0);
});

test('the good-days badge pluralises', async ({ gotoApp, page }) => {
  // Read "1 good days" for a long time; the title attribute beside it had
  // always got this right.
  await gotoApp('signedIn');
  for (const [n, expected] of [[1, '1 good day 💨'], [3, '3 good days 💨']] as const) {
    const text = await page.evaluate((n: number) => {
      const el = document.createElement('span');
      document.body.appendChild(el);
      // @ts-expect-error app global
      setChipDayBadge(el, n, true);
      const t = el.textContent;
      el.remove();
      return t;
    }, n);
    expect(text).toBe(expected);
  }
});

// The bubble carries the mast's exact degree, not the 8-point letter. Rounding
// 250.1° to "W" hid how close a reading sat to the tolerance edge — the number
// is what tells you the wind is about to swing out of (or into) the spot.
test('the bubble reports the exact degree the mast measured', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 23, dirDeg: 250.1 } });
  await expect(page.locator('.chip-firing')).toHaveText('🔥 23 kn 250°');
  await expect(page.locator('.chip-firing')).not.toContainText('W');
});

// 250.1° against a spot listed [270, 315] is 19.9° out — inside the new ±30°
// but it was inside the old ±22.5° too. 246.3° is the one that changed: the
// mast 16 km off Riverwoods was reading it while the app said "not ok".
test('fires on the WSW that the old ±22.5° tolerance turned away', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 26, dirDeg: 246.3 } });
  await expect(page.locator('.chip-firing')).toHaveText('🔥 26 kn 246°');
});

test('still stays quiet once the wind is genuinely off the spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // 239° is just past the 240° edge of a spot listed 270°
  await seedChip(page, { live: { speedKn: 26, dirDeg: 239 }, dirs: [270] });
  await expect(page.locator('.chip-firing')).toHaveCount(0);
});

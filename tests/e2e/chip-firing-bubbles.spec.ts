import { test, expect } from '../fixtures/auth';

// The live reading moved out of a standalone bubble and onto the favourite
// card's fourth line (`.fav-card-live`), which is ALWAYS rendered. "Quiet"
// therefore no longer means "no element" — the line is there with the reading
// on it, just not marked `is-firing`. Asserting a count of 0 on the old bubble
// would now pass however broken the code was.
const LIVE = '.fav-card .fav-card-live';

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

  await expect(page.locator(LIVE)).toHaveClass(/is-firing/);
  await expect(page.locator(LIVE)).toContainText('21 kn 270°');
});

test('stays quiet below 15kn', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 14, dirDeg: 270 } });

  // the reading first: `is-firing` is added asynchronously, so asserting its
  // absence on its own would pass before the lookup had even resolved
  await expect(page.locator(LIVE)).toContainText('14 kn 270°');
  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);
});

test('stays quiet on a strong wind from the wrong direction', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 30, dirDeg: 135 } });

  await expect(page.locator(LIVE)).toContainText('30 kn 135°');
  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);
});

test('shows nothing when the spot has no station in range', async ({ gotoApp, page }) => {
  // Oostduinkerke's case: nearest mast is 54km away. The line says so outright;
  // leaving it blank read as "no wind", which is a different claim.
  await gotoApp('signedIn');
  await seedChip(page, { live: null });

  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);
  await expect(page.locator('.fav-card')).toBeVisible();
  await expect(page.locator(LIVE)).toContainText('No live reading');
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

  await expect(page.locator(LIVE)).toContainText('6 kn 270°');
  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);
  await expect(page.locator('.chip-friend')).toHaveText('V');
});

test('shows both signals together when both are true', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 24, dirDeg: 300 }, friends: ['Ced'] });

  await expect(page.locator(LIVE)).toHaveClass(/is-firing/);
  await expect(page.locator(LIVE)).toContainText('24 kn 300°');
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
  await expect(page.locator(LIVE)).toHaveClass(/is-firing/);
  await expect(page.locator(LIVE)).toContainText('23 kn 250°');
  await expect(page.locator(LIVE)).not.toContainText('W');
});

// The Knokke floor. Riverwoods needs 250° or more, so 250.1° fires and 246.3°
// does not — the tolerance is 20 precisely so that a listed W bottoms out on
// 250. This test previously asserted the opposite, back when 246 was thought
// rideable there.
test('fires at the 250° floor and not below it', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 26, dirDeg: 250.1 } });
  await expect(page.locator(LIVE)).toHaveClass(/is-firing/);
  await expect(page.locator(LIVE)).toContainText('26 kn 250°');
});

test('stays quiet just under the 250° floor', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seedChip(page, { live: { speedKn: 26, dirDeg: 246.3 } });
  await expect(page.locator(LIVE)).toContainText('26 kn 246°');   // still reported
  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);  // but not firing
});

test('still stays quiet once the wind is genuinely off the spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // 135° (SE) is nowhere near Riverwoods' set. Deliberately NOT a near-edge
  // figure: renderHintChips resolves dirs from the SPOTS catalogue in
  // preference to the favourite's stored snapshot (`_liveDirs`), so a boundary
  // case here silently re-aims itself whenever the catalogue data changes —
  // which is exactly how this test broke when the Belgian coast was widened to
  // N NE SW W NW. The ±30° edge is pinned on isWindDirOK directly, in
  // tests/unit/rideability.test.ts, where the dirs are explicit.
  await seedChip(page, { live: { speedKn: 26, dirDeg: 135 } });
  await expect(page.locator(LIVE)).toContainText('26 kn 135°');
  await expect(page.locator(LIVE)).not.toHaveClass(/is-firing/);
});

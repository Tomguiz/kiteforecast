import { test, expect } from '../fixtures/auth';

// Two things the favourite card was not saying:
//
//  1. that "17 kn" is a LIVE measurement. On a card whose other numbers are all
//     forecast, an icon alone did not carry it — hence a spelled-out LIVE pill,
//     reusing .webcam-dot, the pulse the app already uses for live content.
//  2. that the spot has a webcam at all. The button opens the spot with its
//     info panel already unfolded and the cam scrolled to, because that panel
//     renders collapsed and the rider would otherwise land on a folded card.

const RW = { name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 };
const OD = { name: 'Oostduinkerke', label: 'Oostduinkerke', lat: 51.142, lon: 2.6976 };

test.beforeEach(async ({ page }) => {
  await page.route(/api\.open-meteo\.com/, r => r.abort());
});

async function render(page: any, o: { live?: any; cams?: Record<string, string> } = {}) {
  await page.evaluate(async (o: any) => {
    await (window as any)._spotsReady;
    saveFavs([
      { name: 'Riverwoods Beachclub', label: 'Riverwoods', lat: 51.3627, lon: 3.3062 },
      { name: 'Oostduinkerke', label: 'Oostduinkerke', lat: 51.142, lon: 2.6976 },
    ]);
    // _favCamUrls is a script-scope `let`, NOT a window property — assigning
    // window._favCamUrls would leave the real (empty) map in place.
    _favCamUrls = o.cams || {};
    (window as any)._rwsNearest = async () => o.live === undefined
      ? { speedKn: 17, dirDeg: 61, gustKn: 21, stationName: 'Cadzand wind', distanceKm: 5.4, ageMin: 3, viewerUrl: 'x' }
      : o.live;
    (window as any)._friendsGoingToday = async () => ({});
    (window as any).fetchChipQualDays = async () => 2;
    renderHintChips();
  }, o);
  await page.waitForTimeout(400);
}

test('the reading is labelled LIVE, not left to the icon', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page);

  const line = page.locator('.fav-card .fav-card-live').first();
  await expect(line.locator('.fav-live-badge')).toBeVisible();
  await expect(line.locator('.fav-live-badge')).toContainText('LIVE');
  await expect(line).toContainText('17 kn 61°');
});

test('the LIVE pill carries the app’s live pulse, not a bare word', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page);
  await expect(page.locator('.fav-card .fav-live-badge .webcam-dot').first()).toBeAttached();
});

test('no LIVE pill when there is no reading to label', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page, { live: null });

  const line = page.locator('.fav-card .fav-card-live').first();
  await expect(line).toContainText('No live reading');
  await expect(line.locator('.fav-live-badge')).toBeHidden();
});

test('the cam button shows only for a spot that has one', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'https://cam.example/rw' } });

  const cards = page.locator('.fav-card');
  await expect(cards.filter({ hasText: 'Riverwoods' }).locator('.fav-cam-btn')).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Oostduinkerke' }).locator('.fav-cam-btn')).toHaveCount(0);
});

test('the cam button is a real link straight to the cam', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'https://cam.example/rw' } });

  const btn = page.locator('.fav-card .fav-cam-btn').first();
  // An <a>, not a span with a click handler: on touch a JS-only click on a
  // small element nested inside a card that is itself clickable is unreliable —
  // the tap gets taken by the parent or eaten by scroll handling. This is why
  // the button did nothing on mobile.
  expect(await btn.evaluate(el => el.tagName)).toBe('A');
  await expect(btn).toHaveAttribute('href', 'https://cam.example/rw');
  await expect(btn).toHaveAttribute('target', '_blank');
  await expect(btn).toHaveAttribute('rel', /noopener/);
});

test('it goes to the cam itself, not to the spot page', async ({ gotoApp, page }) => {
  // It used to route through the spot page and unfold the info panel. That only
  // showed the cam inline for the two spots the app can embed (both YouTube);
  // for the other five it left the rider in front of another button — which is
  // what "not always opening the live cam" meant.
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'https://cam.example/rw' } });

  await page.evaluate(() => {
    (window as any)._picked = null;
    (window as any).pickFav = (f: any) => { (window as any)._picked = f.name; };
  });
  // stop the real navigation, we only care that the app does not route itself
  await page.locator('.fav-card .fav-cam-btn').first().evaluate((el: HTMLAnchorElement) => {
    el.removeAttribute('target');
    el.addEventListener('click', e => e.preventDefault());
  });
  await page.locator('.fav-card .fav-cam-btn').first().click();

  expect(await page.evaluate(() => (window as any)._picked)).toBe(null);
});

test('a cam url that is not http is dropped rather than linked', async ({ gotoApp, page }) => {
  // livecam_url is community-suggestable, so escaping the href is not enough —
  // a javascript: URL would still run on click.
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'javascript:alert(1)' } });

  expect(await page.locator('.fav-card .fav-cam-btn').count()).toBe(0);
});

// The cam shortcut is a primary action — "watch it right now" — but shipped at
// .72rem with 1px padding inside an already-small line, measuring 26x20:
// decoration, and a poor tap target on a phone. It is now 44x30. This pins the
// floor rather than an exact size, so restyling stays free but shrinking it
// back does not pass.
test('the cam button is big enough to see and to tap', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'https://cam.example/rw' } });

  const box = await page.locator('.fav-cam-btn').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(28);
  expect(box!.width).toBeGreaterThanOrEqual(40);
});

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

test('the cam button opens the spot and asks for the cam, without opening the forecast', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await render(page, { cams: { 'Riverwoods Beachclub': 'https://cam.example/rw' } });

  await page.evaluate(() => {
    (window as any)._picked = null;
    (window as any)._deepLinkDate = null;
    (window as any).pickFav = (f: any) => { (window as any)._picked = f.name; };
  });
  await page.locator('.fav-card .fav-cam-btn').first().click();

  expect(await page.evaluate(() => (window as any)._picked)).toBe('Riverwoods Beachclub');
  expect(await page.evaluate(() => (window as any)._openCamOnLoad)).toBe(true);
  // it must not also arm a day deep-link — that is the card's job, not the cam's
  expect(await page.evaluate(() => (window as any)._deepLinkDate)).toBe(null);
});

test('landing with the flag unfolds the spot panel instead of leaving it collapsed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(async () => {
    (window as any).fetchSpotInfo = async () => ({
      spot_name: 'Riverwoods Beachclub', verified: true,
      livecam_url: 'https://www.clubnorthzeebrugge.be/meteo-webcam',   // a plain link, not an embed
    });
    (window as any)._openCamOnLoad = true;
    await renderSpotInfoCard('Riverwoods Beachclub');
    document.getElementById('results')!.style.display = 'block';
  });

  // the body renders display:none; the flag must have opened it
  await expect(page.locator('.spot-info-body')).toBeVisible();
  await expect(page.locator('[data-cta="livecam"]')).toBeVisible();
  // one-shot, like _deepLinkDate — a later render must not re-open it
  expect(await page.evaluate(() => (window as any)._openCamOnLoad)).toBe(false);
});

test('landing without the flag leaves the panel collapsed as before', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(async () => {
    (window as any).fetchSpotInfo = async () => ({
      spot_name: 'Riverwoods Beachclub', verified: true,
      livecam_url: 'https://www.clubnorthzeebrugge.be/meteo-webcam',
    });
    (window as any)._openCamOnLoad = false;
    await renderSpotInfoCard('Riverwoods Beachclub');
    document.getElementById('results')!.style.display = 'block';
  });

  await expect(page.locator('.spot-info-body')).toBeHidden();
});

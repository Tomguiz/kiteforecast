// Which webcam URLs are embedded in an iframe, and which stay a plain link.
//
// livecam_url is now community-suggestable, so "embed whatever URL is stored"
// would let an approved suggestion render a whole third-party page inside the
// spot card. Embedding is therefore restricted to known player hosts; every
// other URL keeps the link button it has today.
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('a YouTube URL still yields an embeddable player src', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => ({
    watch: camEmbedSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    short: camEmbedSrc('https://youtu.be/dQw4w9WgXcQ'),
    live:  camEmbedSrc('https://www.youtube.com/live/dQw4w9WgXcQ'),
  }));
  expect(r.watch).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(r.short).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(r.live).toContain('youtube.com/embed/dQw4w9WgXcQ');
});

test('an ipcamlive player URL is embedded as-is', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const src = await page.evaluate(() =>
    camEmbedSrc('https://g0.ipcamlive.com/player/player.php?alias=icarusview'));
  expect(src).toBe('https://g0.ipcamlive.com/player/player.php?alias=icarusview');
});

test('a lookalike host is not treated as an allowlisted player', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => ({
    suffix: camEmbedSrc('https://ipcamlive.com.attacker.example/player/player.php?alias=x'),
    glued:  camEmbedSrc('https://notipcamlive.com/player/player.php?alias=x'),
    fakeYt: camEmbedSrc('https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ'),
  }));
  expect(r.suffix).toBeNull();
  expect(r.glued).toBeNull();
  expect(r.fakeYt).toBeNull();
});

test('an ordinary web page is never embedded', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => ({
    page:   camEmbedSrc('https://www.clubnorthzeebrugge.be/meteo-webcam'),
    script: camEmbedSrc('javascript:alert(1)'),
    empty:  camEmbedSrc(''),
  }));
  expect(r.page).toBeNull();
  expect(r.script).toBeNull();
  expect(r.empty).toBeNull();
});

test('an ipcamlive spot renders an iframe, an ordinary page renders a link', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: { spot_name: 'Cam Spot', verified: true,
      livecam_url: 'https://g0.ipcamlive.com/player/player.php?alias=icarusview' },
  });
  await page.evaluate(() => renderSpotInfoCard('Cam Spot'));
  await expect(page.locator('#spotInfoCard .webcam-embed iframe')).toHaveAttribute(
    'src', 'https://g0.ipcamlive.com/player/player.php?alias=icarusview');

  await page.evaluate(() => {
    _cachedSpotInfo = null;
    return renderSpotInfoCard('Cam Spot');
  });
});

test('the live-wind CTA is a filled button, not bare text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: { spot_name: 'Wind Spot', verified: true,
      live_wind_url: 'https://meteozeebrugge.example/' },
  });
  await page.evaluate(() => renderSpotInfoCard('Wind Spot'));
  const btn = page.locator('#spotInfoCard [data-cta="live_wind"]');
  await expect(btn).toHaveClass(/spot-cta-livewind/);
  // every other CTA carries a painted background; this one used to carry none
  const bg = await btn.evaluate(el => {
    const s = getComputedStyle(el);
    return s.backgroundImage !== 'none' ? s.backgroundImage : s.backgroundColor;
  });
  expect(bg).not.toBe('none');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('a lone live-wind CTA fills the row instead of half of it', async ({ gotoApp, page }) => {
  // A spot with no lesson or gear booking still puts its live-wind button in
  // the two-column CTA grid, where it would otherwise occupy one cell and
  // leave the other empty — reading as a stray half-button.
  await gotoApp('signedOut', {
    spotInfo: { spot_name: 'Lone CTA', verified: true,
      live_wind_url: 'https://meteozeebrugge.example/' },
  });
  await page.evaluate(() => renderSpotInfoCard('Lone CTA'));
  const { btn, row } = await page.evaluate(() => {
    // the results view is hidden and the card body collapsed until "More
    // details" is tapped; show both so the CTA has a real laid-out width
    showOnly('results');
    (document.querySelector('#spotInfoCard .spot-info-body') as HTMLElement).style.display = 'flex';
    const b = document.querySelector('#spotInfoCard [data-cta="live_wind"]') as HTMLElement;
    return { btn: b.getBoundingClientRect().width,
             row: (b.parentElement as HTMLElement).getBoundingClientRect().width };
  });
  expect(btn).toBeGreaterThan(row * 0.9);
});

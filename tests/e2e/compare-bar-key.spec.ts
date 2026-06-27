import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// Regression: chipBestCache is written under a key that includes a wind-dirs
// suffix ("lat,lon|dirs"), but renderCompareBar() looked entries up by bare
// "lat,lon" — so the "Compare your spots" table found nothing and stayed empty
// whenever the spot had wind directions set. The lookup must match by lat,lon
// PREFIX (ignoring the dirs suffix), like the rest of the chip-cache code.

test('compare bar finds dirs-suffixed cache entries for its favourites', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');

  const cols = await page.evaluate(() => {
    const A = { name: 'Spot A', label: 'Spot A', lat: 51.35, lon: 3.28, dirs: [270, 315] };
    const B = { name: 'Spot B', label: 'Spot B', lat: 50.83, lon: 1.61, dirs: [225, 270] };
    localStorage.setItem('kf_favs', JSON.stringify([A, B]));

    // entries keyed WITH the dirs suffix, exactly as fetchChipQualDays writes them
    const mkDays = (ds: string) => [{ dateStr: ds, qh: 4, goodHours: 4, peakKn: 22, startHr: 11, dir: 'NW' }];
    const keyA = `${A.lat},${A.lon}|${A.dirs.slice().sort((a, b) => a - b).join(',')}`;
    const keyB = `${B.lat},${B.lon}|${B.dirs.slice().sort((a, b) => a - b).join(',')}`;
    chipBestCache[keyA] = { dateStr: '2026-06-28', peakKn: 22, startHr: 11, nextDateStr: '2026-06-28',
      nextStartHr: 11, nextPeakKn: 22, spotName: 'Spot A', spot: A, days10: mkDays('2026-06-28') };
    chipBestCache[keyB] = { dateStr: '2026-06-29', peakKn: 20, startHr: 12, nextDateStr: '2026-06-29',
      nextStartHr: 12, nextPeakKn: 20, spotName: 'Spot B', spot: B, days10: mkDays('2026-06-29') };

    _compareOpen = true;
    renderCompareBar();

    const bar = document.getElementById('compareBar')!;
    return { visible: bar.style.display !== 'none', spotHeaders: bar.querySelectorAll('.cmp-spot-hdr').length };
  });

  expect(cols.visible).toBe(true);
  expect(cols.spotHeaders).toBe(2); // both favourites resolved from their dirs-suffixed keys
});

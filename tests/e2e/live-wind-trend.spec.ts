// The live-wind panel's 3h trend line.
//
// It used to borrow the day-card sparkline, which normalises against a fixed
// 0-45 kn scale: three hours of 6-8 kn wind came out as ~1px of movement — a
// flat hairline with nothing saying what it covered. These tests pin the
// autoscaled range and the labels that make it readable.
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('the trend scales to its own readings, not a fixed 0-45 kn axis', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => rwsTrendRange([12, 18, 25, 20]));
  // a 13 kn spread is wider than the minimum band, so it is used as-is
  expect(r.lo).toBe(12);
  expect(r.hi).toBe(25);
});

test('a narrow spread is padded to a minimum band so light wind stays readable', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => rwsTrendRange([6, 7, 8]));
  expect(r.hi - r.lo).toBe(5);   // padded up to the floor
  expect(r.lo).toBeLessThanOrEqual(6);
  expect(r.hi).toBeGreaterThanOrEqual(8);
});

test('dead-flat wind is not amplified into fake movement', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => rwsTrendRange([7, 7, 7]));
  // centred on the reading, so the line sits mid-box and stays flat
  expect(r.lo).toBe(4.5);
  expect(r.hi).toBe(9.5);
});

test('the band never runs below zero knots', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const r = await page.evaluate(() => rwsTrendRange([1, 2]));
  expect(r.lo).toBe(0);
  expect(r.hi).toBe(5);
});

test('a 2 kn rise renders as real vertical movement, not a hairline', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const ys = await page.evaluate(() => {
    const svg = rwsTrendSVG([6, 8]);
    return [...svg.matchAll(/[\d.]+,([\d.]+)/g)].map(m => parseFloat(m[1]));
  });
  const spread = Math.max(...ys) - Math.min(...ys);
  expect(spread).toBeGreaterThan(10); // the old fixed scale gave ~1.3px
});

test('the panel says what window the line covers and how high the wind got', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(async () => {
    _rwsTrendCache.set('TESTSTN', { data: [6, 7, 8, 7], ts: Date.now() });
    (window as any)._rwsNearest = async () => ({
      stationId: 'TESTSTN', stationName: 'Test Mast', distanceKm: 4.2,
      speedKn: 7, gustKn: 9, dirDeg: 135, ageMin: 3, viewerUrl: 'https://rws.example/x',
    });
    await renderLiveWindPanel({ name: 'Trend Spot', latitude: 51.35, longitude: 3.28 });
  });
  const html = await page.locator('#liveWindPanel').innerHTML();
  expect(html).toContain('last 3h');
  expect(html).toContain('8 kn');   // the window's high, labelled on the axis
});

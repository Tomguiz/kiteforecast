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
  expect(html).toContain('8 kn');   // the window's high, marked on the line
  // and it arrives as a positioned overlay, not as text inside the stretched SVG
  expect(html).toMatch(/position:absolute;[^"]*top:[\d.]+px/);
});

// ── Peak / trough markers ──
//
// The corner label used to read "19–25 kn", which says what the wind did but
// never when it did it. The high and low are now marked on the line itself.
// They are HTML rather than SVG because the trend SVG is drawn with
// preserveAspectRatio="none" across the full card width — a <circle> inside it
// comes out an ellipse and text comes out stretched.

test('marks the high and the low with their values', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => rwsTrendPeaks([12, 18, 25, 20, 14]));
  expect(html).toContain('25 kn');
  expect(html).toContain('12 kn');
  expect(html).toContain('&#8593;');  // ↑ on the peak
  expect(html).toContain('&#8595;');  // ↓ on the trough
});

test('puts each marker at the reading it belongs to, not at the ends', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // peak is index 2 of 5 → 50%, trough is index 0 → 0%
  const lefts = await page.evaluate(() =>
    [...rwsTrendPeaks([12, 18, 25, 20, 14]).matchAll(/left:([\d.]+)%/g)].map(m => parseFloat(m[1])));
  expect(lefts).toContain(50);
  expect(lefts).toContain(0);
});

test('the marker sits on the drawn line, at the same y the SVG plots', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { markerTop, svgY } = await page.evaluate(() => {
    const data = [12, 18, 25, 20, 14];
    // the peak marker's own top, and the y the polyline uses for that point
    const markerTop = parseFloat(rwsTrendPeaks(data).match(/top:([\d.]+)px/)![1]);
    const pts = [...rwsTrendSVG(data).matchAll(/([\d.]+),([\d.]+)/g)].map(m => parseFloat(m[2]));
    return { markerTop, svgY: Math.min(...pts) };   // peak = smallest y
  });
  expect(markerTop).toBeCloseTo(svgY, 1);
});

test('a flat window names one value, not a high and a low that are equal', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => rwsTrendPeaks([7, 7, 7]));
  expect(html).toContain('7 kn');
  expect(html).not.toContain('&#8595;');            // no trough marker
  expect(html.match(/7 kn/g)).toHaveLength(1);
});

test('a marker near the right edge flips its label inward', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  // peak at the last reading — a label drawn rightward would leave the card
  const html = await page.evaluate(() => rwsTrendPeaks([10, 12, 14, 30]));
  expect(html).toContain('right:0.00%');
  expect(html).toContain('30 kn');
});

test('renders nothing when there is no line to mark', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const empty = await page.evaluate(() => [rwsTrendPeaks([]), rwsTrendPeaks([9]), rwsTrendPeaks(null)]);
  expect(empty).toEqual(['', '', '']);
});

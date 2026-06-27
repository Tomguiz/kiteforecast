import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The day-card sparkline maps knots to a 0..1 height fraction. The mapping is
// non-linear (power curve) so the kiteable mid-range (good/green wind, ~15-25kn)
// rises noticeably higher than a plain linear 0..45 scale, while light wind
// stays low and the ends stay anchored (0kn at bottom, >=45kn at top).

test('sparkYFrac anchors the endpoints', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { zero, max, over } = await page.evaluate(() => ({
    zero: sparkYFrac(0), max: sparkYFrac(45), over: sparkYFrac(60),
  }));
  expect(zero).toBe(0);
  expect(max).toBe(1);
  expect(over).toBe(1); // clamps above the ceiling
});

test('sparkYFrac lifts the kiteable mid-range above the linear scale', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const f = await page.evaluate(() => ({
    k15: sparkYFrac(15), k20: sparkYFrac(20), k25: sparkYFrac(25),
  }));
  // linear would be 15/45=.33, 20/45=.44, 25/45=.56 — the curve must exceed each
  expect(f.k15).toBeGreaterThan(0.33 + 0.05);
  expect(f.k20).toBeGreaterThan(0.44 + 0.08);
  expect(f.k25).toBeGreaterThan(0.56 + 0.08);
  // still monotonic increasing
  expect(f.k20).toBeGreaterThan(f.k15);
  expect(f.k25).toBeGreaterThan(f.k20);
});

test('sparkYFrac keeps light wind low (does not over-lift the bottom)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const k8 = await page.evaluate(() => sparkYFrac(8));
  // 8kn (too light) should stay in the lower third
  expect(k8).toBeLessThan(0.4);
  expect(k8).toBeGreaterThan(0);
});

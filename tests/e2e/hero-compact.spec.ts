import { test, expect } from '../fixtures/auth';

// The home header stacked a 110px logo badge over the wordmark over the
// tagline over the search bar, and ate a third of the screen before a single
// forecast was visible:
//
//   desktop 1440x900   334px   37%
//   ipad     820x1180  331px   28%
//   mobile   390x844   286px   34%
//
// Same pieces, one row for the brand, tighter padding — roughly half the
// height. These pin a CEILING rather than an exact size, so the header can be
// restyled but not grow back.

const heroHeight = (page: any) => page.evaluate(() =>
  Math.round(document.querySelector('.hero')!.getBoundingClientRect().height))

for (const [label, w, h, max] of [
  ['desktop', 1440, 900, 200],
  ['ipad', 820, 1180, 200],
  ['mobile', 390, 844, 175],
] as const) {
  test(`the header stays compact on ${label}`, async ({ gotoApp, page }) => {
    await page.setViewportSize({ width: w, height: h });
    await gotoApp('signedIn');
    await page.waitForTimeout(600);
    expect(await heroHeight(page)).toBeLessThanOrEqual(max);
  });
}

test('the brand still shows: logo and wordmark side by side', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.waitForTimeout(600);

  const row = await page.evaluate(() => {
    const img = document.querySelector('.site-logo') as HTMLElement;
    const word = document.querySelector('#logoHome') as HTMLElement;
    const a = img.getBoundingClientRect(), b = word.getBoundingClientRect();
    return { sameRow: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 12, logoW: Math.round(a.width) };
  });
  // shrinking it is the point, but not to the point of vanishing
  expect(row.logoW).toBeGreaterThanOrEqual(40);
  expect(row.sameRow).toBe(true);
});

test('opening a spot still collapses the header on mobile', async ({ gotoApp, page }) => {
  // The mobile compact mode hides the logo and wordmark. They now live inside a
  // flex row, which could have left an empty row holding its gap open.
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp('signedIn');
  await page.waitForTimeout(600);

  const collapsed = await page.evaluate(() => {
    document.body.classList.add('spot-loaded');
    return {
      hero: Math.round(document.querySelector('.hero')!.getBoundingClientRect().height),
      row: Math.round(document.querySelector('.brand-row')!.getBoundingClientRect().height),
    };
  });
  expect(collapsed.row).toBe(0);
  expect(collapsed.hero).toBeLessThanOrEqual(80);
});

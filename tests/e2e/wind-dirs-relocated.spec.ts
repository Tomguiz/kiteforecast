import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The "Good wind dirs" section sits with the Spot info card (after #spotInfoCard)
// and is READ-ONLY: it shows ONLY the spot's selected directions as static chips.
// There is no per-user toggle — direction changes go through "Edit for all" only.

test('the wind-dirs selector sits after the spot-info card in the DOM', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const order = await page.evaluate(() => {
    const sic = document.getElementById('spotInfoCard')!;
    const lwd = document.getElementById('locWindDirs')!;
    // compareDocumentPosition: FOLLOWING (4) means lwd comes after sic
    return (sic.compareDocumentPosition(lwd) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  expect(order).toBe(true);
});

test('renders ONLY the selected directions as chips (no unselected/hardcoded buttons)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  const chips = await page.evaluate(() => {
    // Select W (270) and NW (315) only.
    setWindDirs([270, 315]);
    const els = Array.from(document.querySelectorAll('#shoreBtns .s-btn'));
    return {
      count: els.length,
      labels: els.map((e) => e.textContent),
      degs: els.map((e) => (e as HTMLElement).dataset.deg),
      allActive: els.every((e) => e.classList.contains('active')),
      allSpans: els.every((e) => e.tagName === 'SPAN'),      // static, not <button>
      hasOnclick: els.some((e) => (e as HTMLElement).getAttribute('onclick')),
    };
  });

  expect(chips.count).toBe(2);                     // only the 2 selected, not 8
  expect(chips.labels).toEqual(['W', 'NW']);
  expect(chips.degs).toEqual(['270', '315']);
  expect(chips.allActive).toBe(true);              // all shown chips are "glowy"
  expect(chips.allSpans).toBe(true);               // rendered as static spans
  expect(chips.hasOnclick).toBeFalsy();            // no click handlers
});

test('the chips are non-interactive — clicking one does not change windDirs', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  const result = await page.evaluate(() => {
    setWindDirs([270, 315]);
    const chip = document.querySelector('#shoreBtns .s-btn[data-deg="270"]') as HTMLElement;
    const before = [...windDirs].sort((a, b) => a - b);
    chip.click();                                   // must be a no-op
    const after = [...windDirs].sort((a, b) => a - b);
    return { before, after, stillTwoChips: document.querySelectorAll('#shoreBtns .s-btn').length };
  });

  expect(result.after).toEqual(result.before);      // unchanged
  expect(result.stillTwoChips).toBe(2);
});

test('toggleWindDir (the old per-user override) no longer exists', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const gone = await page.evaluate(() => typeof (window as any).toggleWindDir === 'undefined');
  expect(gone).toBe(true);
});

import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// The interactive "Good wind dirs" selector was moved out of the forecast
// header to sit with the Spot info card (after #spotInfoCard in the DOM). It
// must (a) live after the spot-info card, and (b) still work: toggling a
// direction must update windDirs and re-render the forecast.

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

test('the relocated selector still toggles a direction and re-filters the forecast', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  const result = await page.evaluate(() => {
    // minimal forecast state so renderGrid has data and toggleWindDir re-renders
    const D = '2026-06-27';
    const m = new Map<number, any>();
    for (let h = 9; h <= 16; h++) m.set(h, { kn: 20, dir: 315, code: 0, gustKn: 26 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'Test Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [0],
      temperature_2m_max: [22], temperature_2m_min: [15], windgusts_10m_max: [13],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    windDirs = new Set();
    renderGrid();

    // click the NW (315°) button in the relocated selector
    const nw = document.querySelector('#shoreBtns .s-btn[data-deg="315"]') as HTMLButtonElement;
    const before = windDirs.has(315);
    nw.click();
    const after = windDirs.has(315);
    const active = nw.classList.contains('active');
    return { found: !!nw, before, after, active };
  });

  expect(result.found).toBe(true);
  expect(result.before).toBe(false);
  expect(result.after).toBe(true);     // toggle added the direction
  expect(result.active).toBe(true);    // button reflects the active state
});

import { test, expect } from '../fixtures/auth';

// Regression test for: homepage "good days" badge disagreeing with the spot
// detail page. The badge is computed into a separate 1-hour cache (chipFxCache)
// that goes stale when Open-Meteo revises the forecast, so the homepage could
// say "no wind this week" while the detail page shows a good day.
//
// Fix: opening a spot reconciles that spot's chip cache from the SAME fresh
// data the detail page just fetched, so the two views always agree.

// Riverwoods Beachclub — a static SPOT with good dirs W(270)/NW(315).
const SPOT = { name: 'Riverwoods Beachclub', lat: 51.3627, lon: 3.3062 };

// Build an Open-Meteo forecast where day index 2 has a clearly rideable
// window: hours 14–17 at ~18kn (>=15kn => speedTier 1) from the west (270°,
// matches the spot's good dirs), no rain. Every other day is dead calm.
function buildForecast() {
  const days = ['2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'];
  const time: string[] = [];
  const windspeed_10m: number[] = [];
  const winddirection_10m: number[] = [];
  const windgusts_10m: number[] = [];
  const weather_code: number[] = [];
  const temperature_2m: number[] = [];
  for (const d of days) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      // ~18 knots = ~9.26 m/s. Good window only on 2026-06-28, hours 14..17.
      const isGoodWindow = d === '2026-06-28' && h >= 14 && h <= 17;
      windspeed_10m.push(isGoodWindow ? 9.26 : 0.5);
      winddirection_10m.push(270); // due west — matches good dirs
      windgusts_10m.push(isGoodWindow ? 11 : 1);
      weather_code.push(0); // clear sky, never rainy
      temperature_2m.push(20);
    }
  }
  return {
    latitude: SPOT.lat, longitude: SPOT.lon, timezone: 'Europe/Brussels',
    hourly: { time, temperature_2m, weather_code, windspeed_10m, winddirection_10m, windgusts_10m },
    daily: {
      time: days,
      weather_code: days.map(() => 0),
      temperature_2m_max: days.map(() => 24),
      temperature_2m_min: days.map(() => 14),
      windgusts_10m_max: days.map(() => 20),
      // sunrise early, sunset late so the 14–17 window is always daylight
      sunrise: days.map((d) => `${d}T05:30`),
      sunset: days.map((d) => `${d}T22:00`),
    },
  };
}

test('opening a spot reconciles its homepage badge with the fresh forecast', async ({ gotoApp, page }) => {
  const forecast = buildForecast();

  // Mock Open-Meteo forecast + marine BEFORE navigation.
  await page.route(/.*api\.open-meteo\.com\/v1\/forecast.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast) }));
  await page.route(/.*marine-api\.open-meteo\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hourly: { time: [], wave_height: [], wave_period: [], wave_direction: [] } }) }));

  await gotoApp('signedIn');

  // Seed a STALE chip cache entry: 0 good days for this spot, under the spot's
  // real dirs key. This mimics a badge computed before the forecast revised up.
  await page.evaluate((s) => {
    const key = `${s.lat},${s.lon}|270,315`;
    // @ts-expect-error app globals
    chipFxCache[key] = 0;
    // @ts-expect-error app globals
    chipBestCache[key] = { dateStr: null, peakKn: 0, startHr: null, nextDateStr: null, nextStartHr: null, nextPeakKn: 0, spotName: s.name, spot: { ...s, dirs: [270, 315] }, days10: [] };
  }, SPOT);

  // Sanity: before opening the spot, the badge would read the stale 0.
  const staleVal = await page.evaluate((s) => {
    // @ts-expect-error app globals
    return _chipCacheGet(s.lat, s.lon, [270, 315])?.val;
  }, SPOT);
  expect(staleVal).toBe(0);

  // Open the spot detail page (same path the user took to see the good day).
  await page.evaluate((s) => {
    // @ts-expect-error app global
    return pickSpot({ name: s.name, lat: s.lat, lon: s.lon, dirs: [270, 315] });
  }, SPOT);

  // Wait for the detail grid to render with the rideable-day summary.
  await expect(page.locator('#locSub')).toContainText('rideable', { timeout: 5000 });

  // After reconciliation, the chip cache for this spot must reflect the fresh
  // forecast: at least 1 good day, and a nextDateStr of 2026-06-28.
  const reconciled = await page.evaluate((s) => {
    // @ts-expect-error app globals
    const hit = _chipCacheGet(s.lat, s.lon, [270, 315]);
    // @ts-expect-error app globals
    const best = chipBestCache[`${s.lat},${s.lon}|270,315`];
    return { qualDays: hit?.val, nextDateStr: best?.nextDateStr };
  }, SPOT);

  expect(reconciled.qualDays).toBeGreaterThanOrEqual(1);
  expect(reconciled.nextDateStr).toBe('2026-06-28');
});

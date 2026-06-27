import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

// Bug: the daily forecast card derived its weather icon + "RAIN" rating from
// Open-Meteo's daily weather_code, which summarises the whole 24h (incl. night).
// So a night-only shower (e.g. rain at 03:00, dry all day) made the card show
// "🌧 RAIN" while the hourly detail — which uses per-hour codes — showed no rain
// during daylight. The card and the hourly view disagreed.
//
// daylightWeatherCode(dayHours) returns the most significant weather code among
// the DAYLIGHT hours only, so the daily card matches the hourly detail.

test('daylightWeatherCode ignores night rain and reflects the daylight hours', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const code = await page.evaluate(() => {
    // daylight hours all dry: clear / partly cloudy / overcast (codes 0..3)
    const dayHours = [
      { code: 1 }, { code: 2 }, { code: 3 }, { code: 2 }, { code: 1 },
    ];
    return daylightWeatherCode(dayHours);
  });
  // most significant DAYLIGHT code is 3 (overcast) — NOT a rain code (>=51)
  expect(code).toBe(3);
  expect(code).toBeLessThan(51);
});

test('daylightWeatherCode surfaces real daylight rain', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const code = await page.evaluate(() => {
    // a genuinely rainy midday hour (code 61) among otherwise cloudy daylight
    const dayHours = [{ code: 2 }, { code: 3 }, { code: 61 }, { code: 2 }];
    return daylightWeatherCode(dayHours);
  });
  expect(code).toBe(61);
});

test('the daily card icon + rating ignore night-only rain (matches the hourly detail)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { icon, rating } = await page.evaluate(() => {
    const D = '2026-06-28';
    const m = new Map<number, any>();
    // daylight hours 6..21 all DRY (overcast, code 3); wind 13kn so peakDay>=10
    // (this makes rateDay's rain branch reachable — proving the rating bug too)
    for (let h = 6; h <= 21; h++) m.set(h, { kn: 13, dir: 90, code: 3, gustKn: 16 });
    // night rain at 03:00 / 04:00 — present in the map but outside daylight
    m.set(3, { kn: 9, dir: 90, code: 65, gustKn: 12 });
    m.set(4, { kn: 9, dir: 90, code: 53, gustKn: 12 });
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [65], // API daily code = heavy rain (the night shower)
      temperature_2m_max: [24], temperature_2m_min: [16], windgusts_10m_max: [12],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    windDirs = new Set([315]); // wind blows from 90 (E), not in W/NW → not rideable, but not rain either
    renderGrid();
    const card = document.querySelector('#forecastGrid .day-card')!;
    return {
      icon: card.querySelector('.wx-icon')?.textContent || '',
      rating: card.querySelector('.rating-badge')!.textContent || '',
    };
  });
  // night-only rain → daylight is dry → neither the icon nor the rating says rain
  expect(icon).not.toMatch(/🌧|🌦|⛈/);
  expect(rating).not.toMatch(/Rain/i);
});

test('the 16-day overview card emoji ignores night-only rain', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const emoji = await page.evaluate(() => {
    const D = '2026-06-28';
    const m = new Map<number, any>();
    for (let h = 6; h <= 21; h++) m.set(h, { kn: 13, dir: 315, code: 1, gustKn: 16 }); // dry, mainly clear
    m.set(3, { kn: 9, dir: 315, code: 65, gustKn: 12 }); // night rain
    cachedHrMap = new Map([[D, m]]);
    cachedLoc = { name: 'T', latitude: 51.35, longitude: 3.28, country: 'BE' };
    cachedWx = { daily: {
      time: [D], weather_code: [65], // API daily = heavy rain (night)
      temperature_2m_max: [24], temperature_2m_min: [16], windgusts_10m_max: [12],
      sunrise: [`${D}T05:54`], sunset: [`${D}T21:29`],
    } };
    windDirs = new Set([315]);
    renderGrid();
    return document.querySelector('#tdsCols .tds-day-card .tds-dc-wx')!.textContent || '';
  });
  expect(emoji).not.toMatch(/🌧|🌦|⛈/);
});

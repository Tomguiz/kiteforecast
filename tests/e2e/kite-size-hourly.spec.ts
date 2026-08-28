import { test, expect } from '../fixtures/auth';

// The size belongs next to each hour, not only as one badge at the top: the
// wind moves through the day and so does the kite. And because the model is
// banded rather than a curve, the column holds one size across a run of hours
// instead of flickering 13/12/13/12 over a couple of knots.

const FX = ['2026-08-29','2026-08-30','2026-08-31'];
function forecast(knByHour: (h: number) => number) {
  const time: string[] = [], ws: number[] = [], wd: number[] = [], wg: number[] = [], wc: number[] = [], t2: number[] = [];
  for (const d of FX) for (let h = 0; h < 24; h++) {
    time.push(`${d}T${String(h).padStart(2,'0')}:00`);
    ws.push(knByHour(h) / 1.94384); wd.push(270); wg.push(knByHour(h) / 1.94384 + 2); wc.push(0); t2.push(20);
  }
  return { latitude: 51.3627, longitude: 3.3062, timezone: 'Europe/Brussels',
    hourly: { time, temperature_2m: t2, weather_code: wc, windspeed_10m: ws, winddirection_10m: wd, windgusts_10m: wg },
    daily: { time: FX, weather_code: FX.map(()=>0), temperature_2m_max: FX.map(()=>22), temperature_2m_min: FX.map(()=>14),
      windgusts_10m_max: FX.map(()=>25), sunrise: FX.map(d=>`${d}T05:30`), sunset: FX.map(d=>`${d}T22:00`) } };
}

// a day that wanders 18..22 kn — one band — then climbs past 32 into the next two
const wander = (h: number) => h < 10 ? 18 : h < 14 ? 21 : h < 18 ? 19 : 36;

async function openDay(page: any, opts: { noProfile?: boolean } = {}) {
  await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r: any) =>
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(forecast(wander)) }));
  await page.route(/marine-api\.open-meteo\.com/, (r: any) =>
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ hourly:{ time:[], wave_height:[], wave_period:[], wave_direction:[] } }) }));
  await page.evaluate((noProfile: boolean) => {
    const p = loadProfile();
    // the point of the last test is a rider who never filled this in
    p.weightKg = noProfile ? null : 80;
    p.kiteLevel = noProfile ? null : 'Advanced';
    p.powerPref = noProfile ? null : 'overpowered';
    saveProfile(p);
  }, !!opts.noProfile);
  await page.evaluate(async () => {
    await (window as any)._spotsReady;
    await pickSpot({ name:'Riverwoods Beachclub', loc:'Knokke-Heist, Belgium', lat:51.3627, lon:3.3062, dirs:[0,45,270,315] });
  });
  await page.waitForTimeout(1800);
  await page.evaluate(() => openModal(cachedWx.daily.time[0], 0));
  await page.waitForTimeout(500);
}

const sizes = (page: any) => page.evaluate(() =>
  [...document.querySelectorAll('.m-row .c-kite')].map(e => (e.textContent || '').trim()));

test('every hour carries its own size', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openDay(page);
  const s = await sizes(page);
  expect(s.length).toBeGreaterThan(5);
  expect(s.some(x => x === '12')).toBe(true);
});

test('the size holds across a run of hours inside one band', async ({ gotoApp, page }) => {
  // 18 → 21 → 19 kn all sit in the 14-22 band, so the rider is not asked to
  // land and swap kite because the forecast moved two knots.
  await gotoApp('signedIn');
  await openDay(page);
  const s = (await sizes(page)).filter(x => x && x !== '—');
  const runs = s.reduce((acc: string[], v) => (acc[acc.length-1] === v ? acc : [...acc, v]), []);
  expect(runs.length).toBeLessThanOrEqual(3);   // 12, then 8 — not a dozen swaps
});

test('it does change when the wind genuinely changes band', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openDay(page);
  const s = await sizes(page);
  expect(new Set(s.filter(x => x && x !== '—')).size).toBeGreaterThan(1);
});

test('an hour below the model’s floor shows a dash, not a guess', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await openDay(page, { noProfile: true });
  const s = await sizes(page);
  expect(s.every(x => x === '—')).toBe(true);
});

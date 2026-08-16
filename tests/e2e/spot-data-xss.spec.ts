import { test, expect } from '../fixtures/auth';

// Spot names, locations and spot-info fields are user-influenced: anyone can
// request a spot, an admin approves the *spot*, not every character of its
// name, and the result lands in SPOTS / spot_overrides / spot_info for EVERY
// visitor. So every place that renders them must treat them as text, and every
// link built from them must be an http(s) URL — never `javascript:`.

const IMG = '<img src=x onerror=alert(1)>';
const SVG = '<svg onload=alert(1)></svg>';
// A name that also breaks any handler built by splicing it into a JS string
// literal inside an attribute — the quotes escape the literal and the attribute.
const QUOTED = `O'Brien's "beach" <img src=x onerror=alert(1)>`;

test.use({ viewport: { width: 390, height: 844 } });

// Seed a rendered spot page (same shape as the other renderGrid specs).
function seedSpot(
  page: import('@playwright/test').Page,
  loc: { name: string; country?: string; admin1?: string },
) {
  return page.evaluate((loc) => {
    windDirs = new Set([315]);
    const days: string[] = [], codes: number[] = [];
    cachedHrMap = new Map();
    for (let d = 0; d < 3; d++) {
      const ds = new Date(Date.UTC(2026, 5, 27 + d)).toISOString().slice(0, 10);
      days.push(ds); codes.push(0);
      const m = new Map<number, any>();
      for (let h = 9; h <= 17; h++) m.set(h, { kn: 18, dir: 315, code: 0, gustKn: 27, temp: 20 });
      cachedHrMap.set(ds, m);
    }
    cachedLoc = { name: loc.name, latitude: 51.35, longitude: 3.28,
      country: loc.country ?? 'BE', admin1: loc.admin1 ?? '' };
    cachedWx = { daily: { time: days, weather_code: codes,
      temperature_2m_max: days.map(() => 22), temperature_2m_min: days.map(() => 15),
      windgusts_10m_max: days.map(() => 13.9),
      sunrise: days.map((d) => `${d}T05:54`), sunset: days.map((d) => `${d}T21:29`) } };
    renderGrid();
  }, loc);
}

test('the spot header renders a scripted spot name as text, not an element', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedSpot(page, { name: IMG });

  expect(await page.locator('#locName img').count()).toBe(0);
  await expect(page.locator('#locName')).toContainText('<img src=x');
});

test('the spot header renders scripted country and region as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedSpot(page, { name: 'Knokke', country: IMG, admin1: SVG });

  expect(await page.locator('#locName img').count()).toBe(0);
  expect(await page.locator('#locName svg').count()).toBe(0);
});

test('the day modal subtitle renders a scripted spot name as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await seedSpot(page, { name: IMG });
  await page.evaluate(() => openModal(cachedWx.daily.time[0], 0));

  expect(await page.locator('#mSub img').count()).toBe(0);
  await expect(page.locator('#mSub')).toContainText('<img src=x');
});

test('search autocomplete renders scripted spot names and locations as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(({ img, svg }) => {
    renderAC([{ name: img, loc: svg, lat: 51.3, lon: 3.2, dirs: [] }], 'kite');
  }, { img: IMG, svg: SVG });

  expect(await page.locator('#acDropdown img').count()).toBe(0);
  expect(await page.locator('#acDropdown svg').count()).toBe(0);
  await expect(page.locator('#acDropdown')).toContainText('<img src=x');
});

test('the autocomplete pending-spot row renders a scripted name as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate((img) => {
    localStorage.setItem('kf_pendingSpots', JSON.stringify([{ name: img, nameLower: img.toLowerCase() }]));
    renderAC([], '<img');
  }, IMG);

  expect(await page.locator('#acDropdown img').count()).toBe(0);
  await expect(page.locator('#acDropdown')).toContainText('<img src=x');
});

test('the map popup renders a scripted spot name and location as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(({ img, svg }) => {
    const host = document.createElement('div');
    host.id = '__popupHost';
    // The popup body is built without Leaflet so it can be asserted directly.
    host.appendChild(spotMapPopupNode({ name: img, loc: svg, lat: 51.3, lon: 3.2 }, 0));
    document.body.appendChild(host);
  }, { img: IMG, svg: SVG });

  expect(await page.locator('#__popupHost img').count()).toBe(0);
  expect(await page.locator('#__popupHost svg').count()).toBe(0);
  await expect(page.locator('#__popupHost')).toContainText('<img src=x');
});

test('the map popup button still opens the spot it belongs to', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const picked = await page.evaluate(async () => {
    await window._spotsReady;
    const target = SPOTS[2];
    (window as any).__picked = null;
    (window as any).pickSpot = (s: any) => { (window as any).__picked = s?.name; };
    const host = document.createElement('div');
    host.appendChild(spotMapPopupNode(target, 2));
    document.body.appendChild(host);
    host.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 200));
    return { expected: target.name, got: (window as any).__picked };
  });
  expect(picked.got).toBe(picked.expected);
});

test('the stats panel renders scripted spot names as text', async ({ gotoApp, page }) => {
  await gotoApp('premium', {
    sessions: [
      { spot_name: IMG, session_date: '2026-06-01', session_peak_kn: 28,
        session_hours: 3, session_rating: '🔥', session_wind_dir: SVG, duration_h: 3 },
    ],
  });
  await page.evaluate(() => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    (window as any).isPremium = () => true;
  });
  await page.evaluate(() => renderStats());

  // Best-session card + "sessions by spot" bars + wind-direction chips.
  expect(await page.locator('#ppStatsContent img').count()).toBe(0);
  expect(await page.locator('#ppStatsContent svg').count()).toBe(0);
  const text = await page.locator('#ppStatsContent').evaluate((el) => el.textContent || '');
  expect(text).toContain('<img src=x');
});

test('the spot-info card renders scripted business fields as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: {
      spot_name: 'Knokke', verified: true, description: IMG, address: SVG,
      contact_name: IMG, spot_tip: IMG, website: 'https://kiteclub.example/book',
    },
  });
  await page.evaluate(() => renderSpotInfoCard('Knokke'));

  expect(await page.locator('#spotInfoCard img').count()).toBe(0);
  expect(await page.locator('#spotInfoCard svg').count()).toBe(0);
  const text = await page.locator('#spotInfoCard').evaluate((el) => el.textContent || '');
  expect(text).toContain('<img src=x');
});

test('spot-info links drop a javascript: URL but keep a real http(s) one', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: {
      spot_name: 'Knokke', verified: true,
      website: 'javascript:alert(1)',
      lesson_url: 'JaVaScRiPt:alert(2)',
      gear_url: 'https://gear.example/rent',
      instagram_url: 'data:text/html,<script>alert(3)</script>',
      facebook_url: 'facebook.example/kiteclub',
    },
  });
  await page.evaluate(() => renderSpotInfoCard('Knokke'));

  const hrefs = await page.locator('#spotInfoCard a').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href') || ''));
  expect(hrefs.some((h) => /^\s*(javascript|data):/i.test(h))).toBe(false);
  // The legitimate links survive — the fix is a scheme allowlist, not a purge.
  expect(hrefs.some((h) => h.startsWith('https://gear.example/rent'))).toBe(true);
  expect(hrefs.some((h) => h.startsWith('https://facebook.example/kiteclub'))).toBe(true);
});

test('a spot-info CTA still reports its click with the spot it belongs to', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: { spot_name: QUOTED, verified: true, livecam_url: 'https://youtu.be/abcdefghijk' },
  });
  await page.evaluate((name) => {
    (window as any).__tracked = null;
    (window as any).trackCtaClick = (...args: unknown[]) => { (window as any).__tracked = args; };
    return renderSpotInfoCard(name);
  }, QUOTED);
  await page.locator('#spotInfoCard .webcam-embed').dispatchEvent('click');

  expect(await page.evaluate(() => (window as any).__tracked)).toEqual([QUOTED, 'livecam']);
});

test('safeHttpUrl allows http(s), assumes https for bare hosts, drops the rest', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const out = await page.evaluate(() => [
    safeHttpUrl('https://a.example/x'),
    safeHttpUrl('http://a.example/x'),
    safeHttpUrl('a.example/x'),
    safeHttpUrl('javascript:alert(1)'),
    safeHttpUrl(' JAVASCRIPT:alert(1)'),
    safeHttpUrl('data:text/html,<script>alert(1)</script>'),
    safeHttpUrl('vbscript:msgbox(1)'),
    safeHttpUrl(''),
    safeHttpUrl(null),
  ]);
  expect(out[0]).toBe('https://a.example/x');
  expect(out[1]).toBe('http://a.example/x');
  expect(out[2]).toBe('https://a.example/x');
  expect(out.slice(3)).toEqual(['', '', '', '', '', '']);
});

test('the notifications list renders a scripted spot name as text', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    localStorage.setItem('kf_notifs', JSON.stringify([{
      id: 'n1', type: 'spot', spotName: img, spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }]));
  }, IMG);
  await page.evaluate(() => renderNotifList());

  expect(await page.locator('#ppNotifList img').count()).toBe(0);
  await expect(page.locator('#ppNotifList')).toContainText('<img src=x');
});

test('a notification day chip still toggles the spot it belongs to', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    (window as any).__toggled = null;
    (window as any).toggleSpotDay = (name: string, i: number) => { (window as any).__toggled = [name, i]; };
    localStorage.setItem('kf_notifs', JSON.stringify([{
      id: 'n1', type: 'spot', spotName: img, spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }]));
  }, QUOTED);
  await page.evaluate(() => renderNotifList());
  await page.locator('#ppNotifList .pp-day-chip').first().dispatchEvent('click');

  expect(await page.evaluate(() => (window as any).__toggled)).toEqual([QUOTED, 0]);
});

test('the attendance sheet renders a scripted spot name as text', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    (window as any).isPremium = () => true;
    openAttendSheet('2026-06-27', 0, img, 51.35, 3.28);
  }, IMG);

  expect(await page.locator('#attendSheet img').count()).toBe(0);
  await expect(page.locator('#attendSheet')).toContainText('<img src=x');
});

test('the attendance sheet still confirms for the spot it was opened with', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    (window as any).isPremium = () => true;
    (window as any).__confirmed = null;
    (window as any).confirmAttendance = (...args: unknown[]) => { (window as any).__confirmed = args; };
    openAttendSheet('2026-06-27', 0, img, 51.35, 3.28);
  }, QUOTED);
  await page.getByRole('button', { name: /Confirm/ }).click();

  expect(await page.evaluate(() => (window as any).__confirmed))
    .toEqual(['2026-06-27', QUOTED, 51.35, 3.28]);
});

test('the claim form renders a scripted spot name as text and claims that exact spot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    cachedLoc = { name: img, latitude: 51.35, longitude: 3.28, country: 'BE' };
    (window as any).__claimed = null;
    (window as any).submitClaim = (name: string) => { (window as any).__claimed = name; };
  }, QUOTED);
  await page.evaluate(() => renderMySpot());

  expect(await page.locator('#ppMySpotContent img').count()).toBe(0);
  await expect(page.locator('#ppMySpotContent')).toContainText('<img src=x');
  // The panel section itself is collapsed in this harness — dispatch directly.
  await page.locator('#claimSubmitBtn').dispatchEvent('click');
  expect(await page.evaluate(() => (window as any).__claimed)).toBe(QUOTED);
});

test('a verified claim card renders scripted business fields as text and drops a javascript: website', async ({ gotoApp, page }) => {
  await gotoApp('signedIn', {
    claims: [{
      id: 'c1', spot_name: QUOTED, status: 'verified', verified: true,
      business_name: IMG, description: SVG, website: 'javascript:alert(1)',
      created_at: '2026-06-01T00:00:00Z',
    }],
  });
  await page.evaluate((name) => {
    _authSession = { user: { id: 'test-uid', email: 'test@example.com' } } as any;
    cachedLoc = { name, latitude: 51.35, longitude: 3.28, country: 'BE' };
    (window as any).__edited = null;
    (window as any).openOwnerEditFromMySpot = (n: string) => { (window as any).__edited = n; };
  }, QUOTED);
  await page.evaluate(() => renderMySpot());

  expect(await page.locator('#ppMySpotContent img').count()).toBe(0);
  expect(await page.locator('#ppMySpotContent svg').count()).toBe(0);
  const hrefs = await page.locator('#ppMySpotContent a').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href') || ''));
  expect(hrefs.some((h) => /^\s*javascript:/i.test(h))).toBe(false);
  // The edit button still targets the spot it belongs to.
  await page.locator('#ppMySpotContent .owner-edit-btn').dispatchEvent('click');
  expect(await page.evaluate(() => (window as any).__edited)).toBe(QUOTED);
});

test('the spot attributes block renders scripted values as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut', {
    spotInfo: {
      spot_name: 'Knokke', verified: true,
      disciplines: [IMG], facilities: [IMG], water_type: SVG, crowd_level: IMG,
    },
  });
  await page.evaluate(() => renderSpotInfoCard('Knokke'));

  expect(await page.locator('#spotInfoCard img').count()).toBe(0);
  expect(await page.locator('#spotInfoCard svg').count()).toBe(0);
});

test('the compare bar renders scripted spot names as text', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate((img) => {
    _authSession = { user: { id: 'test-uid' } } as any;
    const spot = (n: string, lat: number) => ({ name: n, loc: 'x', lat, lon: 3.2, dirs: [270] });
    (window as any).loadFavs = () => [spot(img, 51.1), spot('Knokke', 51.2)];
    const days10 = [{ dateStr: '2026-06-27', goodHours: 4, qh: 4, peakKn: 22, startHr: 10 }];
    (window as any).chipBestForSpot = (lat: number) => ({
      spot: spot(lat === 51.1 ? img : 'Knokke', lat),
      spotName: lat === 51.1 ? img : 'Knokke', days10,
    });
    _compareOpen = true;
    renderCompareBar();
  }, IMG);

  expect(await page.locator('#compareBar img').count()).toBe(0);
  await expect(page.locator('#compareBar')).toContainText('<img src=x');
});

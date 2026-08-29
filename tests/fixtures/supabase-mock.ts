import type { Page, Route } from '@playwright/test';
import {
  profileRow, friendshipsRows, publicProfileRows, spotSuggestionRows,
  emptyArray, TEST_EMAIL,
} from './seed-data';

export type MockOptions = {
  email?: string;
  // Forecast payload the shared-cache function should return. Tests that need
  // particular weather pass it here rather than routing Open-Meteo themselves:
  // the app no longer calls Open-Meteo, and a route registered before gotoApp
  // would lose to this fixture's own anyway.
  forecastWx?: unknown;
  isPremium?: boolean;
  isAdmin?: boolean;
  favourites?: unknown[];
  usersRpc?: unknown[];   // rows returned by the admin_list_users RPC
  friendsNotifRpc?: unknown[]; // rows returned by the friends_notif_status RPC
  adminFavourites?: Record<string, unknown[]>;
  adminReminders?: Record<string, unknown[]>;
  overrides?: unknown[];  // rows returned for spot_overrides (admin-added spots)
  sessions?: unknown[];   // rows returned for session_attendances (stats)
  reminders?: unknown[];  // rows returned for reminders (Notifications schedule)
  friendships?: unknown[];// rows returned for friendships (defaults to the seeded pair)
  spotInfo?: unknown;     // row returned for spot_info (.single() → one object)
  claims?: unknown[];     // rows returned for spot_claims (My Spot panel)
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// A structurally complete 16-day forecast that is deliberately UNRIDEABLE:
// light wind, all day, every day. Its job is only to keep the app off the
// network and out of its error state. It must never manufacture a session,
// or every "nothing coming up" assertion in the suite would start failing
// against weather no test asked for. Tests that need wind pass forecastWx.
function cannedForecast() {
  const days: string[] = [];
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let d = 0; d < 16; d++) {
    const x = new Date(base); x.setDate(x.getDate() + d);
    days.push(x.toISOString().slice(0, 10));
  }
  const time: string[] = [], temp: number[] = [], code: number[] = [],
        ws: number[] = [], wd: number[] = [], wg: number[] = [];
  for (const d of days) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      temp.push(17); code.push(1);
      ws.push(3);                            // m/s ≈ 6 kn — well under the floor
      wd.push(250); wg.push(4);
    }
  }
  return {
    hourly: { time, temperature_2m: temp, weather_code: code,
              windspeed_10m: ws, winddirection_10m: wd, windgusts_10m: wg },
    daily: {
      time: days,
      weather_code: days.map(() => 1),
      temperature_2m_max: days.map(() => 21),
      temperature_2m_min: days.map(() => 13),
      windgusts_10m_max: days.map(() => 4),
      sunrise: days.map(d => `${d}T06:00`),
      sunset: days.map(d => `${d}T21:00`),
    },
  };
}

// Content-Range carries the row count for `count:'exact'` queries, but it is not
// a CORS-safelisted response header: cross-origin JS cannot read it unless the
// server says so, and every supabase call here is cross-origin. Real Supabase
// sends this; without it supabase-js sees count === null and each count query
// silently reads as zero — which is exactly how a badge test can pass while the
// badge shows nothing.
const countHeaders = (n: number) => ({
  'Content-Range': `0-${Math.max(0, n - 1)}/${n}`,
  'Access-Control-Expose-Headers': 'Content-Range',
});

// Per-table canned responses for GET/SELECT.
function tableResponse(table: string, opts: MockOptions): unknown {
  const email = opts.email ?? TEST_EMAIL;
  switch (table) {
    case 'profiles':
      return [profileRow({ email, is_premium: !!opts.isPremium, is_admin: !!opts.isAdmin })];
    case 'public_profiles':
      return publicProfileRows;
    case 'friendships':
      return opts.friendships ?? friendshipsRows(email);
    case 'favourites':
      return opts.favourites ?? emptyArray;
    case 'spot_suggestions':
      return opts.isAdmin ? spotSuggestionRows : emptyArray;
    case 'spot_overrides':
      return opts.overrides ?? emptyArray;
    case 'spot_info':
      return opts.spotInfo ? [opts.spotInfo] : emptyArray;
    case 'session_attendances':
      return opts.sessions ?? emptyArray;
    case 'spot_claims':
      return opts.claims ?? emptyArray;
    case 'reminders':
      return opts.reminders ?? emptyArray;
    case 'spot_update_suggestions':
    case 'tide_cache':
    case 'spot_cta_clicks':
      return emptyArray;
    default:
      return emptyArray;
  }
}

export async function mockSupabase(page: Page, opts: MockOptions = {}) {
  const unmocked: string[] = [];

  // IMPORTANT: Playwright runs the MOST RECENTLY registered matching route
  // first, deferring to earlier ones only via route.fallback(). So register the
  // broad catch-all FIRST and the specific handlers AFTER, so specifics win.

  // Catch-all guard (registered first = lowest priority): any supabase call not
  // handled by a specific route below fails the test loudly.
  await page.route(/.*\.supabase\.co\/.*/, (route) => {
    unmocked.push(route.request().url());
    route.fulfill({ status: 500, body: 'UNMOCKED supabase call' });
  });

  // Auth: empty session — optimistic localStorage path handles signed-in state.
  await page.route(/.*\.supabase\.co\/auth\/v1\/.*/, (route) => {
    const url = route.request().url();
    if (url.includes('/user')) return json(route, { id: 'test-uid', email: opts.email ?? TEST_EMAIL });
    return json(route, { access_token: null, user: null });
  });

  // Edge functions: succeed with a benign payload.
  await page.route(/.*\.supabase\.co\/functions\/v1\/.*/, (route) =>
    json(route, { ok: true, url: 'https://stripe.test/checkout' }));

  // Forecasts now come from the shared cache function, so the benign payload
  // above no longer answers them: the app would see no `wx`, fall back to
  // Open-Meteo, and every spot-opening test would make a real network call.
  // That turned the suite from 1.5 minutes into 33. Serve a real shape here.
  await page.route(/.*\.supabase\.co\/functions\/v1\/forecast(\?|$)/, (route) =>
    json(route, {
      wx: opts.forecastWx ?? cannedForecast(),
      marine: null, fetched_at: new Date().toISOString(), source: 'cache',
    }));

  // REST: respond per table. GET/HEAD return rows (+ a Content-Range header so
  // supabase-js can read counts for head:true queries). Writes echo success.
  await page.route(/.*\.supabase\.co\/rest\/v1\/.*/, (route) => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;            // /rest/v1/<table>
    const table = path.split('/rest/v1/')[1]?.split('?')[0] ?? '';
    if (method === 'GET' || method === 'HEAD') {
      // Admin Users expand: per-email favourites/reminders keyed by the email filter.
      const url = req.url();
      const emailMatch = url.match(/email=eq\.([^&]+)/);
      const wantEmail = emailMatch ? decodeURIComponent(emailMatch[1]) : null;
      if (wantEmail && table === 'favourites' && opts.adminFavourites) {
        const rows = opts.adminFavourites[wantEmail] ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: countHeaders(rows.length), body: JSON.stringify(rows) });
      }
      if (wantEmail && table === 'reminders' && opts.adminReminders) {
        const rows = opts.adminReminders[wantEmail] ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: countHeaders(rows.length), body: JSON.stringify(rows) });
      }
      let rows = tableResponse(table, opts) as unknown[];
      // A HEAD request is a count query (`count:'exact', head:true`). The row
      // fetches below are filtered client-side by the app, so tableResponse
      // ignoring query params is harmless there — but a count is ONLY the
      // number the filters select, so an unfiltered count is meaningless and
      // any assertion on it would pass whatever the code did. Apply the eq
      // filters for counts, and only for counts, so the badge tests bite.
      if (method === 'HEAD' && Array.isArray(rows)) {
        const eqs = [...url.matchAll(/[?&]([a-z_]+)=eq\.([^&]+)/g)]
          .map(m => [m[1], decodeURIComponent(m[2])] as const)
          .filter(([col]) => col !== 'select');
        rows = rows.filter(r => eqs.every(([col, val]) =>
          String((r as Record<string, unknown>)[col]) === val));
      }
      const n = Array.isArray(rows) ? rows.length : 0;
      // .single()/.maybeSingle() send Accept: application/vnd.pgrst.object+json
      // and expect a SINGLE OBJECT, not an array. Honour that so the client's
      // `data.field` reads work (else data is an array and fields are undefined).
      const accept = req.headers()['accept'] || '';
      const wantsObject = accept.includes('vnd.pgrst.object');
      const body = wantsObject ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: countHeaders(n),
        body: method === 'HEAD' ? '' : body,
      });
    }
    // RPC calls POST to /rest/v1/rpc/<fn>. Answer the ones the app calls explicitly.
    if (method === 'POST' && path.endsWith('/rpc/admin_list_users')) {
      return json(route, opts.usersRpc ?? []);
    }
    if (method === 'POST' && path.endsWith('/rpc/friends_notif_status')) {
      return json(route, opts.friendsNotifRpc ?? []);
    }
    // INSERT/UPDATE/DELETE — return an empty 200/201
    return json(route, [], method === 'POST' ? 201 : 200);
  });

  return { unmocked };
}

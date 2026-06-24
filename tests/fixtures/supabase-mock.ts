import type { Page, Route } from '@playwright/test';
import {
  profileRow, friendshipsRows, publicProfileRows, spotSuggestionRows,
  emptyArray, TEST_EMAIL,
} from './seed-data';

export type MockOptions = {
  email?: string;
  isPremium?: boolean;
  isAdmin?: boolean;
  favourites?: unknown[];
  usersRpc?: unknown[];   // rows returned by the admin_list_users RPC
  adminFavourites?: Record<string, unknown[]>;
  adminReminders?: Record<string, unknown[]>;
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Per-table canned responses for GET/SELECT.
function tableResponse(table: string, opts: MockOptions): unknown {
  const email = opts.email ?? TEST_EMAIL;
  switch (table) {
    case 'profiles':
      return [profileRow({ email, is_premium: !!opts.isPremium, is_admin: !!opts.isAdmin })];
    case 'public_profiles':
      return publicProfileRows;
    case 'friendships':
      return friendshipsRows(email);
    case 'favourites':
      return opts.favourites ?? emptyArray;
    case 'spot_suggestions':
      return opts.isAdmin ? spotSuggestionRows : emptyArray;
    case 'spot_info':
    case 'spot_overrides':
    case 'spot_update_suggestions':
    case 'spot_claims':
    case 'reminders':
    case 'session_attendances':
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
          headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows) });
      }
      if (wantEmail && table === 'reminders' && opts.adminReminders) {
        const rows = opts.adminReminders[wantEmail] ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows) });
      }
      const rows = tableResponse(table, opts) as unknown[];
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
        headers: { 'Content-Range': `0-${Math.max(0, n - 1)}/${n}` },
        body: method === 'HEAD' ? '' : body,
      });
    }
    // RPC calls POST to /rest/v1/rpc/<fn>. Answer admin_list_users explicitly.
    if (method === 'POST' && path.endsWith('/rpc/admin_list_users')) {
      return json(route, opts.usersRpc ?? []);
    }
    // INSERT/UPDATE/DELETE — return an empty 200/201
    return json(route, [], method === 'POST' ? 201 : 200);
  });

  return { unmocked };
}

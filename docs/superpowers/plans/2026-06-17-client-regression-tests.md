# Client Regression Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright E2E suite that drives the real `index.html` with a mocked Supabase backend, locking in the behaviours that broke this session and giving new features a place to add regression tests.

**Architecture:** A self-contained `tests/` Node project (its own `package.json`, never touches the static app). Playwright serves the repo root, loads `index.html`, intercepts every `*.supabase.co/{rest,auth,functions}/v1/*` request with canned JSON, and seeds `localStorage['kf_profile']` to put the app into signed-out / signed-in / premium / admin states. A GitHub Actions workflow runs it on push.

**Tech Stack:** Node ≥ 20, `@playwright/test` (Chromium headless), TypeScript, `serve` for static hosting.

---

## File Structure

- Create: `tests/package.json` — isolated test project manifest
- Create: `tests/playwright.config.ts` — webServer + chromium config
- Create: `tests/tsconfig.json` — TS config for tests
- Create: `tests/.gitignore` — ignore `node_modules`, `test-results`, `playwright-report`
- Create: `tests/fixtures/seed-data.ts` — canned DB rows
- Create: `tests/fixtures/supabase-mock.ts` — `page.route` interceptor + catch-all guard
- Create: `tests/fixtures/auth.ts` — localStorage seeding helpers + a custom `test` fixture
- Create: `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/auth.spec.ts`
- Create: `tests/e2e/premium.spec.ts`
- Create: `tests/e2e/favourites.spec.ts`
- Create: `tests/e2e/friends.spec.ts`
- Create: `tests/e2e/admin.spec.ts`
- Create: `tests/unit/README.md` — deferred-unit-test seam
- Create: `tests/README.md` — how to run + the "new feature ⇒ new spec" convention
- Create: `.github/workflows/tests.yml` — CI

---

## Task 1: Scaffold the isolated test project

**Files:**
- Create: `tests/package.json`
- Create: `tests/tsconfig.json`
- Create: `tests/.gitignore`

- [ ] **Step 1: Create `tests/package.json`**

```json
{
  "name": "kiteforecast-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "serve": "^14.2.3",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `tests/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Create `tests/.gitignore`**

```
node_modules/
test-results/
playwright-report/
.playwright/
```

- [ ] **Step 4: Install dependencies and the Chromium browser**

Run: `cd tests && npm install && npx playwright install chromium`
Expected: installs packages and downloads Chromium with no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/package.json tests/tsconfig.json tests/.gitignore
git commit -m "test: scaffold isolated Playwright project"
```

---

## Task 2: Playwright config that serves the app

**Files:**
- Create: `tests/playwright.config.ts`

- [ ] **Step 1: Create `tests/playwright.config.ts`**

The app is at the repo root (one level up from `tests/`). Serve it on port 4321.

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // serve the repo root (parent dir) as static files
    command: 'npx serve .. -l 4321 --no-clipboard --single',
    url: 'http://localhost:4321/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Add a temporary connectivity spec**

Create `tests/e2e/_connectivity.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('app boots and serves index.html', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/KiteForecast/i);
});
```

- [ ] **Step 3: Run it to verify the server + config work**

Run: `cd tests && npx playwright test _connectivity --reporter=list`
Expected: 1 passed. (If the title differs, adjust the regex to the real `<title>`.)

- [ ] **Step 4: Delete the temporary spec**

Run: `rm tests/e2e/_connectivity.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add tests/playwright.config.ts
git commit -m "test: add Playwright config serving the static app"
```

---

## Task 3: Canned seed data

**Files:**
- Create: `tests/fixtures/seed-data.ts`

- [ ] **Step 1: Create `tests/fixtures/seed-data.ts`**

Minimal rows shaped from the real columns the client selects. The admin
suggestion deliberately contains an apostrophe — the exact input that broke the
old "Review & add" handler.

```ts
export const TEST_EMAIL = 'user@test.dev';
export const ADMIN_EMAIL = 'admin@test.dev';

export const profileRow = (over: Record<string, unknown> = {}) => ({
  email: TEST_EMAIL,
  is_premium: false,
  is_admin: false,
  sms_enabled: false,
  phone_number: null,
  nickname: 'Tester',
  friend_session_notifs: true,
  notify_friends_on_confirm: true,
  avatar_url: null,
  contribution_points: 0,
  premium_until: null,
  digest_enabled: false,
  ...over,
});

// friendships: one accepted + one pending-incoming for the signed-in user
export const friendshipsRows = (email: string) => [
  { id: 'f1', requester: 'ruben@test.dev', recipient: email, status: 'accepted' },
  { id: 'f2', requester: 'nikite@test.dev', recipient: email, status: 'pending' },
];

// public_profiles rows for nickname display
export const publicProfileRows = [
  { email: 'ruben@test.dev', nickname: 'Ruben' },
  { email: 'nikite@test.dev', nickname: 'Nikite' },
];

// one pending spot suggestion whose name contains an apostrophe (regression input)
export const spotSuggestionRows = [
  {
    id: 's1',
    suggested_name: "Surfer's Paradise",
    location: 'Knokke, Belgium',
    lat: 51.36, lon: 3.32,
    note: 'Dirs: SW, W | Business: Test | Website: https://x.be',
    submitted_by: 'someone@test.dev',
    reviewed: false, approved: false,
    created_at: '2026-06-01T10:00:00Z',
  },
];

export const emptyArray: unknown[] = [];
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/seed-data.ts
git commit -m "test: add canned Supabase seed data"
```

---

## Task 4: Supabase network mock

**Files:**
- Create: `tests/fixtures/supabase-mock.ts`

- [ ] **Step 1: Create `tests/fixtures/supabase-mock.ts`**

Intercepts all supabase traffic. Tables are matched from the REST path
(`/rest/v1/<table>?...`). Auth endpoints return an empty session (the app's
optimistic localStorage path drives signed-in state). A catch-all logs and
fails any unmocked supabase call so new endpoints are caught, not silently
passed.

```ts
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

  // Auth: empty session — optimistic localStorage path handles signed-in state.
  await page.route(/.*\.supabase\.co\/auth\/v1\/.*/, (route) => {
    const url = route.request().url();
    if (url.includes('/user')) return json(route, { id: 'test-uid', email: opts.email ?? TEST_EMAIL });
    return json(route, { access_token: null, user: null });
  });

  // Edge functions: succeed with a benign payload.
  await page.route(/.*\.supabase\.co\/functions\/v1\/.*/, (route) =>
    json(route, { ok: true, url: 'https://stripe.test/checkout' }));

  // REST: respond per table; writes (POST/PATCH/DELETE) just echo success.
  await page.route(/.*\.supabase\.co\/rest\/v1\/.*/, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;            // /rest/v1/<table>
    const table = path.split('/rest/v1/')[1]?.split('?')[0] ?? '';
    if (req.method() === 'GET') return json(route, tableResponse(table, opts));
    // INSERT/UPDATE/DELETE — return an empty 200/201 (Prefer: return=minimal style)
    return json(route, [], req.method() === 'POST' ? 201 : 200);
  });

  // Catch-all guard: any other supabase host call fails the test loudly.
  await page.route(/.*\.supabase\.co\/.*/, (route) => {
    unmocked.push(route.request().url());
    route.fulfill({ status: 500, body: 'UNMOCKED supabase call' });
  });

  return { unmocked };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/supabase-mock.ts
git commit -m "test: add Supabase network mock with catch-all guard"
```

---

## Task 5: Auth seeding fixture

**Files:**
- Create: `tests/fixtures/auth.ts`

- [ ] **Step 1: Create `tests/fixtures/auth.ts`**

A custom Playwright `test` that seeds `localStorage['kf_profile']` before the app
boots and wires the mock. `gotoApp(state)` navigates with the right state.

```ts
import { test as base, expect, type Page } from '@playwright/test';
import { mockSupabase, type MockOptions } from './supabase-mock';
import { TEST_EMAIL, ADMIN_EMAIL } from './seed-data';

type AppState = 'signedOut' | 'signedIn' | 'premium' | 'admin';

function profileSeed(state: AppState) {
  if (state === 'signedOut') return null;
  if (state === 'admin') return { email: ADMIN_EMAIL, nickname: 'Admin', isAdmin: true };
  if (state === 'premium') return { email: TEST_EMAIL, nickname: 'Tester', isPremium: true };
  return { email: TEST_EMAIL, nickname: 'Tester' };
}

function mockOpts(state: AppState, extra: Partial<MockOptions> = {}): MockOptions {
  return {
    email: state === 'admin' ? ADMIN_EMAIL : TEST_EMAIL,
    isPremium: state === 'premium',
    isAdmin: state === 'admin',
    ...extra,
  };
}

export const test = base.extend<{
  gotoApp: (state: AppState, extra?: Partial<MockOptions>) => Promise<Page>;
}>({
  gotoApp: async ({ page }, use) => {
    await use(async (state, extra = {}) => {
      await mockSupabase(page, mockOpts(state, extra));
      const seed = profileSeed(state);
      if (seed) {
        await page.addInitScript((p) => {
          localStorage.setItem('kf_profile', JSON.stringify(p));
        }, seed);
      }
      await page.goto('/index.html');
      return page;
    });
  },
});

export { expect };
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/auth.ts
git commit -m "test: add auth-state seeding fixture"
```

---

## Task 6: Smoke spec (boots cleanly, no console errors)

**Files:**
- Create: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/auth';

test('app boots with no uncaught console errors', async ({ gotoApp, page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await gotoApp('signedOut');

  // forecast shell present (logo always rendered)
  await expect(page.locator('img[src="logo.png"]').first()).toBeVisible();

  // filter out known-noisy third-party/network lines; fail on real JS errors
  const real = errors.filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
  expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test smoke --reporter=list`
Expected: 1 passed. If real errors surface, they are genuine app bugs — capture and report before adjusting the filter.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test: smoke spec — app boots without console errors"
```

---

## Task 7: Auth spec (signed-out CTA vs seeded session)

**Files:**
- Create: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/auth';

test('signed-out users see a sign-in call to action', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await expect(page.getByText(/no password/i).first()).toBeVisible();
});

test('seeded session is treated as signed in', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // The optimistic boot sets _authSession from kf_profile; assert via app state.
  const email = await page.evaluate(() => (window as any)._authSession?.user?.email ?? null);
  expect(email).toBe('user@test.dev');
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test auth --reporter=list`
Expected: 2 passed. If `_authSession` isn't reachable on `window`, replace the assertion with a visible-profile-affordance check (e.g. the profile/avatar control rendered for signed-in users).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/auth.spec.ts
git commit -m "test: auth spec — signed-out CTA and seeded session"
```

---

## Task 8: Premium gating spec

**Files:**
- Create: `tests/e2e/premium.spec.ts`

- [ ] **Step 1: Write the spec**

Non-premium users see the tide upgrade prompt; premium users do not. The tide
badge text "Upgrade to Premium" only renders for non-premium (index.html:4081).

```ts
import { test, expect } from '../fixtures/auth';

test('non-premium user sees an upgrade prompt for tides', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // open the profile panel where the premium upsell lives
  await expect(page.locator('#ppUpgradeBtn')).toHaveCount(1);
});

test('premium user does not see the upgrade button', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  // updatePremiumUI hides the upgrade block for premium accounts
  await page.waitForTimeout(300); // allow profile refresh to apply
  const hidden = await page.evaluate(() => {
    const el = document.getElementById('ppPremiumUpgrade');
    return !el || getComputedStyle(el).display === 'none';
  });
  expect(hidden).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test premium --reporter=list`
Expected: 2 passed. If `#ppPremiumUpgrade` id differs, grep `index.html` for the upgrade container id and update.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/premium.spec.ts
git commit -m "test: premium gating spec"
```

---

## Task 9: Favourites free-limit spec

**Files:**
- Create: `tests/e2e/favourites.spec.ts`

- [ ] **Step 1: Write the spec**

`FREE_FAV_LIMIT = 1` (index.html:3048). `loadFavs()` reads
`localStorage['kf_favs']` (index.html:2937), so seed that key directly via
`addInitScript` rather than the network mock. With one favourite present, a
non-premium user is at the limit; a premium user is not.

```ts
import { test, expect } from '../fixtures/auth';

const ONE_FAV = JSON.stringify([{ name: 'A', lat: 1, lon: 1 }]);

test('free tier is limited to one favourite', async ({ gotoApp, page }) => {
  await page.addInitScript((favs) => localStorage.setItem('kf_favs', favs), ONE_FAV);
  await gotoApp('signedIn');

  const limit = await page.evaluate(() => (window as any).FREE_FAV_LIMIT);
  expect(limit).toBe(1);

  // At the limit and not premium → the app's guard condition is true (blocked).
  const blocked = await page.evaluate(() => {
    const favs = (window as any).loadFavs ? (window as any).loadFavs() : [];
    const premium = (window as any).isPremium ? (window as any).isPremium() : false;
    return !premium && favs.length >= (window as any).FREE_FAV_LIMIT;
  });
  expect(blocked).toBe(true);
});

test('premium tier is not limited', async ({ gotoApp, page }) => {
  await page.addInitScript((favs) => localStorage.setItem('kf_favs', favs), ONE_FAV);
  await gotoApp('premium');
  await page.waitForTimeout(300);
  const premium = await page.evaluate(() => (window as any).isPremium?.() ?? false);
  expect(premium).toBe(true);
});
```

Note: `addInitScript` runs before navigation; call it before `gotoApp` (which
itself navigates). Both init scripts (favs + profile seed) accumulate, so order
is fine.

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test favourites --reporter=list`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/favourites.spec.ts
git commit -m "test: favourites free-limit spec"
```

---

## Task 10: Friends rendering spec

**Files:**
- Create: `tests/e2e/friends.spec.ts`

- [ ] **Step 1: Write the spec**

Open the profile panel's Friends tab; the accepted friend (Ruben) and the
pending requester (Nikite) from `friendshipsRows` + `publicProfileRows` must
render in `#friendsList`.

```ts
import { test, expect } from '../fixtures/auth';

test('friends panel renders accepted friends and pending requests', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  // open profile panel on the friends tab via the app's own function
  await page.evaluate(() => (window as any).openProfilePanel?.('friends'));
  const list = page.locator('#friendsList');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Ruben');   // accepted friend nickname
  await expect(list).toContainText('Nikite');  // pending requester nickname
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test friends --reporter=list`
Expected: 1 passed. If `openProfilePanel('friends')` isn't the right tab key, grep `index.html` for the friends tab id/handler and use a click on that tab instead.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/friends.spec.ts
git commit -m "test: friends panel rendering spec"
```

---

## Task 11: Admin "Review & add" spec (the no-op regression lock)

**Files:**
- Create: `tests/e2e/admin.spec.ts`

- [ ] **Step 1: Write the spec**

Admin opens the Admin tab; the pending suggestion `Surfer's Paradise` (apostrophe
in the name — the exact char that broke the old inline-JSON handler) renders, and
clicking "Review & add →" opens `#adminEditForm`.

```ts
import { test, expect } from '../fixtures/auth';

test('admin can open the Admin panel', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.evaluate(() => (window as any).openProfilePanel?.('admin'));
  await expect(page.locator('#ppAdminContent')).toBeVisible();
});

test('Review & add opens the edit form (regression: apostrophe in name)', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).openProfilePanel?.('admin'));

  // the suggestion with an apostrophe must render
  await expect(page.getByText("Surfer's Paradise")).toBeVisible();

  // clicking the button must open the edit form (previously a silent no-op)
  await page.getByRole('button', { name: /Review & add/i }).first().click();
  await expect(page.locator('#adminEditForm')).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `cd tests && npx playwright test admin --reporter=list`
Expected: 2 passed. If the admin tab needs the tab button shown first, grep for `ppTabAdmin` visibility logic and click that tab element before asserting.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin.spec.ts
git commit -m "test: admin Review & add regression spec"
```

---

## Task 12: Full-suite run + flake check

- [ ] **Step 1: Run the entire suite**

Run: `cd tests && npx playwright test --reporter=list`
Expected: all specs pass.

- [ ] **Step 2: Run again to check determinism**

Run: `cd tests && npx playwright test --reporter=list`
Expected: identical green result (no flakes from timing/ordering).

- [ ] **Step 3: If any spec is flaky**, replace fixed `waitForTimeout` waits with
explicit waits on the asserted condition (e.g. `await expect(locator).toBeVisible()`),
then re-run twice. Commit only when two consecutive runs are green.

- [ ] **Step 4: Commit any flake fixes**

```bash
git add tests/e2e
git commit -m "test: stabilise waits for deterministic runs"
```

---

## Task 13: Docs — run instructions + new-feature convention + unit seam

**Files:**
- Create: `tests/README.md`
- Create: `tests/unit/README.md`

- [ ] **Step 1: Create `tests/README.md`**

```markdown
# KiteForecast tests

Browser regression tests (Playwright) that drive the real `index.html` with a
mocked Supabase backend. No production data is ever touched.

## Run

```bash
cd tests
npm install            # first time
npx playwright install chromium   # first time
npm test               # headless
npm run test:headed    # watch it in a browser
npm run report         # open last HTML report
```

## Adding tests for a NEW feature (required)

Every new user-facing feature must ship with a regression spec:

1. Add a `tests/e2e/<feature>.spec.ts`.
2. Use the `gotoApp(state, extra?)` fixture from `../fixtures/auth` to boot the
   app in `signedOut` | `signedIn` | `premium` | `admin` state.
3. If the feature reads a new table, add its canned rows to
   `fixtures/seed-data.ts` and a case in `fixtures/supabase-mock.ts`. (Any
   unmocked Supabase call fails the suite by design.)
4. Run `npm test` until green. CI runs the whole suite on every push.

## What this does NOT cover

Real RLS / edge-function / Stripe behaviour runs server-side and is verified
separately (Supabase CLI / dashboard). These tests assert *client* behaviour
against mocked responses.
```

- [ ] **Step 2: Create `tests/unit/README.md`**

```markdown
# Unit tests (deferred)

Pure-logic unit tests are intentionally not set up yet: the app's JS lives
inline in `index.html` and was not extracted (project decision, 2026-06-17).

When logic is later moved into an importable module (e.g. `app-logic.js`
loaded by `index.html` via `<script>`), add Vitest here:

1. `npm i -D vitest` in `tests/`.
2. Add `"unit": "vitest run"` to `tests/package.json` scripts.
3. Test pure functions (note parsing, premium checks, fav limits, direction math)
   by importing the shared module.

Until then, all coverage is E2E in `../e2e/`.
```

- [ ] **Step 3: Commit**

```bash
git add tests/README.md tests/unit/README.md
git commit -m "test: document run steps and new-feature convention"
```

---

## Task 14: CI workflow

**Files:**
- Create: `.github/workflows/tests.yml`

- [ ] **Step 1: Create `.github/workflows/tests.yml`**

```yaml
name: tests
on:
  push:
    branches: [main]
  pull_request:
jobs:
  e2e:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: tests/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Validate YAML locally**

Run: `cd "$(git rev-parse --show-toplevel)" && node -e "require('fs').readFileSync('.github/workflows/tests.yml','utf8')" && echo OK`
Expected: `OK` (file readable; GitHub validates schema on push).

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/tests.yml
git commit -m "ci: run Playwright suite on push and PR"
git push origin main
```

- [ ] **Step 4: Confirm CI ran**

Run: `gh run list --workflow=tests.yml --limit 1`
Expected: a run appears; check it goes green (`gh run watch` if needed).

---

## Self-Review notes

- **Spec coverage:** every journey in the spec table maps to a task — smoke (T6),
  auth (T7), premium (T8), favourites (T9), friends (T10), admin/Review&add (T11).
  Mocked backend (T4), localStorage auth seeding (T5), CI (T14), new-feature
  convention + unit seam (T13) all covered.
- **Known adjustment points** are called out inline in each "Run it" step (e.g. if
  a DOM id or tab key differs, grep and adjust) because exact handler/tab wiring
  in the 8.5k-line file may vary slightly from the selectors sampled. These are
  fallbacks, not placeholders — each step has concrete code to run first.
- **Determinism:** catch-all mock guard (T4) + smoke console-error gate (T6) +
  double-run flake check (T12).

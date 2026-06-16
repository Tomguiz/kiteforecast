# KiteForecast — Client Regression Test Suite (Design)

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

A repeatable, deterministic regression suite that exercises the **real
`index.html` client behaviour** in a browser, so that:

1. The bugs that actually shipped this session can never silently return
   (admin "Review & add" no-op, premium gating, friends rendering).
2. Every **new feature** added to the app gets a corresponding spec, and the
   whole suite runs automatically on push.

## Scope

**In scope (now):** Browser end-to-end (E2E) tests with Playwright, driving the
unchanged `index.html`, with the Supabase backend **mocked** at the network
layer.

**Deferred (later):** Vitest unit tests of pure JS logic. Requires extracting
functions out of the 8,576-line `index.html`, which the user chose NOT to do
now. The suite leaves a documented seam (`tests/unit/` placeholder + notes) so
this can be added without rework.

**Out of scope:** Testing real RLS / edge-function / Stripe behaviour. Those run
server-side and are verified separately (manually / via the Supabase CLI as done
this session). The mocked-backend E2E layer asserts *client* behaviour only.

## Architecture

```
tests/
  package.json            # Playwright + @playwright/test only; isolated from the app
  playwright.config.ts    # serves repo root statically, runs chromium headless
  fixtures/
    supabase-mock.ts      # route interception: canned REST/auth/functions responses
    auth.ts               # helpers to seed localStorage['kf_profile'] for signed-out
                          #   / signed-in / premium / admin states
    seed-data.ts          # canned rows: profiles, friendships, spot_suggestions, etc.
  e2e/
    smoke.spec.ts         # app boots, renders forecast shell, no console errors
    auth.spec.ts          # signed-out shows sign-in CTA; seeded session shows profile
    premium.spec.ts       # non-premium sees upgrade prompts; premium unlocks features
    favourites.spec.ts    # free-tier fav limit enforced; premium unlimited
    friends.spec.ts       # friends + pending requests render from mocked data
    admin.spec.ts         # admin sees panel; "Review & add" opens the edit form
  unit/
    README.md             # placeholder: how to add Vitest unit tests once logic
                          #   is extracted from index.html (deferred)
.github/workflows/
  tests.yml               # install, install browsers, run npx playwright test
```

### Tooling versions

- Node ≥ 20 (dev machine has v26). `@playwright/test` latest 1.x, TypeScript.
- Chromium only (headless) for speed; can add firefox/webkit later if needed.
- Static serving: Playwright `webServer` running `npx serve` (or `http-server`)
  on the repo root — no app code change.

### Why this shape

- **`tests/` has its own `package.json`.** The app is a static file with no Node
  project; test tooling stays fully isolated and never alters how the app ships.
- **Static file server.** Playwright's `webServer` serves the repo root so
  `index.html` loads exactly as in production (same relative paths to
  `logo.png`, `manifest.json`, etc.).
- **Network mocking via `page.route()`.** Every request to
  `*.supabase.co/{rest,auth,functions}/v1/*` is intercepted and answered from
  `seed-data.ts`. The app's own supabase-js client runs unchanged; it just never
  reaches the network. Deterministic, offline, zero production risk, no secrets.

### How auth state is simulated (key simplification)

`index.html` boots "optimistically": at startup it reads
`localStorage['kf_profile']`, and if an `email` is present it immediately sets
`_authSession = {user:{email}}` and treats the user as signed in
([index.html init script]). Premium/admin come from `kf_profile.isPremium` /
`.isAdmin`, refreshed from a `profiles` select that we mock.

Therefore the E2E tests do **not** need to simulate the OAuth/OTP token flow.
Each test seeds `localStorage['kf_profile']` before navigation via an
`addInitScript`, putting the app into a precise state:

| State        | Seed                                                          |
|--------------|--------------------------------------------------------------|
| Signed out   | no `kf_profile`                                              |
| Signed in    | `{email}`                                                    |
| Premium      | `{email, isPremium:true}` + mocked `profiles` row            |
| Admin        | `{email, isAdmin:true}` + mocked `profiles` row + suggestions|

The mocked `profiles` select returns the matching flags so the app's refresh
agrees with the seed.

## Test data flow (one example)

`admin.spec.ts` — "Review & add opens the edit form":

1. `addInitScript` seeds `kf_profile = {email:'admin@test', isAdmin:true}`.
2. `supabase-mock` answers:
   - `profiles` select → `{is_admin:true, ...}`
   - `spot_suggestions` select → one canned pending row whose name contains an
     apostrophe (the exact input that broke the old inline-JSON handler).
3. Test opens the profile panel → Admin tab, clicks "Review & add →".
4. Assert `#adminEditForm` becomes visible and is prefilled. (Regression lock
   for the no-op bug fixed this session.)

## Critical journeys covered

| Spec            | Asserts | Locks in (this session's bug) |
|-----------------|---------|-------------------------------|
| smoke           | boots, forecast shell renders, 0 console errors | — |
| auth            | signed-out CTA vs seeded-session profile | — |
| premium         | gated features locked for free, unlocked for premium | premium gating |
| favourites      | free-tier limit enforced, premium unlimited | — |
| friends         | accepted + pending render from mocked rows | friends list rendering |
| admin           | panel visible for admin; "Review & add" opens form | the no-op click bug |

## Error handling / determinism

- Any unmocked `*.supabase.co` request **fails the test** (a `page.route`
  catch-all returns 500 and the test asserts no such call happened) — so a new
  feature hitting a new endpoint is caught, not silently passed.
- `smoke.spec.ts` fails on any uncaught console error, catching JS syntax/runtime
  regressions across the whole file on every run.
- Tests are independent: each seeds its own state; no shared mutable fixtures.

## "Run it for all new features" — the workflow

1. **CI:** `.github/workflows/tests.yml` runs the full suite on every push/PR.
2. **Convention (documented in `tests/README.md`):** each new user-facing
   feature adds or extends a spec in `tests/e2e/`. PRs are expected to keep the
   suite green. A short checklist in the README states this.
3. **Local:** `cd tests && npm test` runs everything headless in ~seconds.

## Risks & mitigations

- **Mock drift** (mocks diverge from real Supabase response shapes): keep canned
  responses minimal and shaped from real payloads observed in the code; the
  catch-all guard surfaces newly-required endpoints.
- **Selector brittleness** (inline styles, generated markup): prefer text /
  role / stable `id` selectors already present in `index.html` (e.g.
  `#adminEditForm`, `#ppUpgradeBtn`), not CSS-class chains.
- **No real-backend coverage:** explicitly accepted; server-side behaviour is
  verified out-of-band. Documented so it isn't mistaken for full coverage.

## Non-goals

- No refactor of `index.html`.
- No unit tests yet (seam left for later).
- No testing of email templates or cron jobs.

# KiteForecast tests

Browser regression tests (Playwright) that drive the real `index.html` with a
mocked Supabase backend. No production data is ever touched.

## Run

```bash
cd tests
npm install                        # first time
npx playwright install chromium    # first time
npm test                           # headless
npm run test:headed                # watch it in a browser
npm run report                     # open last HTML report
```

## How it works

- A static server serves the repo root; the test loads `index.html` unchanged.
- `fixtures/supabase-mock.ts` intercepts every `*.supabase.co/{rest,auth,functions}/v1/*`
  request and answers from `fixtures/seed-data.ts`. Any **unmocked** supabase
  call fails the test loudly (catch-all guard).
- Auth state is simulated by seeding `localStorage['kf_profile']` before the app
  boots (the app boots optimistically from that key) — no OAuth/OTP flow needed.
- App functions/values live as top-level names in a non-module `<script>`, so in
  `page.evaluate` reference them **bare** (`openProfilePanel(...)`), not on
  `window`.

## Adding tests for a NEW feature (required)

Every new user-facing feature must ship with a regression spec:

1. Add a `tests/e2e/<feature>.spec.ts`.
2. Use the `gotoApp(state, extra?)` fixture from `../fixtures/auth` to boot the
   app in `signedOut` | `signedIn` | `premium` | `admin` state.
3. If the feature reads a new table, add its canned rows to
   `fixtures/seed-data.ts` and a case in `fixtures/supabase-mock.ts`.
4. Run `npm test` until green. CI runs the whole suite on every push.

## What this does NOT cover

Real RLS / edge-function / Stripe behaviour runs server-side and is verified
separately (Supabase CLI / dashboard). These tests assert *client* behaviour
against mocked responses.

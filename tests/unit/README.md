# Unit tests

Run with `npm run unit` (Vitest). CI runs them as the `unit` job.

Scope today is **edge-function logic only** — code that lives in importable
modules under `supabase/functions/`. It was added on 2026-08-15 after the
weekly digest mailed "No sessions this week" for days the app showed as
rideable: the digest's copy of the rideability rule had drifted from the
app's, and nothing caught it because edge functions have no E2E coverage.

`session-logic.test.ts` pins the digest's session detection to the app's rule
in `index.html` (`hourQualifies` / `dayGoodHours`). **If you change one, change
the other** — that divergence is the bug these tests exist to prevent.

The app's own JS is still inline in `index.html` and was not extracted
(project decision, 2026-06-17), so it remains covered by E2E in `../e2e/`.
If that JS is later moved into an importable module, add its tests here too.

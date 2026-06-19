# Backend tests

Two layers, complementing the Playwright UI suite in `../e2e/`.

## 1. RLS invariants (`rls-invariants.sql`)

Asserts the row-level-security model holds — anon can't read PII, non-admins
see only their own profile, the protect-columns trigger exists, admin-only
policies are in place. Each check `RAISE EXCEPTION`s on violation, so the whole
script fails loudly on a regression. Read-only; no data is mutated.

Run (needs the linked Supabase project + CLI):

```bash
supabase db query -f tests/backend/rls-invariants.sql --linked
# expect: "rls-invariants: ALL PASSED"
```

## 2. Edge-function security gates (`../e2e/edge-functions.spec.ts`)

Playwright HTTP smoke tests that hit the deployed functions and assert their
auth gates (verify-premium / stripe-checkout / stripe-portal / spot-autofill all
reject anon with 401). Runs as part of `npm test`. Requires network access (they
hit the live functions with the public anon key — no secrets, read-only).

## What's still NOT covered

- The webhook's premium-grant path end-to-end (needs a Stripe test-mode event).
- The protect-trigger's actual column-preservation on a live write (the SQL test
  only asserts the trigger's presence, to avoid mutating prod data). A future
  local-supabase-stack test could exercise it fully.

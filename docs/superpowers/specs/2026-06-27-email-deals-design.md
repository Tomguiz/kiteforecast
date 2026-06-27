# Forecast-Email Ads (Shop Deals) — Design

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Goal

Show a kitesurf-shop **deal ad** in the weekly digest email — starting with the
sponsor **Billy Kite** (billykite.be). Deals live in a Supabase table; the
`weekly-digest` function picks an active deal, builds an email-safe HTML block,
and passes it to the Make.com email template via a new `[[ad_html]]` merge tag.
Track impressions per deal.

## Architecture context (important)

The digest/reminder emails are NOT rendered or sent in this repo. The Supabase
functions (`weekly-digest`, `process-reminders`) build a JSON payload and POST
it to a **Make.com webhook**; Make.com renders the `emails/*.html` templates
(which use `[[merge]]` tags) and sends the mail. So:
- The **ad selection + HTML** is built in the `weekly-digest` function (code,
  testable, version-controlled).
- The **template** gains one `[[ad_html]]` slot.
- The user must, post-merge: apply the migration, redeploy `weekly-digest`, and
  add the `[[ad_html]]` slot in the Make.com digest scenario.

## Scope

- **In scope:** `email_deals` table + Billy Kite seed; `pickDeal()` +
  `buildDealAdHTML()` + impression increment + payload `ad_html` in
  `supabase/functions/weekly-digest/index.ts`; `[[ad_html]]` slot in
  `emails/digest.html`; Deno unit tests for the two pure functions.
- **Out of scope (future):** ads in reminder emails; click tracking / redirect;
  an in-app admin "Deals" management UI (deals are managed via SQL for now).

## Data model — `email_deals`

Idempotent migration in `supabase/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS email_deals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   text        NOT NULL,
  headline    text        NOT NULL,
  body        text,
  image_url   text,
  cta_label   text        NOT NULL DEFAULT 'Shop the deal',
  cta_url     text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  weight      integer     NOT NULL DEFAULT 1,   -- higher = more likely
  starts_at   timestamptz,                       -- null = no lower bound
  ends_at     timestamptz,                       -- null = no upper bound
  impressions integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_deals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "all_select_email_deals" ON email_deals FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- writes are admin-via-SQL / service-role for now (the function uses the
-- service-role key, which bypasses RLS). No public write policy is created.

-- Seed the sponsor deal (idempotent on a stable id is overkill; guard on shop+url)
INSERT INTO email_deals (shop_name, headline, body, cta_label, cta_url, active, weight)
SELECT 'Billy Kite', 'Gear up at Billy Kite', 'Kites, boards & wetsuits from your local Belgian kite shop — sponsor of KiteForecast.', 'Shop Billy Kite →', 'https://billykite.be', true, 1
WHERE NOT EXISTS (SELECT 1 FROM email_deals WHERE cta_url='https://billykite.be');
```

The `weekly-digest` function reads/writes via the **service-role key**, so RLS
does not block selection or the impression update.

## Selection — `pickDeal(deals, nowMs)`

A pure function (export for testing) taking the fetched rows and a timestamp:

1. Filter to `active === true` AND `(starts_at == null || starts <= now)` AND
   `(ends_at == null || ends >= now)`.
2. If none → return `null`.
3. Weighted-random pick by `weight` (default 1). Determinism for tests: accept an
   optional `rng = Math.random` parameter so tests can inject a fixed value.

In the function body: fetch `email_deals` once per run (not per recipient),
`pickDeal(deals, Date.now())`. If a deal is picked, build its HTML once and reuse
it for every recipient in that run. Count how many digests actually included the
deal (a `dealImpressions` counter incremented alongside `sent` whenever
`ad_html` is non-empty), then after the send loop do ONE
`UPDATE email_deals SET impressions = impressions + dealImpressions WHERE id = <picked>`
— a single round-trip rather than N. So impressions ≈ digests that included the
deal.

## Ad HTML — `buildDealAdHTML(deal)`

Pure function returning an email-safe, table-based HTML block matching the
digest's dark theme (`#141b27` panel, `#5dd4f0` accent), or `''` when `deal` is
null. Contents: a small "DEAL" / sponsor label, `shop_name`, `headline`, optional
`body`, optional `image_url`, and a CTA button (`cta_label` → `cta_url`). All
values HTML-escaped (a tiny `esc()` helper) since they come from the DB.

The function adds `ad_html` to the Make payload (`''` when no deal).

## Template slot — `emails/digest.html`

Add the `[[ad_html]]` merge tag between the no-sessions block and the footer CTA
(after `[[no_sessions_html]]`, before the `<!-- CTA -->` row), so the email reads
forecast → relevant deal → check the app. The tag is **empty-safe**: with no
active deal, `ad_html=''` and the email is identical to today.

## Testing

The digest function is Deno/TS — not covered by the Playwright e2e suite. Add
`supabase/functions/weekly-digest/deal.test.ts` (or co-located) with Deno tests:

1. `pickDeal`: returns null for empty/all-inactive/out-of-date-range; returns the
   only active in-range deal; with a fixed `rng`, the weighted pick lands on the
   expected deal (e.g. two deals weights [1,3], rng=0.5 → the heavier one).
2. `buildDealAdHTML`: returns `''` for null; for a deal, the HTML contains the
   shop name, headline, and `cta_url`; HTML-escapes a value containing `<`/`&`.

Run: `deno test supabase/functions/weekly-digest/`. (If `deno` isn't installed
locally, the plan notes it and the tests still serve as the spec of behaviour;
the pure functions can alternatively be smoke-tested by a tiny Node harness.)

Manual/integration (user side, post-deploy): with the migration applied + the
function redeployed + the `[[ad_html]]` slot added in Make, trigger a digest and
confirm the Billy Kite block renders and `impressions` increments.

## Risks / edge cases

- **No active deal:** `pickDeal` returns null → `ad_html=''` → email unchanged.
  No errors.
- **Make template not updated:** if the user hasn't added `[[ad_html]]` to the
  Make scenario yet, the payload field is simply ignored — no breakage, just no
  ad shown. (Documented as a required deploy step.)
- **Impressions accuracy:** counts digests that *included* the deal, not opens.
  Acceptable for a "shown N times" sponsor metric this phase.
- **RLS:** public can SELECT deals (harmless — they're ad content); writes are
  service-role/SQL only, so no anon tampering with `active`/`impressions`.
- **Escaping:** deal fields are admin-entered but still escaped in
  `buildDealAdHTML` to avoid breaking the email HTML.

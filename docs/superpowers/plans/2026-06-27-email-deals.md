# Forecast-Email Ads (Shop Deals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a kitesurf-shop deal ad (sponsor: Billy Kite) in the weekly digest email, driven by an `email_deals` table, with per-deal impression counting.

**Architecture:** A new `email_deals` table (seeded with Billy Kite). The pure ad logic — `pickDeal()` + `buildDealAdHTML()` — lives in a **dependency-free TS module** (`supabase/functions/weekly-digest/deals.ts`) so it can be unit-tested with the repo's existing Node/Playwright tooling (Deno is NOT installed locally). The `weekly-digest` function imports them, adds `ad_html` to its Make.com payload, and increments impressions. The Make template gains one `[[ad_html]]` slot.

**Tech Stack:** Supabase Postgres (`supabase/schema.sql`), Deno edge function (`supabase/functions/weekly-digest/index.ts`), plain-TS pure module, Playwright/Node test runner in `tests/`.

## Global Constraints

- The ad pure-logic module `supabase/functions/weekly-digest/deals.ts` must be **dependency-free** (no Deno globals, no imports) so it is importable by both the Deno function AND a Node test. Pure functions only.
- `pickDeal(deals, nowMs, rng=Math.random)`: filter to `active===true` AND `(starts_at==null || Date.parse(starts_at)<=nowMs)` AND `(ends_at==null || Date.parse(ends_at)>=nowMs)`; if none → `null`; else weighted-random pick by `weight` (default treat missing/≤0 as 1) using `rng()`. `rng` is injectable for deterministic tests.
- `buildDealAdHTML(deal)`: `''` when `deal` is null/undefined; else an email-safe table-based HTML block (dark theme `#141b27` panel, `#5dd4f0` accent) containing the shop name, headline, optional body, optional image, and a CTA `<a href=cta_url>cta_label</a>`. **HTML-escape** every interpolated field via a local `esc()` (`& < > " '`).
- Digest only (not reminders). Impressions-only (no click tracking). Deals managed via SQL (no admin UI) — all per the spec.
- `email_deals` columns (exact): `id uuid pk`, `shop_name text NOT NULL`, `headline text NOT NULL`, `body text`, `image_url text`, `cta_label text NOT NULL DEFAULT 'Shop the deal'`, `cta_url text NOT NULL`, `active boolean NOT NULL DEFAULT true`, `weight integer NOT NULL DEFAULT 1`, `starts_at timestamptz`, `ends_at timestamptz`, `impressions integer NOT NULL DEFAULT 0`, `created_at timestamptz NOT NULL DEFAULT now()`.
- The `[[ad_html]]` template slot must be **empty-safe**: `ad_html=''` → email identical to today.
- Commit after each task. Branch: `feat/email-deals`. Do NOT push (controller finalizes).

---

### Task 1: `email_deals` table + Billy Kite seed

**Files:**
- Modify: `supabase/schema.sql` (append near the other table definitions / end of file)

**Interfaces:**
- Produces: the `email_deals` table + RLS (public SELECT; no public write) + a Billy Kite seed row.

- [ ] **Step 1: Add the table, RLS, and seed**

Append to `supabase/schema.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Email deal ads (shop sponsorships shown in the weekly digest)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_deals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   text        NOT NULL,
  headline    text        NOT NULL,
  body        text,
  image_url   text,
  cta_label   text        NOT NULL DEFAULT 'Shop the deal',
  cta_url     text        NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  weight      integer     NOT NULL DEFAULT 1,
  starts_at   timestamptz,
  ends_at     timestamptz,
  impressions integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_deals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "all_select_email_deals" ON email_deals FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- writes are service-role / SQL only (no public write policy); the weekly-digest
-- function uses the service-role key, which bypasses RLS.

-- Seed the sponsor deal (idempotent: guarded on cta_url)
INSERT INTO email_deals (shop_name, headline, body, cta_label, cta_url, active, weight)
SELECT 'Billy Kite',
       'Gear up at Billy Kite',
       'Kites, boards & wetsuits from your local Belgian kite shop — sponsor of KiteForecast.',
       'Shop Billy Kite →',
       'https://billykite.be',
       true, 1
WHERE NOT EXISTS (SELECT 1 FROM email_deals WHERE cta_url = 'https://billykite.be');
```

- [ ] **Step 2: Sanity-check the SQL parses**

There is no local Postgres to run it against. Visually confirm: balanced `()`,
the `DO $$ … $$` policy guard matches the existing `spot_info` policy pattern in
the same file, and the seed uses `WHERE NOT EXISTS` (idempotent). No command to
run — this is a schema file applied manually on deploy.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(email): email_deals table + Billy Kite seed"
```

---

### Task 2: Pure ad logic module + unit tests

**Files:**
- Create: `supabase/functions/weekly-digest/deals.ts`
- Create: `tests/e2e/email-deals.spec.ts` (Node test importing the pure module — see Step 1 note)

**Interfaces:**
- Produces:
  - `export type Deal = { id:string; shop_name:string; headline:string; body?:string|null; image_url?:string|null; cta_label:string; cta_url:string; active:boolean; weight:number; starts_at?:string|null; ends_at?:string|null }`
  - `export function pickDeal(deals: Deal[], nowMs: number, rng?: ()=>number): Deal | null`
  - `export function buildDealAdHTML(deal: Deal | null): string`

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/email-deals.spec.ts`. It imports the pure module directly
(relative path) and runs as a plain Playwright test file (Playwright uses the
Node test transform, so a `.ts` import of a dependency-free module works without
Deno). NOTE: this test does NOT use `gotoApp`/`page` — it only exercises pure
functions, so it needs no browser. Use the base `@playwright/test`:

```typescript
import { test, expect } from '@playwright/test';
import { pickDeal, buildDealAdHTML, type Deal } from '../../supabase/functions/weekly-digest/deals';

const base: Deal = {
  id: '1', shop_name: 'Billy Kite', headline: 'Gear up', body: null, image_url: null,
  cta_label: 'Shop →', cta_url: 'https://billykite.be', active: true, weight: 1,
  starts_at: null, ends_at: null,
};
const NOW = Date.UTC(2026, 5, 27);

test('pickDeal returns null when there are no active in-range deals', () => {
  expect(pickDeal([], NOW)).toBeNull();
  expect(pickDeal([{ ...base, active: false }], NOW)).toBeNull();
  // out of date range
  expect(pickDeal([{ ...base, starts_at: '2026-07-01T00:00:00Z' }], NOW)).toBeNull();
  expect(pickDeal([{ ...base, ends_at: '2026-06-01T00:00:00Z' }], NOW)).toBeNull();
});

test('pickDeal returns the only active in-range deal', () => {
  const d = pickDeal([{ ...base, id: 'x' }], NOW);
  expect(d?.id).toBe('x');
});

test('pickDeal weights the pick (rng injected, deterministic)', () => {
  const light = { ...base, id: 'light', weight: 1 };
  const heavy = { ...base, id: 'heavy', weight: 3 };
  // total weight 4; cumulative [light:1, heavy:4]. rng=0.5 -> 0.5*4=2 -> falls in heavy.
  expect(pickDeal([light, heavy], NOW, () => 0.5)?.id).toBe('heavy');
  // rng=0.1 -> 0.4 -> falls in light (first bucket up to 1)
  expect(pickDeal([light, heavy], NOW, () => 0.1)?.id).toBe('light');
});

test('buildDealAdHTML returns empty string for null', () => {
  expect(buildDealAdHTML(null)).toBe('');
});

test('buildDealAdHTML renders shop, headline and the CTA url', () => {
  const html = buildDealAdHTML(base);
  expect(html).toContain('Billy Kite');
  expect(html).toContain('Gear up');
  expect(html).toContain('https://billykite.be');
});

test('buildDealAdHTML escapes HTML in fields', () => {
  const html = buildDealAdHTML({ ...base, headline: 'A & B <script>' });
  expect(html).toContain('A &amp; B &lt;script&gt;');
  expect(html).not.toContain('<script>');
});
```

- [ ] **Step 2: Run to verify it fails**

From `tests/`: `npx playwright test e2e/email-deals.spec.ts`
Expected: FAIL — cannot resolve `../../supabase/functions/weekly-digest/deals` (module not created yet).

- [ ] **Step 3: Create the pure module**

Create `supabase/functions/weekly-digest/deals.ts`:

```typescript
export type Deal = {
  id: string; shop_name: string; headline: string;
  body?: string | null; image_url?: string | null;
  cta_label: string; cta_url: string;
  active: boolean; weight: number;
  starts_at?: string | null; ends_at?: string | null;
};

function inRange(d: Deal, nowMs: number): boolean {
  if (d.starts_at && Date.parse(d.starts_at) > nowMs) return false;
  if (d.ends_at && Date.parse(d.ends_at) < nowMs) return false;
  return true;
}

// Pure, dependency-free so it is importable by both the Deno function and a Node test.
export function pickDeal(deals: Deal[], nowMs: number, rng: () => number = Math.random): Deal | null {
  const eligible = (deals || []).filter(d => d.active && inRange(d, nowMs));
  if (!eligible.length) return null;
  const weights = eligible.map(d => (d.weight && d.weight > 0 ? d.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r < 0) return eligible[i];
  }
  return eligible[eligible.length - 1]; // float-rounding fallback
}

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Email-safe, table-based ad block matching the digest's dark theme. '' when no deal.
export function buildDealAdHTML(deal: Deal | null): string {
  if (!deal) return '';
  const img = deal.image_url
    ? `<tr><td style="padding:0 0 12px 0;"><img src="${esc(deal.image_url)}" width="100%" alt="${esc(deal.shop_name)}" style="display:block;border-radius:8px;max-width:100%;"/></td></tr>`
    : '';
  const body = deal.body ? `<p style="margin:6px 0 0 0;font-size:13px;color:#94a3b8;line-height:1.5;">${esc(deal.body)}</p>` : '';
  return `
    <tr>
      <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-bottom:1px solid #1e2535;padding:20px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${img}
          <tr><td>
            <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">Deal &middot; ${esc(deal.shop_name)}</p>
            <p style="margin:4px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#5dd4f0;letter-spacing:.5px;">${esc(deal.headline)}</p>
            ${body}
          </td></tr>
          <tr><td style="padding-top:14px;">
            <a href="${esc(deal.cta_url)}" style="display:inline-block;background:rgba(93,212,240,.12);border:1px solid rgba(93,212,240,.35);border-radius:8px;padding:10px 18px;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:700;color:#5dd4f0;text-decoration:none;">${esc(deal.cta_label)}</a>
          </td></tr>
        </table>
      </td>
    </tr>`;
}
```

- [ ] **Step 4: Run to verify it passes**

From `tests/`: `npx playwright test e2e/email-deals.spec.ts`
Expected: 6 tests pass. If Playwright can't import a `.ts` file from outside the
`tests/` root, fall back to importing via a relative path that resolves
(the path `../../supabase/...` is relative to `tests/e2e/`); confirm
`tests/tsconfig.json`/playwright config don't restrict `rootDir` — if they do,
the minimal fix is to ensure no `include` blocks the import (do NOT move the
production module into tests). If a hard tooling block exists, note it and keep
the test (it still specifies behaviour); the pure module is independently
verifiable by reading.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/weekly-digest/deals.ts tests/e2e/email-deals.spec.ts
git commit -m "feat(email): pickDeal + buildDealAdHTML pure module + tests"
```

---

### Task 3: Wire the ad into the weekly-digest function

**Files:**
- Modify: `supabase/functions/weekly-digest/index.ts`

**Interfaces:**
- Consumes: `pickDeal`, `buildDealAdHTML`, `Deal` from `./deals.ts`.
- Produces: the digest run fetches `email_deals`, picks one deal per run, includes `ad_html` in each recipient's payload, and increments the picked deal's `impressions` once per digest that included it.

- [ ] **Step 1: Import the pure module**

At the top of `supabase/functions/weekly-digest/index.ts`, after the existing
`import { createClient } …` line, add:

```typescript
import { pickDeal, buildDealAdHTML, type Deal } from './deals.ts'
```

(Deno requires the `.ts` extension in the import specifier.)

- [ ] **Step 2: Pick the deal once per run, before the recipient loop**

Inside the `Deno.serve` handler, AFTER `const emails = …` and its empty guard
(~line 137-138) and BEFORE the `for (const email of emails)` loop (~line 154),
add:

```typescript
  // pick one deal for this whole digest run (service-role key bypasses RLS)
  const { data: deals } = await supabase.from('email_deals').select('*')
  const pickedDeal = pickDeal((deals ?? []) as Deal[], Date.now())
  const adHtml = buildDealAdHTML(pickedDeal)
  let dealImpressions = 0
```

- [ ] **Step 3: Add `ad_html` to the payload and count impressions**

In the per-recipient payload object (~line 293, `const payload = { … }`), add the
`ad_html` field. Change:

```typescript
    const payload = {
      notification_type: 'digest',
      email,
      week_start: weekStart,
      total_good_sessions: totalSessions,
      has_sessions: totalSessions > 0,
      spots_html: spotsHtml,
      no_sessions_html: noSessionsHtml,
      home_link: homeLink,
    }
```

to:

```typescript
    const payload = {
      notification_type: 'digest',
      email,
      week_start: weekStart,
      total_good_sessions: totalSessions,
      has_sessions: totalSessions > 0,
      spots_html: spotsHtml,
      no_sessions_html: noSessionsHtml,
      home_link: homeLink,
      ad_html: adHtml,
    }
```

Then, right after the existing `sent++` line (~line 309), add the impression
count (only counts when an ad was actually included):

```typescript
    if (adHtml) dealImpressions++
```

- [ ] **Step 4: Persist impressions after the send loop**

After the `for (const email of emails)` loop closes and BEFORE the final
`return new Response(…)` (~line 312), add:

```typescript
  if (pickedDeal && dealImpressions > 0) {
    await supabase.from('email_deals')
      .update({ impressions: (pickedDeal.impressions ?? 0) + dealImpressions })
      .eq('id', pickedDeal.id)
  }
```

(`pickedDeal.impressions` is the value read at run start; adding the run's count
is a single UPDATE. A tiny race exists if two digest runs overlap — acceptable
for an impressions metric; not worth an RPC increment this phase.)

- [ ] **Step 5: Verify the function still type-checks logically (no local Deno)**

There is no local Deno to run the function. Re-read the diff and confirm:
`pickedDeal`/`adHtml`/`dealImpressions` are declared before use; `ad_html` is in
the payload; the impressions UPDATE references `pickedDeal.id`. The pure module's
tests (Task 2) already cover `pickDeal`/`buildDealAdHTML` behaviour.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/weekly-digest/index.ts
git commit -m "feat(email): wire deal ad into weekly digest + impressions"
```

---

### Task 4: Add the `[[ad_html]]` slot to the digest template

**Files:**
- Modify: `emails/digest.html`

**Interfaces:**
- Consumes: the `ad_html` payload field rendered by Make.com into `[[ad_html]]`.

- [ ] **Step 1: Insert the empty-safe slot**

In `emails/digest.html`, between the `[[no_sessions_html]]` block and the
`<!-- CTA -->` row, add the merge slot with a guiding comment:

```html
    <!-- NO SESSIONS STATE -->
    [[no_sessions_html]]

    <!-- SHOP DEAL AD — pre-rendered HTML from the function; empty when no active deal -->
    [[ad_html]]

    <!-- CTA -->
```

- [ ] **Step 2: Confirm placement (visual read only)**

There is no renderer in-repo (Make.com renders this). Confirm the tag sits after
the spots/no-sessions content and before the footer CTA, and that an empty
`[[ad_html]]` leaves valid table structure (it does — the function emits a full
`<tr>…</tr>` or `''`, both valid between the surrounding `<tr>`s).

- [ ] **Step 3: Commit**

```bash
git add emails/digest.html
git commit -m "feat(email): add [[ad_html]] deal slot to digest template"
```

---

### Task 5: Regression run + deploy notes (NO push)

**Files:** none.

- [ ] **Step 1: Run the email-deals tests + a quick full-suite sanity**

From `tests/`:
- `npx playwright test e2e/email-deals.spec.ts` → 6 pass.
- `npx playwright test` → all pass (the new pure-logic test is additive; nothing
  else changed in the app `index.html`). Note: `admin.spec.ts:113` is a known
  parallel flake — re-run alone if it fails.

- [ ] **Step 2: Report the deploy steps the user must do**

Surface to the user that, after merge, they must:
1. Apply the `email_deals` migration (+ seed) to the live Supabase DB.
2. Redeploy the `weekly-digest` edge function (it now imports `deals.ts` and
   sends `ad_html`).
3. In the **Make.com digest scenario**, add the `[[ad_html]]` merge tag to the
   email template body where the repo's `emails/digest.html` shows it (after the
   spots/no-sessions blocks, before the footer CTA). Until this is done, the
   `ad_html` payload field is simply ignored — no breakage.

- [ ] **Step 3: Do NOT push or open a PR here.** The controller finalizes
  (push + PR) after the whole-branch review.

---

## Self-Review Notes

- **Spec coverage:** table + seed (Task 1); `pickDeal`/`buildDealAdHTML` pure
  module + tests, incl. weighted pick, date filtering, empty→null, escaping
  (Task 2); function wiring + payload `ad_html` + impressions UPDATE (Task 3);
  `[[ad_html]]` empty-safe template slot (Task 4); regression + the 3 deploy
  steps (Task 5). Digest-only / impressions-only / SQL-managed deals all honoured.
- **Placeholder scan:** none — all code is concrete.
- **Type consistency:** `Deal` type, `pickDeal(deals, nowMs, rng?)`,
  `buildDealAdHTML(deal)` defined in Task 2 and consumed in Task 3; `ad_html`
  payload key matches the `[[ad_html]]` template tag (Task 4); `email_deals`
  column names used in the function (`active`, `weight`, `starts_at`, `ends_at`,
  `impressions`, `id`, `cta_url`) match the Task-1 schema.
- **Tooling note:** Deno is not installed locally, so the pure logic is
  deliberately split into a dependency-free module testable via the existing
  Playwright/Node runner; the Deno function itself is verified by reading + the
  pure-module tests, then by the user on redeploy.
- **Verified against real code:** digest fn `Deno.serve` at line 121, `emails`
  guard ~137-138, recipient loop ~154, payload ~293, `sent++` ~309, final return
  ~312; template slot after `[[no_sessions_html]]` before `<!-- CTA -->`.

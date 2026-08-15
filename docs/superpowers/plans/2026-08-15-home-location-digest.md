# Home Location & Nearby-Spot Digest Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user set a home location and opt into a weekly-digest section reporting good sessions at spots within a radius of it, not just at their favourites.

**Architecture:** Move the 391-spot catalogue out of the `index.html` JS array into a `spots` table so the backend can radius-search it. Add home coordinates and an opt-in flag to `profiles`. `weekly-digest` loads active spots, filters by great-circle distance from home, drops favourites, caps at the 10 nearest, and runs the existing shared rideability rule over them.

**Tech Stack:** Supabase (Postgres + Deno edge functions), vanilla JS single-file frontend (`index.html`), Vitest for unit tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-08-15-home-location-digest-design.md`

## Global Constraints

- **Schema is applied by hand.** Every DDL change goes into the relevant `.sql` file in `supabase/` AND is applied live with `supabase db query --linked "<sql>"`. There are no migration files. Verify after applying.
- **`supabase db query` chokes on leading `--` comments** — the CLI parses them as flags. Strip leading comment lines before passing SQL, or the command fails with `unknown flag`.
- **The rideability rule lives in exactly one place:** `supabase/functions/_shared/rideability.ts`. Never re-implement `hourQualifies` or the consecutive-hours rule. Three drifted copies caused the 2026-08-15 outages.
- **`prepend PATH`:** run `export PATH="/opt/homebrew/bin:$PATH"` before any `supabase` or `gh` command.
- **Opt-in default:** `digest_nearby_enabled` defaults to `false`. This changes an existing user's email content; it must never turn on by itself.
- **Radius default:** 120 km. Allowed range 25–200 km.
- **Nearest-N cap:** 10 spots. When spots are dropped by the cap, log the dropped count — never truncate silently.
- **Unit tests:** `cd tests && npm run unit`. **E2E:** `cd tests && npx playwright test`.
- **Deno type-check:** `deno check supabase/functions/weekly-digest/index.ts` must pass. (`check-new-sessions` has 12 pre-existing type errors — do not treat those as regressions.)

---

### Task 1: `spots` table, seeded from the `index.html` catalogue

Creates the server-side catalogue the digest needs, plus a test that fails if the array and the table drift apart.

**Files:**
- Create: `supabase/spots-table.sql`
- Create: `tests/tools/generate-spots-seed.mjs`
- Create: `supabase/seed-spots.sql` (generated)
- Create: `tests/unit/spots-catalogue.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `spots(name text PK, loc text, lat double precision, lon double precision, dirs smallint[], active boolean)`; `parseSpotsArray(html: string): Spot[]` exported from `tests/tools/generate-spots-seed.mjs`, where `Spot = {name, loc, lat, lon, dirs}`.

- [ ] **Step 1: Write the SQL file**

Create `supabase/spots-table.sql`:

```sql
CREATE TABLE IF NOT EXISTS spots (
  name    text PRIMARY KEY,
  loc     text NOT NULL DEFAULT '',
  lat     double precision NOT NULL,
  lon     double precision NOT NULL,
  dirs    smallint[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true
);

ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
SELECT _drop_all_policies('spots');

CREATE POLICY "spots_select_all" ON spots FOR SELECT TO authenticated USING (true);
CREATE POLICY "spots_write_admin" ON spots FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS spots_active_idx ON spots (active);
```

- [ ] **Step 2: Write the seed generator**

Create `tests/tools/generate-spots-seed.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs'

// The catalogue is a JS array literal inside index.html. Parse it by locating
// `const SPOTS=[` and walking brackets to the matching close, then eval the
// literal in a Function — it contains only object literals, no expressions.
export function parseSpotsArray(html) {
  const start = html.indexOf('const SPOTS=[')
  if (start === -1) throw new Error('SPOTS array not found in index.html')
  const open = html.indexOf('[', start)
  let depth = 0, end = -1
  for (let i = open; i < html.length; i++) {
    if (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('unterminated SPOTS array')
  const literal = html.slice(open, end + 1)
  const spots = new Function(`return ${literal}`)()
  return spots.map(s => ({
    name: s.name, loc: s.loc ?? '', lat: s.lat, lon: s.lon, dirs: s.dirs ?? [],
  }))
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

export function toSeedSql(spots) {
  const rows = spots.map(s =>
    `  (${q(s.name)}, ${q(s.loc)}, ${s.lat}, ${s.lon}, '{${s.dirs.join(',')}}', true)`
  ).join(',\n')
  return `INSERT INTO spots (name, loc, lat, lon, dirs, active) VALUES\n${rows}\n` +
    `ON CONFLICT (name) DO UPDATE SET\n` +
    `  loc = EXCLUDED.loc, lat = EXCLUDED.lat, lon = EXCLUDED.lon,\n` +
    `  dirs = EXCLUDED.dirs, active = EXCLUDED.active;\n`
}

// CLI: node tests/tools/generate-spots-seed.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const spots = parseSpotsArray(html)
  writeFileSync(new URL('../../supabase/seed-spots.sql', import.meta.url), toSeedSql(spots))
  console.log(`wrote ${spots.length} spots`)
}
```

- [ ] **Step 3: Write the failing consistency test**

Create `tests/unit/spots-catalogue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSpotsArray, toSeedSql } from '../tools/generate-spots-seed.mjs'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('spots catalogue', () => {
  it('parses every spot out of index.html', () => {
    const spots = parseSpotsArray(html)
    expect(spots.length).toBeGreaterThan(300)
    for (const s of spots) {
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(Number.isFinite(s.lat)).toBe(true)
      expect(Number.isFinite(s.lon)).toBe(true)
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(s.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('has no duplicate spot names (name is the table primary key)', () => {
    const names = parseSpotsArray(html).map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  // The committed seed must match the array. If someone edits SPOTS without
  // regenerating, this fails — that drift is the whole risk of having two copies.
  it('committed seed-spots.sql is up to date with the array', () => {
    const seed = readFileSync(new URL('../../supabase/seed-spots.sql', import.meta.url), 'utf8')
    expect(seed).toBe(toSeedSql(parseSpotsArray(html)))
  })

  it('escapes apostrophes in spot names', () => {
    const sql = toSeedSql([{ name: "L'Almanarre", loc: 'Hyères', lat: 43.09, lon: 6.15, dirs: [90] }])
    expect(sql).toContain("'L''Almanarre'")
  })
})
```

- [ ] **Step 4: Run the test, confirm it fails**

Run: `cd tests && npm run unit -- spots-catalogue`
Expected: FAIL — `supabase/seed-spots.sql` does not exist yet (ENOENT).

- [ ] **Step 5: Generate the seed and re-run**

```bash
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
node tests/tools/generate-spots-seed.mjs
cd tests && npm run unit -- spots-catalogue
```

Expected: PASS, and the generator prints ~391 spots.

- [ ] **Step 6: Apply the table and seed to the live DB**

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
supabase db query --linked "$(cat supabase/spots-table.sql)"
supabase db query --linked "$(cat supabase/seed-spots.sql)"
supabase db query --linked "select count(*) from spots where active"
```

Expected: the count matches the number the generator printed.

- [ ] **Step 7: Commit**

```bash
git add supabase/spots-table.sql supabase/seed-spots.sql tests/tools/generate-spots-seed.mjs tests/unit/spots-catalogue.test.ts
git commit -m "feat(spots): server-side spots catalogue seeded from the app array

The 391-spot catalogue lived only as a JS array in index.html, so the
backend had no spot list to search — spot_overrides holds 13 rows and
only for admin-corrected spots. Add a spots table seeded from the array,
plus a test that fails if the two drift."
```

---

### Task 2: Home-location and nearby-digest columns on `profiles`

**Files:**
- Modify: `supabase/schema.sql` (append the ALTER statements)

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.home_lat double precision`, `profiles.home_lon double precision`, `profiles.home_label text`, `profiles.digest_nearby_enabled boolean NOT NULL DEFAULT false`, `profiles.digest_nearby_km integer NOT NULL DEFAULT 120`.

- [ ] **Step 1: Append the DDL to `supabase/schema.sql`**

```sql
-- Home location for the digest's "near you" section. Nullable: most users
-- never set one, and the nearby section stays off without it.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_lat double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_lon double precision; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN home_label text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Defaults to false on purpose: this changes what an existing user's weekly
-- email contains, so it is opt-in rather than a surprise.
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_enabled boolean NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_km integer NOT NULL DEFAULT 120; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

- [ ] **Step 2: Apply live and verify**

```bash
export PATH="/opt/homebrew/bin:$PATH"
supabase db query --linked "DO \$\$ BEGIN ALTER TABLE profiles ADD COLUMN home_lat double precision; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE profiles ADD COLUMN home_lon double precision; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE profiles ADD COLUMN home_label text; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_enabled boolean NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;
DO \$\$ BEGIN ALTER TABLE profiles ADD COLUMN digest_nearby_km integer NOT NULL DEFAULT 120; EXCEPTION WHEN duplicate_column THEN NULL; END \$\$;"

supabase db query --linked "select column_name, data_type, column_default from information_schema.columns where table_name='profiles' and column_name like 'home_%' or column_name like 'digest_nearby%'"
```

Expected: five rows; `digest_nearby_enabled` default `false`, `digest_nearby_km` default `120`.

**Note:** `protect_profile_columns()` only pins `is_premium`, `is_admin`, the Stripe columns, `contribution_points` and `premium_until`. These new columns are user-writable by design — no trigger change needed.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(profiles): home location + nearby-digest opt-in columns"
```

---

### Task 3: Nearby-spot selection logic

Pure functions, unit-tested, with no DB or network access.

**Files:**
- Create: `supabase/functions/_shared/nearby.ts`
- Create: `tests/unit/nearby.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number`
  - `interface NearbySpot { name: string; loc: string; lat: number; lon: number; dirs: number[]; distanceKm: number }`
  - `selectNearbySpots(spots, home: {lat, lon}, opts: {radiusKm: number, exclude: string[], limit: number}): { selected: NearbySpot[]; droppedByCap: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nearby.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { haversineKm, selectNearbySpots } from '../../supabase/functions/_shared/nearby.ts'

const spot = (name: string, lat: number, lon: number) =>
  ({ name, loc: 'x', lat, lon, dirs: [270] })

// Knokke-Heist, Belgium
const HOME = { lat: 51.3500, lon: 3.2800 }

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(51.35, 3.28, 51.35, 3.28)).toBe(0)
  })

  it('matches a known distance (Knokke → Oostduinkerke ≈ 45km)', () => {
    const d = haversineKm(51.3500, 3.2800, 51.1420, 2.6976)
    expect(d).toBeGreaterThan(40)
    expect(d).toBeLessThan(50)
  })

  it('is symmetric', () => {
    const a = haversineKm(51.35, 3.28, 43.09, 6.15)
    const b = haversineKm(43.09, 6.15, 51.35, 3.28)
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
  })
})

describe('selectNearbySpots', () => {
  const spots = [
    spot('Near1',  51.36, 3.30),   // ~2km
    spot('Near2',  51.14, 2.70),   // ~45km
    spot('Mid',    50.80, 3.20),   // ~62km
    spot('Far',    43.09, 6.15),   // ~1000km
  ]

  it('keeps only spots inside the radius', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2', 'Mid'])
  })

  it('sorts by distance ascending and reports the distance', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(selected[0].name).toBe('Near1')
    expect(selected[0].distanceKm).toBeLessThan(selected[1].distanceKm)
    expect(Number.isFinite(selected[0].distanceKm)).toBe(true)
  })

  it('excludes spots the user already favourites', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: ['Near1'], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near2', 'Mid'])
  })

  it('caps at the limit and reports how many it dropped', () => {
    const { selected, droppedByCap } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 2 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2'])
    expect(droppedByCap).toBe(1)
  })

  it('reports zero dropped when everything fits', () => {
    const { droppedByCap } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(droppedByCap).toBe(0)
  })

  it('returns nothing when no spot is in range', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 1, exclude: [], limit: 10 })
    expect(selected).toEqual([])
  })

  it('matches excluded names exactly, not by prefix', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: ['Near'], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2', 'Mid'])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd tests && npm run unit -- nearby`
Expected: FAIL — cannot resolve `_shared/nearby.ts`.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/nearby.ts`:

```ts
// Spot selection for the digest's "near you" section.
// Pure: no DB, no network — so it is unit-testable without deploying.

export interface CatalogueSpot {
  name: string; loc: string; lat: number; lon: number; dirs: number[]
}
export interface NearbySpot extends CatalogueSpot { distanceKm: number }

const R_EARTH_KM = 6371
const rad = (deg: number) => deg * Math.PI / 180

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function selectNearbySpots(
  spots: CatalogueSpot[],
  home: { lat: number; lon: number },
  opts: { radiusKm: number; exclude: string[]; limit: number },
): { selected: NearbySpot[]; droppedByCap: number } {
  const excluded = new Set(opts.exclude)
  const inRange = spots
    .filter(s => !excluded.has(s.name))
    .map(s => ({ ...s, distanceKm: haversineKm(home.lat, home.lon, s.lat, s.lon) }))
    .filter(s => s.distanceKm <= opts.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  return {
    selected: inRange.slice(0, opts.limit),
    droppedByCap: Math.max(0, inRange.length - opts.limit),
  }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `cd tests && npm run unit`
Expected: all pass, including the pre-existing rideability and session-logic suites.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/nearby.ts tests/unit/nearby.test.ts
git commit -m "feat(digest): nearby-spot selection (haversine + radius + nearest-N cap)"
```

---

### Task 4: Wire the nearby section into `weekly-digest`

**Files:**
- Modify: `supabase/functions/weekly-digest/index.ts`

**Interfaces:**
- Consumes: `selectNearbySpots`, `NearbySpot` from `_shared/nearby.ts`; `fetchForecast`, `getGoodSessions` from `./session-logic.ts`.
- Produces: `nearby_html` and `nearby_count` fields on the Make webhook payload.

- [ ] **Step 1: Add the profile fields to the profiles query**

In `supabase/functions/weekly-digest/index.ts`, change the profile select so home settings come back with the email. Replace:

```ts
  let query = supabase.from('profiles').select('email')
```

with:

```ts
  let query = supabase.from('profiles')
    .select('email,home_lat,home_lon,home_label,digest_nearby_enabled,digest_nearby_km')
```

Then replace:

```ts
  const emails = (profiles ?? []).map((p: any) => p.email)
```

with:

```ts
  const emails = (profiles ?? []).map((p: any) => p.email)
  const profileByEmail = new Map<string, any>()
  for (const p of profiles ?? []) profileByEmail.set(p.email, p)
```

- [ ] **Step 2: Load the spot catalogue once per run**

Immediately after the `overrideDirs` block (the `for (const o of overrides ?? [])` loop), add:

```ts
  // Catalogue for the "near you" section. Loaded once per run, not per user.
  // Only fetched when at least one user in this batch has the section on.
  const anyNearby = (profiles ?? []).some((p: any) =>
    p.digest_nearby_enabled && p.home_lat != null && p.home_lon != null)
  let catalogue: any[] = []
  if (anyNearby) {
    const { data: spotRows } = await supabase
      .from('spots').select('name,loc,lat,lon,dirs').eq('active', true)
    catalogue = spotRows ?? []
  }
```

- [ ] **Step 3: Build nearby forecasts inside the per-user loop**

Directly after the existing `const totalSessions = spotForecasts.reduce(...)` line, add:

```ts
    // ── "Near you": good sessions at catalogue spots around the user's home ──
    // Uses the same getGoodSessions as favourites, so a day can never count as
    // rideable in one section and not the other.
    const prof = profileByEmail.get(email) ?? {}
    const nearbyForecasts: Array<{ spot: string; distanceKm: number; sessions: any[] }> = []
    if (prof.digest_nearby_enabled && prof.home_lat != null && prof.home_lon != null && catalogue.length) {
      const { selected, droppedByCap } = selectNearbySpots(
        catalogue,
        { lat: prof.home_lat, lon: prof.home_lon },
        {
          radiusKm: prof.digest_nearby_km ?? 120,
          exclude: userFavs.map((f: any) => f.spot_name),
          limit: 10,
        },
      )
      if (droppedByCap > 0) {
        console.log(`[digest] ${email}: ${droppedByCap} nearby spot(s) beyond the 10-spot cap were not checked`)
      }
      for (const s of selected) {
        const key = `${s.lat},${s.lon}`
        if (!wxCache.has(key)) {
          try { wxCache.set(key, await fetchForecast(s.lat, s.lon)) }
          catch { wxCache.set(key, null) }
        }
        const wx = wxCache.get(key)
        if (!wx) continue
        const dirs = overrideDirs.get(s.name) ?? s.dirs ?? []
        const sessions = getGoodSessions(wx, dirs, null)
        if (sessions.length) {
          nearbyForecasts.push({ spot: s.name, distanceKm: Math.round(s.distanceKm), sessions })
        }
      }
    }
    const nearbyCount = nearbyForecasts.reduce((n, f) => n + f.sessions.length, 0)
```

- [ ] **Step 4: Add the import**

At the top of the file, alongside the existing `session-logic` import:

```ts
import { selectNearbySpots } from '../_shared/nearby.ts'
```

- [ ] **Step 5: Type-check**

Run: `export PATH="/opt/homebrew/bin:$PATH" && deno check supabase/functions/weekly-digest/index.ts`
Expected: `Check ...` with no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/weekly-digest/index.ts
git commit -m "feat(digest): compute good sessions at spots near the user's home"
```

---

### Task 5: Render the "Near you" email section

**Files:**
- Modify: `supabase/functions/weekly-digest/index.ts`

**Interfaces:**
- Consumes: `nearbyForecasts`, `nearbyCount` from Task 4.
- Produces: payload fields `nearby_html: string`, `nearby_count: number`, `has_nearby: boolean`.

- [ ] **Step 1: Build the section HTML**

After the `noSessionsHtml` assignment, add:

```ts
    // Rendered after favourites so the familiar part of the email never moves.
    const nearbyHtml = nearbyForecasts.length ? `
      <tr>
        <td style="background-color:#0f1520;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:22px 32px 4px 32px;">
          <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">Near you</p>
          <p style="margin:0;font-size:12px;color:#4a5568;">Not in your favourites &mdash; within ${prof.digest_nearby_km ?? 120}&nbsp;km of ${escapeHtml(prof.home_label || 'home')}</p>
        </td>
      </tr>
      ${nearbyForecasts.map(nf => `
      <tr>
        <td style="background-color:#0f1520;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:14px 32px 0 32px;">
          <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#5dd4f0;letter-spacing:1px;">&#128205; ${escapeHtml(nf.spot)}
            <span style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#4a5568;letter-spacing:0;">&nbsp;&middot;&nbsp;${nf.distanceKm} km away</span>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;padding:0 32px 16px 32px;">
          ${nf.sessions.map((sess: any) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background-color:#1a2235;border:1px solid #242d42;border-radius:10px;">
              <tr>
                <td style="padding:12px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="vertical-align:middle;width:52%;">
                        <p style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:18px;color:#ffffff;letter-spacing:1px;">${sess.day_of_week}</p>
                        <p style="margin:2px 0 0 0;font-size:11px;color:#4a5568;">${sess.win_start} &ndash; ${sess.win_end} &middot; ${sess.win_hours}h</p>
                      </td>
                      <td style="vertical-align:middle;text-align:center;width:24%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Avg</p>
                        <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#5dd4f0;line-height:1;">${sess.avg_kn}<span style="font-size:11px;color:#4a5568;"> kn</span></p>
                      </td>
                      <td style="vertical-align:middle;text-align:center;width:24%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4a5568;">Dir</p>
                        <p style="margin:3px 0 0 0;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#4ade80;line-height:1;">${sess.dom_dir} ${sess.dir_arrow}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`).join('')}
        </td>
      </tr>`).join('')}` : ''
```

- [ ] **Step 2: Add the escape helper**

Spot names and the user-supplied `home_label` go into HTML. Add near the top of the file, after the `CORS` constant:

```ts
// Spot names come from the catalogue and home_label is user-supplied; both are
// interpolated into email HTML, so escape them.
const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
```

- [ ] **Step 3: Add the fields to the webhook payload**

In the `payload` object, after `no_sessions_html`, add:

```ts
      nearby_html:  nearbyHtml,
      nearby_count: nearbyCount,
      has_nearby:   nearbyCount > 0,
```

Also change `has_sessions` so a user whose only sessions are nearby does not get the "No sessions this week" block. Replace:

```ts
      has_sessions: totalSessions > 0,
```

with:

```ts
      has_sessions: (totalSessions + nearbyCount) > 0,
```

And replace the `noSessionsHtml` condition — find:

```ts
    const noSessionsHtml = totalSessions === 0 ? `
```

with:

```ts
    const noSessionsHtml = (totalSessions + nearbyCount) === 0 ? `
```

**Note:** `noSessionsHtml` is defined before `nearbyHtml` in the file. Move the nearby computation (Task 4 Step 3) above the `noSessionsHtml` assignment so `nearbyCount` is in scope. Verify with `deno check`.

- [ ] **Step 4: Type-check and deploy**

```bash
export PATH="/opt/homebrew/bin:$PATH"
deno check supabase/functions/weekly-digest/index.ts
supabase functions deploy weekly-digest --project-ref kpwmajtxmcfpakvonimf
```

- [ ] **Step 5: Verify with a real send**

Set a home location on the test account, then send:

```bash
export PATH="/opt/homebrew/bin:$PATH"
supabase db query --linked "update profiles set home_lat=51.35, home_lon=3.28, home_label='Knokke-Heist, Belgium', digest_nearby_enabled=true, digest_nearby_km=120 where email='tom.guisgand@gmail.com'"
```

Then POST to the function with `{"email_filter":"tom.guisgand@gmail.com"}` using the anon key (see `supabase projects api-keys`). Expected: `{"sent":1}` and an email containing a "Near you" section with spots that are not favourites.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/weekly-digest/index.ts
git commit -m "feat(digest): render the 'Near you' email section"
```

---

### Task 6: Home-location field in the profile panel

**Files:**
- Modify: `index.html` (markup near the nickname block at ~line 1490; JS near `saveNickname` at ~line 8250)
- Create: `tests/e2e/home-location.spec.ts`

**Interfaces:**
- Consumes: `profiles.home_lat/home_lon/home_label` from Task 2.
- Produces: globals `findHomeLocation()` and `saveHomeLocation()`; elements `#ppHomeInput`, `#ppHomeStatus`, `#ppHomeFindBtn`.

- [ ] **Step 1: Write the failing E2E spec**

Create `tests/e2e/home-location.spec.ts`:

```ts
import { test, expect } from '../fixtures/auth';

// The home location drives the digest's "near you" section. It reuses the same
// Nominatim geocoder as the spot-suggestion form.
test('finding a home location fills the label and stores coordinates', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ lat: '51.3500', lon: '3.2800', display_name: 'Knokke-Heist, Belgium' }]),
    }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = 'Knokke-Heist';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  await expect(page.locator('#ppHomeStatus')).toContainText('Knokke-Heist, Belgium');

  const stored = await page.evaluate(() => {
    // @ts-expect-error app global
    const p = loadProfile();
    return { lat: p.homeLat, lon: p.homeLon, label: p.homeLabel };
  });
  expect(stored.lat).toBeCloseTo(51.35, 2);
  expect(stored.lon).toBeCloseTo(3.28, 2);
  expect(stored.label).toBe('Knokke-Heist, Belgium');
});

test('a geocoder miss leaves the stored location untouched', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    // @ts-expect-error app global
    const p = loadProfile(); p.homeLat = 1; p.homeLon = 2; p.homeLabel = 'Existing';
    // @ts-expect-error app global
    saveProfile(p);
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = 'zzzzz nowhere';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  await expect(page.locator('#ppHomeStatus')).toContainText("Couldn't find");
  const stored = await page.evaluate(() => {
    // @ts-expect-error app global
    return loadProfile().homeLabel;
  });
  expect(stored).toBe('Existing');
});

test('an empty query does not call the geocoder', async ({ gotoApp, page }) => {
  let called = false;
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) => {
    called = true;
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('ppHomeInput') as HTMLInputElement).value = '   ';
    // @ts-expect-error app global
    return findHomeLocation();
  });

  expect(called).toBe(false);
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd tests && npx playwright test home-location`
Expected: FAIL — `#ppHomeInput` does not exist.

- [ ] **Step 3: Add the markup**

In `index.html`, immediately after the `<p class="pp-note">Unique username …</p>` line and before the `<div style="border-top:1px solid var(--border);margin:4px 0 8px"></div>` that follows it, insert:

```html
        <label class="pp-label" style="margin:8px 0 0 0">Home location</label>
        <div style="display:flex;gap:6px;align-items:center;width:100%">
          <input type="text" id="ppHomeInput" class="pp-input" placeholder="e.g. Knokke-Heist" maxlength="80" style="margin:0;flex:1 1 0;width:0;min-width:0"/>
          <button class="btn pp-save-btn" id="ppHomeFindBtn" onclick="findHomeLocation()" style="margin:0;white-space:nowrap;flex:0 0 auto;width:auto;padding:11px 16px">📍 Find</button>
        </div>
        <span id="ppHomeStatus" style="font-size:.65rem;color:var(--tdim);display:block;margin-top:4px"></span>
        <p class="pp-note" style="margin-top:4px;margin-bottom:6px">Used to find good sessions near you in the weekly digest.</p>
```

- [ ] **Step 4: Add the JS**

In `index.html`, immediately after the closing brace of `saveNickname` (the line `}` before `// ── AUTH ──`), insert:

```js
// ── HOME LOCATION ──────────────────────────────────────────────────────────
// Feeds the digest's "near you" section. Reuses the same Nominatim geocoder as
// the spot-suggestion form; coordinates are stored, the label is for display.
async function findHomeLocation(){
  const q=($('ppHomeInput')?.value||'').trim();
  const status=$('ppHomeStatus'); const btn=$('ppHomeFindBtn');
  if(!q){ showToast('Enter a town or city first'); return; }
  if(btn){ btn.disabled=true; btn.textContent='⏳'; }
  if(status){ status.style.color='var(--tdim)'; status.textContent='Searching…'; }
  try{
    const url='https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q);
    const res=await fetch(url,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(10000)});
    if(!res.ok) throw new Error('http '+res.status);
    const arr=await res.json();
    if(!Array.isArray(arr)||!arr.length){
      if(status){ status.textContent='⚠️ Couldn\'t find that place — try adding the country.'; status.style.color='#f59e0b'; }
      return;
    }
    const top=arr[0];
    const lat=parseFloat(top.lat), lon=parseFloat(top.lon);
    if(isNaN(lat)||isNaN(lon)){ if(status){ status.textContent='⚠️ No coordinates returned — try another search.'; status.style.color='#f59e0b'; } return; }
    await saveHomeLocation(lat, lon, top.display_name||q);
    if(status){ status.textContent='✓ '+(top.display_name||q); status.style.color='#4ade80'; }
  }catch(e){
    if(status){ status.textContent='⚠️ Couldn\'t reach the geocoder — try again.'; status.style.color='#f59e0b'; }
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='📍 Find'; }
  }
}
async function saveHomeLocation(lat, lon, label){
  const p=loadProfile();
  p.homeLat=lat; p.homeLon=lon; p.homeLabel=label;
  saveProfile(p);
  const sb=getSb(); if(!sb||!p.email) return;
  await sb.from('profiles').upsert({email:p.email, home_lat:lat, home_lon:lon, home_label:label},{onConflict:'email'});
  if(typeof renderNearbyToggle==='function') renderNearbyToggle();
}
```

- [ ] **Step 5: Restore the field on profile load**

Find the line `const _ni=$('ppNicknameInput'); if(_ni) _ni.value=_p.nickname||'';` (~line 5368) and add directly after it:

```js
    const _hi=$('ppHomeInput'); if(_hi) _hi.value=_p.homeLabel||'';
```

- [ ] **Step 6: Load the columns from Supabase**

Find the profile select (~line 7857) containing `'is_premium,sms_enabled,phone_number,is_admin,nickname,friend_session_notifs,notify_friends_on_confirm,avatar_url,contribution_points,premium_until,notifs_enabled'` and append `,home_lat,home_lon,home_label,digest_nearby_enabled,digest_nearby_km` inside the string. Then, in the block that copies fields onto `p` (near `p.friendSessionNotifs=...`), add:

```js
    p.homeLat=data.home_lat; p.homeLon=data.home_lon; p.homeLabel=data.home_label;
    p.digestNearbyEnabled=data.digest_nearby_enabled===true;
    p.digestNearbyKm=data.digest_nearby_km||120;
```

- [ ] **Step 7: Run the spec, confirm it passes**

Run: `cd tests && npx playwright test home-location`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/e2e/home-location.spec.ts
git commit -m "feat(profile): home location field, geocoded via Nominatim"
```

---

### Task 7: Nearby-digest toggle and radius control

**Files:**
- Modify: `index.html` (weekly-digest notif card at ~line 1640; JS near `toggleDigest`)
- Create: `tests/e2e/digest-nearby-toggle.spec.ts`

**Interfaces:**
- Consumes: `p.homeLat`/`p.homeLon`/`p.digestNearbyEnabled`/`p.digestNearbyKm` from Task 6.
- Produces: globals `toggleDigestNearby()`, `setDigestNearbyKm(km)`, `renderNearbyToggle()`; elements `#ppNearbyRow`, `#ppNearbyToggle`, `#ppNearbyKm`, `#ppNearbyHint`.

- [ ] **Step 1: Write the failing E2E spec**

Create `tests/e2e/digest-nearby-toggle.spec.ts`:

```ts
import { test, expect } from '../fixtures/auth';

async function seed(page: any, profile: Record<string, unknown>) {
  await page.evaluate((profile: any) => {
    // @ts-expect-error app global
    window.isPremium = () => true;
    // @ts-expect-error app global
    const p = loadProfile();
    Object.assign(p, { email: 'me@example.com' }, profile);
    // @ts-expect-error app global
    saveProfile(p);
    // @ts-expect-error app global
    openProfilePanel('notifs');
    // @ts-expect-error app global
    renderNearbyToggle();
  }, profile);
}

test('the nearby toggle is disabled until a home location is set', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: null, homeLon: null, digestNearbyEnabled: false });

  await expect(page.locator('#ppNearbyHint')).toContainText('home location');
  await expect(page.locator('#ppNearbyToggle')).not.toHaveClass(/on/);
});

test('with a home location set the toggle becomes usable', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke-Heist', digestNearbyEnabled: true, digestNearbyKm: 120 });

  await expect(page.locator('#ppNearbyToggle')).toHaveClass(/on/);
  await expect(page.locator('#ppNearbyHint')).toContainText('Knokke-Heist');
});

test('the radius control shows the saved value', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: true, digestNearbyKm: 150 });

  await expect(page.locator('#ppNearbyKm')).toHaveValue('150');
});

test('toggling off updates the stored profile', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await seed(page, { homeLat: 51.35, homeLon: 3.28, homeLabel: 'Knokke', digestNearbyEnabled: true, digestNearbyKm: 120 });

  await page.evaluate(() => {
    // @ts-expect-error app global
    window.getSb = () => ({ from: () => ({ upsert: async () => ({ error: null }) }) });
    // @ts-expect-error app global
    return toggleDigestNearby();
  });

  const enabled = await page.evaluate(() => {
    // @ts-expect-error app global
    return loadProfile().digestNearbyEnabled;
  });
  expect(enabled).toBe(false);
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd tests && npx playwright test digest-nearby-toggle`
Expected: FAIL — `renderNearbyToggle` is not defined.

- [ ] **Step 3: Add the markup**

In `index.html`, inside the weekly-digest `notif-card`, directly after the `<button class="btn pp-save-btn" id="ppDigestNowBtn" …>` line, insert:

```html
        <div class="notif-row" id="ppNearbyRow" style="border-top:1px solid var(--border);margin-top:10px;padding-top:12px">
          <div class="notif-info">
            <div class="notif-title">Also include sessions near home</div>
            <div class="notif-sub" id="ppNearbyHint"></div>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
              <label class="pp-label" style="margin:0">Radius</label>
              <input type="number" id="ppNearbyKm" class="pp-input" min="25" max="200" step="5" style="margin:0;width:80px;padding:6px 8px" onchange="setDigestNearbyKm(this.value)"/>
              <span style="font-size:.7rem;color:var(--tdim)">km</span>
            </div>
          </div>
          <button class="pp-toggle" id="ppNearbyToggle" onclick="toggleDigestNearby()"><span></span></button>
        </div>
```

- [ ] **Step 4: Add the JS**

Insert after `toggleNotifyFriends` in `index.html`:

```js
// ── DIGEST: SESSIONS NEAR HOME ─────────────────────────────────────────────
// Opt-in: it changes what the weekly email contains, so it never turns itself
// on. Gated on a home location — without coordinates there is nothing to
// search around.
function hasHomeLocation(){
  const p=loadProfile();
  return typeof p.homeLat==='number' && typeof p.homeLon==='number';
}
function renderNearbyToggle(){
  const row=$('ppNearbyRow'); if(!row) return;
  const p=loadProfile();
  const hint=$('ppNearbyHint'), toggle=$('ppNearbyToggle'), km=$('ppNearbyKm');
  if(km) km.value=String(p.digestNearbyKm||120);
  if(hasHomeLocation()){
    if(hint) hint.textContent='Good sessions around '+(p.homeLabel||'your home location');
    if(toggle){ toggle.classList.toggle('on', p.digestNearbyEnabled===true); toggle.style.opacity=''; }
  }else{
    if(hint) hint.textContent='Set a home location in your profile to use this';
    if(toggle){ toggle.classList.remove('on'); toggle.style.opacity='0.4'; }
  }
}
async function toggleDigestNearby(){
  if(!hasHomeLocation()){ showToast('Set a home location in your profile first'); openProfilePanel('profile'); return; }
  const p=loadProfile();
  p.digestNearbyEnabled = p.digestNearbyEnabled===true ? false : true;
  saveProfile(p);
  renderNearbyToggle();
  const sb=getSb(); if(!sb||!p.email) return;
  await sb.from('profiles').upsert({email:p.email, digest_nearby_enabled:p.digestNearbyEnabled},{onConflict:'email'});
  showToast(p.digestNearbyEnabled ? 'Nearby sessions: on' : 'Nearby sessions: off');
}
async function setDigestNearbyKm(val){
  const km=Math.max(25, Math.min(200, parseInt(val,10)||120));
  const p=loadProfile(); p.digestNearbyKm=km; saveProfile(p);
  const el=$('ppNearbyKm'); if(el) el.value=String(km);
  const sb=getSb(); if(!sb||!p.email) return;
  await sb.from('profiles').upsert({email:p.email, digest_nearby_km:km},{onConflict:'email'});
}
```

- [ ] **Step 5: Call the renderer when the panel opens**

Find the line `renderFriendsReach();` added in the premium-gating block and add directly after it:

```js
  renderNearbyToggle();
```

- [ ] **Step 6: Run the spec, confirm it passes**

Run: `cd tests && npx playwright test digest-nearby-toggle`
Expected: 4 passed.

- [ ] **Step 7: Run the whole suite**

```bash
cd tests && npm run unit && npx playwright test
```

Expected: all unit and E2E tests pass.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/e2e/digest-nearby-toggle.spec.ts
git commit -m "feat(digest): opt-in toggle + radius control for sessions near home"
```

---

## Self-Review Notes

**Spec coverage:** `spots` table → Task 1. Profile fields → Task 2. Radius + nearest-N cap with logged drops → Tasks 3–4. Same rideability rule reused → Task 4 Step 3 (calls `getGoodSessions`). "Near you" email section with distances → Task 5. Geocoded home field → Task 6. Opt-in toggle + radius → Task 7. Array/table drift test → Task 1 Step 3.

**Deferred from the spec:** the spec's open question about email length is unresolved — this plan renders every session for each of the 10 nearest spots. If the resulting email is too long in practice, the change is confined to Task 5's `nf.sessions.map(...)`: slice to the single best day.

**Not in scope (per spec):** migrating `index.html` to read the `spots` table, merging `spots` with `spot_overrides`, and nearby-spot reminders.

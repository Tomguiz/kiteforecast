# Home location & nearby-spot sessions in the weekly digest

**Date:** 2026-08-15
**Status:** design, awaiting review

## Problem

The weekly digest only reports sessions at spots the user has explicitly
favourited. A user who has favourited two spots hears nothing about a
cracking day 60 km down the coast, even though the app knows that spot
exists.

The user wants an opt-in mode: *also* tell me about good sessions near
where I live.

## Blocker this design exists to solve

The 391-spot catalogue lives **only in `index.html`**, as a `const SPOTS=[...]`
array at line 2200. Server-side there is no spot catalogue: `spot_overrides`
holds 13 rows, and only for spots an admin has corrected.

`weekly-digest` therefore cannot answer "which spots are within 120 km of this
user". It only ever knew about favourites because those are rows in the
`favourites` table.

A rejected shortcut: have the client compute nearby spots and write the result
into the user's profile. That is a point-in-time snapshot which goes stale when
spot data changes — the exact pattern behind the two bugs fixed on 2026-08-15
(`favourites.spot_dirs` going stale, and three drifted copies of the
rideability rule). We are not adding a third.

## Decisions taken

| Question | Decision |
|---|---|
| Backend access to the catalogue | Move it to a `spots` table (single source of truth) |
| Bounding forecast API cost | Radius filter, then cap at the N nearest |
| Setting the home location | Reuse the app's existing geocode search |

## Architecture

### 1. `spots` table

```sql
CREATE TABLE spots (
  name    text PRIMARY KEY,
  loc     text NOT NULL,
  lat     double precision NOT NULL,
  lon     double precision NOT NULL,
  dirs    smallint[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true
);
```

Seeded from the current `SPOTS` array via a generated `seed-spots.sql`.
RLS: readable by `authenticated`; writable only by `is_admin()`, matching how
`spot_overrides` is governed today.

`spot_overrides` keeps its current role — admin corrections layered on top —
so existing precedence (override `dirs` win when non-empty) is unchanged. This
design does **not** merge the two tables; that is a separate migration.

**Divergence risk is the main cost here.** The array and the table can drift.
Mitigation: a test asserts the `SPOTS` array in `index.html` and the `spots`
table agree on name/lat/lon count and content hash. The app continues to read
`SPOTS` at load (it already merges async via `window._spotsReady`), so this
change is invisible to the frontend on day one; migrating the app to read the
table is deliberately out of scope.

### 2. Profile fields

```sql
ALTER TABLE profiles
  ADD COLUMN home_lat    double precision,
  ADD COLUMN home_lon    double precision,
  ADD COLUMN home_label  text,
  ADD COLUMN digest_nearby_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN digest_nearby_km integer NOT NULL DEFAULT 120;
```

`digest_nearby_enabled` defaults to **false**: this changes what an existing
user's email contains, so it is opt-in rather than a surprise.

### 3. Digest changes

In `weekly-digest`, after building `spotForecasts` from favourites:

1. Skip unless `digest_nearby_enabled` and `home_lat/home_lon` are set.
2. Load `spots` where `active`, compute great-circle distance from home,
   keep those within `digest_nearby_km`.
3. Drop any spot already covered by the user's favourites.
4. Sort by distance, keep the **10 nearest**. If any were dropped, `log()` the
   count — a silent truncation reads as "there was nothing else".
5. Run the same `getGoodSessions` from `_shared/rideability.ts`. Nearby spots
   use the same rideability rule as everything else, by construction.
6. Rank the spots that produced sessions and keep only the **best 5**: highest
   peak wind first, ties broken by nearest. Ten is the right number to *check*
   and the wrong number to *print* — the reader wants "where should I go", not
   an inventory. Log the count cut by this limit as well.
7. Render as a separate email section, "Near you", each spot labelled with its
   distance. Favourites keep their existing position and styling so the
   familiar part of the email does not move.

The existing `wxCache` already dedupes forecast fetches by `lat,lon` across
users, so shared nearby spots cost one call per digest run, not one per user.

**Cost ceiling:** 10 extra forecast fetches per opted-in user per week, minus
cache hits. Only the best 5 of those reach the email.

### 4. UI

A "Home location" field in the profile panel, using the existing geocode
search (`tests/e2e/geocode.spec.ts` covers that component). Storing
`home_label` alongside the coordinates lets the panel show "Knokke-Heist,
Belgium" rather than raw numbers.

In the notifications panel, under the weekly-digest row: a "Also include good
sessions near home" toggle plus a radius control. The toggle is disabled with
an explanatory hint until a home location is set.

## Testing

- Unit: distance/radius filtering and the nearest-N cap, in `tests/unit/`.
- Unit: the `SPOTS`-array vs `spots`-table consistency check.
- E2E: the home-location field saves; the nearby toggle is gated on a home
  location being present.
- Manual: one digest send to a test account with the toggle on.

## Out of scope

- Migrating the app to read `spots` instead of the inline array.
- Merging `spots` and `spot_overrides`.
- Nearby-spot *reminders* (this is digest-only).

## Resolved: email length

Nearby sessions could have made the email much longer. Resolved 2026-08-16:
check the 10 nearest spots, report only the best 5. If that still reads long,
the next cheapest trim is one best day per spot rather than every session.

## Release gating

The feature ships **unreleased**: the notifications panel shows the row with a
`SOON` badge, the toggle cannot be switched on, and the radius input is
disabled. Nothing writes to `profiles` while gated. Release is a one-line
change (`NEARBY_RELEASED = false` → `true`) so the UI can ship ahead of the
backend without a second round of work.

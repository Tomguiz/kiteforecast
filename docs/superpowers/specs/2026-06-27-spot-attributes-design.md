# Structured Spot-Info Fields (Phase 1) — Design

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Goal

Add Surfr-style structured attributes to a spot's "Spot info & bookings" card:
**Disciplines, Facilities, Water type, Tide preference, Crowd level, Skill level.**
Display them as pill/tag **chips** (chosen layout: option B), editable by admins
and spot owners. Community suggestions for these fields are a **separate
follow-up** (Phase 2) — out of scope here.

## Scope

**In scope (Phase 1):**
- DB: 6 new nullable columns on `spot_info`.
- Display: a chips block in `renderSpotInfoCard`'s expanded body.
- Edit: an "Spot attributes" section in the admin edit form
  (`renderAdminEditForm`) + persistence in `adminSaveSpotInfo`.

**Out of scope (Phase 2, separate spec):**
- Community "Suggest an update" support for these fields (needs columns on
  `spot_update_suggestions` + admin-review UI). Not built now.

## Data model

Add to `spot_info` (idempotent migration in `supabase/schema.sql`):

```sql
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

All nullable. No RLS change (existing `spot_info` policies already cover
admin/owner writes and public reads).

### Option lists (JS constants in `index.html`, single source of truth)

```js
const SPOT_DISCIPLINES = ['Twintip','Hydrofoil','Wave','Wing','Surf'];
const SPOT_FACILITIES  = ['Free parking','Paid parking','Kiteshop','Kite rental',
                          'Lessons','Restaurant/bar','Showers','Toilets','Rescue','Storage'];
const SPOT_WATER_TYPES  = ['Flat','Choppy','Waves','Flat & choppy','Choppy & waves'];
const SPOT_TIDE_PREFS    = ['All tides','Best at high','Best at low'];
const SPOT_CROWD_LEVELS  = ['Quiet','Moderate','Crowded','Extremely crowded'];
const SPOT_SKILL_LEVELS  = ['Beginner-friendly','Intermediate','Advanced'];
// Emoji map for facilities chips (display only)
const FACILITY_EMOJI = {'Free parking':'🅿️','Paid parking':'🅿️','Kiteshop':'🛍️',
  'Kite rental':'🪁','Lessons':'🎓','Restaurant/bar':'🍽️','Showers':'🚿',
  'Toilets':'🚻','Rescue':'🛟','Storage':'📦'};
```

Disciplines & facilities are stored as `text[]`; the four others as scalar
`text`. The editor only ever writes values from these lists, so display can
assume known values (and degrade gracefully — see below — for legacy/unknown).

## Display (chips — option B)

In `renderSpotInfoCard`, build an **attributes block** inserted at the top of
the `.spot-info-body` (before `descHTML`). Render a sub-part only when its value
is non-empty; if ALL six are empty, render nothing (existing dataless spots are
unchanged).

- **🪁 Disciplines** — a small uppercase label, then accent-colored pill chips
  (reuse the chip style from the mockup: `rgba(0,212,255,.12)` bg, accent
  border/text, `border-radius:999px`).
- **🏖️ Facilities** — label + neutral chips (`rgba(255,255,255,.06)` bg,
  `--border`), each prefixed with `FACILITY_EMOJI[f]` when known.
- **Conditions row** — a compact inline flex row of `label value` pairs for the
  scalars that are set: `🌊 Water <water_type>`, `🌙 Tide <tide_pref>`,
  `👥 Crowd <crowd_level>`, `🟢 Level <skill_level>`. Omit any that are null.

New CSS classes (added near the existing `.spot-info-*` styles):
`.spot-attr-block`, `.spot-attr-label`, `.spot-attr-chips`, `.spot-chip`,
`.spot-chip-disc` (accent variant), `.spot-attr-conditions`, `.spot-attr-cond`.

**Escaping:** values come from fixed lists, but render through the same
escaping the card already uses for user text to stay safe if a legacy/unknown
value exists. Arrays are guarded (`Array.isArray(info.disciplines)`).

## Editing (admin/owner)

In `renderAdminEditForm`, add a collapsible-free **"Spot attributes"** section
(after the existing description/tip fields, before the save button). It uses the
existing `.s-btn` toggle-button visual:

- **Disciplines** and **Facilities** → multi-select rows: one `.s-btn` per
  option, `active` class toggled on click (same pattern as wind-dir buttons but
  scoped to this form). Pre-fill `active` from `s.disciplines` / `s.facilities`.
- **Water / Tide / Crowd / Level** → single-select rows: clicking one button in
  a group clears the others in that group (radio behaviour) and sets `active`.
  Pre-fill from the saved scalar.

Each group gets a stable container id (e.g. `adDisciplines`, `adFacilities`,
`adWaterType`, `adTidePref`, `adCrowdLevel`, `adSkillLevel`) so
`adminSaveSpotInfo` can read selections by querying `.active` buttons within it.

### Persistence (`adminSaveSpotInfo`)

Extend the upsert `row` with:

```js
disciplines: readMulti('adDisciplines'),   // string[] or null if empty
facilities:  readMulti('adFacilities'),
water_type:  readSingle('adWaterType'),     // string or null
tide_pref:   readSingle('adTidePref'),
crowd_level: readSingle('adCrowdLevel'),
skill_level: readSingle('adSkillLevel'),
```

`readMulti(id)` = `[...container.querySelectorAll('.s-btn.active')].map(b=>b.dataset.val)`,
returning `null` if empty (so we store NULL, not `[]`). `readSingle(id)` returns
the single active button's `dataset.val` or `null`.

## Testing (Playwright e2e, per existing patterns)

Drive globals + render functions directly (matching the repo's test style):

1. **Display:** seed `_cachedSpotInfo` with disciplines/facilities/scalars,
   call `renderSpotInfoCard('X')`, expand the body, assert the chips and
   conditions render with the right text; assert a spot with NO attributes
   renders no `.spot-attr-block`.
2. **Editor round-trip:** render the admin form prefilled with a spot's
   attributes, assert the correct buttons are `active`; toggle some, then assert
   `readMulti`/`readSingle` (or a small exported helper) produce the expected
   arrays/scalars, including single-select radio behaviour (only one active).
3. **Empty → null:** with no buttons active, the read helpers return `null`
   (not `[]`/`''`).

Manual check: open a real spot in the admin form, set attributes, save, reload,
confirm chips show and re-editing pre-fills correctly.

## Risks / edge cases

- **Legacy/unknown values:** display must not assume a value is in the list —
  render whatever string is stored (escaped), and skip the emoji if unmapped.
- **Empty arrays vs null:** store `null` (not `[]`) when nothing selected, so
  the display's "any attribute set?" check is a simple truthiness/length test.
- **Owner vs admin:** both already pass the `adminSaveSpotInfo` permission gate;
  no new access logic — the new fields ride along with the existing upsert.
- **Suggest flow untouched:** `openSuggestUpdate` is NOT modified in Phase 1; it
  keeps offering dirs + tip only. (Phase 2 adds attributes there.)

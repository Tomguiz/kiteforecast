# Spot Attributes — Phase 2: Community Suggestions — Design

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 1 (`2026-06-27-spot-attributes-design.md`) — the 6 `spot_info`
attribute columns, the `spotAttributesHTML` display helper, the option-list
constants, the editor button-group builders, and `readMultiAttr`/`readSingleAttr`
already exist on the `feat/spot-attributes` branch.

## Goal

Let any signed-in user **suggest** spot-attribute values (Disciplines,
Facilities, Water, Tide, Crowd, Level) through the existing "Suggest an update"
flow, and let an admin **review + apply** them — same review gate as the
current dirs/tip suggestions.

## Scope

**In scope:**
- DB: add the 6 attribute columns to `spot_update_suggestions`.
- Suggest form (`openSuggestUpdate`): the 6 attribute button-groups, prefilled
  from the spot's current attributes.
- Submit (`submitSuggestUpdate`): include the 6 fields in the insert.
- Admin review (`renderAdminPanel`): show a suggested-attributes summary line.
- Approve (`adminApplyUpdate`): write the 6 attributes to `spot_info`
  (REPLACE semantics — see below).
- Shared refactor: extract the per-call `_attrMulti`/`_attrSingle` builders in
  `adminOpenSpot` into module-level `attrMultiHTML(id,opts,sel)` /
  `attrSingleHTML(id,opts,sel)` so the admin form AND the suggest form use one
  implementation (DRY; also addresses the Phase-1 review note about per-call
  re-allocation).

**Out of scope:** email-template changes for the admin notification (the
existing `update-notify` edge-function email already fires; attribute details in
that email are a nice-to-have, not built here).

## Data model

Idempotent migration in `supabase/schema.sql` (after the existing
`spot_update_suggestions` migrations), mirroring Phase 1's `spot_info` columns:

```sql
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

RLS unchanged — existing policies already allow anon/auth INSERT, public SELECT,
and admin review UPDATE.

## Shared builder refactor

`adminOpenSpot` currently defines `_attrMulti(id,opts,sel)` and
`_attrSingle(id,opts,sel)` locally. Move them to module scope as:
- `attrMultiHTML(id, opts, sel)` → a `<div id> ` of multi-select `.s-btn`
  buttons (`onclick="this.classList.toggle('active')"`), `active` set from `sel`
  (an array; guarded with `Array.isArray`).
- `attrSingleHTML(id, opts, sel)` → single-select buttons
  (`onclick="toggleAttrSingle(this)"`), `active` where `sel===opt`.

`adminOpenSpot` then calls these instead of its locals (behaviour identical;
ids stay `adDisciplines`…`adSkillLevel`). This is a pure refactor — its existing
tests must still pass.

## Suggest form (`openSuggestUpdate`)

The suggest overlay (`#suggestUpdateContent`, ~line 5475) currently has wind-dir
buttons + a tip textarea. Add an **"Spot attributes"** section between the tip
box and the submit button, built with the shared helpers and **suggest-scoped
ids** (so they never collide with the admin form's `ad*` ids):

```
attrMultiHTML('suDisciplines', SPOT_DISCIPLINES, info.disciplines)
attrMultiHTML('suFacilities',  SPOT_FACILITIES,  info.facilities)
attrSingleHTML('suWaterType',  SPOT_WATER_TYPES, info.water_type)
attrSingleHTML('suTidePref',   SPOT_TIDE_PREFS,  info.tide_pref)
attrSingleHTML('suCrowdLevel', SPOT_CROWD_LEVELS, info.crowd_level)
attrSingleHTML('suSkillLevel', SPOT_SKILL_LEVELS, info.skill_level)
```

`info` = `_cachedSpotInfo||{}` (already in scope), so the groups are **prefilled**
with the spot's current attributes — the suggester edits/adds rather than
starting blank (consistent with how the tip textarea prefills today).

## Submit (`submitSuggestUpdate`)

Read the 6 groups with the existing global helpers and include them in the
`spot_update_suggestions` insert (~line 5524), alongside `suggested_dirs`/`tip`:

```js
disciplines: readMultiAttr('suDisciplines'),
facilities:  readMultiAttr('suFacilities'),
water_type:  readSingleAttr('suWaterType'),
tide_pref:   readSingleAttr('suTidePref'),
crowd_level: readSingleAttr('suCrowdLevel'),
skill_level: readSingleAttr('suSkillLevel'),
```

The existing "add a dir or tip before sending" guard stays; a suggestion that
only changes attributes (no dir/tip) should also be allowed — extend the guard
so it passes when ANY attribute group has a value too (otherwise an
attributes-only suggestion is wrongly rejected).

## Admin review (`renderAdminPanel`)

In the pending-suggestion row (~line 6896-6916, where `Dirs:`/`Tip:` detail
lines are built), add an **attributes summary** line when the suggestion carries
any attribute, e.g.:

`Attrs: 🪁 Twintip, Wing · 🏖️ Free parking, Kiteshop · 🌊 Flat · 🌙 All tides · 👥 Crowded · 🟢 Beginner-friendly`

Built by a small helper `suggestionAttrSummary(u)` that joins the present
attribute values with their group emoji (🪁/🏖️/🌊/🌙/👥/🟢), omitting empty
groups, returning `''` when none. Shown only when non-empty. The existing
"Apply →" / "Reject" buttons are unchanged.

## Approve (`adminApplyUpdate`) — REPLACE semantics

The current function builds `updates` with `if(u.field) updates.field=...`
(only-if-truthy) — which cannot express "clear this field". Per the chosen
REPLACE semantics, handle the 6 attributes **explicitly and unconditionally**,
separate from that legacy block: if the suggestion row includes ANY attribute
key (i.e. the suggestion came from the new form), set all 6 attribute columns in
`updates` from the suggestion — including empty→null — so the suggester's full
intended state is applied and they CAN clear an attribute.

Detection: a suggestion is an "attribute suggestion" if any of the 6 keys is
present on `u` (`'disciplines' in u || 'facilities' in u || ... `). When true,
add to `updates`:

```js
updates.disciplines = u.disciplines ?? null;
updates.facilities  = u.facilities  ?? null;
updates.water_type  = u.water_type  ?? null;
updates.tide_pref   = u.tide_pref   ?? null;
updates.crowd_level = u.crowd_level ?? null;
updates.skill_level = u.skill_level ?? null;
```

These ride the existing `spot_info` upsert (`{spot_name, ...updates, updated_at}`)
and the existing admin gate. The dirs→`spot_overrides`, points award, and
`reviewed:true,approved:true` marking are unchanged. If the currently-open spot
is the one updated, the existing `renderSpotInfoCard(u.spot_name)` refresh (in
the dirs branch) already re-renders the card; ensure the card refreshes even
when only attributes changed (call `renderSpotInfoCard` / update
`_cachedSpotInfo` after the upsert if `cachedLoc?.name===u.spot_name`).

## Testing (Playwright e2e, existing patterns)

Extend `tests/e2e/spot-attributes.spec.ts` (or a new `spot-attributes-phase2.spec.ts`):

1. **Shared builders still drive the admin form:** the Phase-1 admin editor
   tests must still pass after the refactor (prefill + toggle + radio).
2. **Suggest submit:** open the suggest form for a signed-in user, select
   attribute buttons (suggest ids), submit, and assert the captured
   `spot_update_suggestions` insert body contains the attribute fields
   (an array like disciplines + a scalar like crowd_level).
3. **Attributes-only suggestion allowed:** submitting with only attributes (no
   dir/tip) does not hit the "add a dir or tip" rejection.
4. **Apply writes attributes (replace, incl. clear):** call `adminApplyUpdate`
   with a suggestion object carrying attributes (one set, one explicitly null)
   and assert the `spot_info` upsert body sets those columns (the null one as
   null).
5. **Admin row summary:** `suggestionAttrSummary(u)` returns the joined string
   for a populated suggestion and `''` for an empty one.

Manual check: as a normal user, suggest attributes on a spot; as admin, see the
summary in the pending list, Apply, and confirm the spot's chips update.

## Risks / edge cases

- **Id collision:** suggest form uses `su*` ids, admin form uses `ad*` ids — the
  read helpers are id-scoped, so the two forms never interfere even if both DOM
  trees exist.
- **Legacy suggestions** (pre-Phase-2, no attribute keys): `adminApplyUpdate`'s
  "any attribute key present?" detection is false → attributes untouched, exactly
  as today. No migration of old rows needed.
- **Replace can clear:** a suggester who deselects everything in a group submits
  null for it; on approval that group is cleared. This is intended (chosen
  REPLACE semantics) and matches the prefilled-form mental model.
- **Guard change:** the submit guard must accept attributes-only suggestions, or
  users adding only Disciplines/Facilities get a false "add a dir or tip" error.

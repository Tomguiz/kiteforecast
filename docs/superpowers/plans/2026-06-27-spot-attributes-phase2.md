# Spot Attributes — Phase 2 (Community Suggestions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users suggest spot-attribute values via "Suggest an update", and let admins review + apply them (REPLACE semantics).

**Architecture:** Add the 6 attribute columns to `spot_update_suggestions`; extract the per-call attribute button-group builders in `adminOpenSpot` into module-level `attrMultiHTML`/`attrSingleHTML` shared by both forms; add the groups (prefilled, `su*` ids) to the suggest overlay; include them in the submit insert; show a summary in the admin pending row; apply all 6 (incl. clear→null) in `adminApplyUpdate`. Additive; legacy suggestions untouched.

**Tech Stack:** Vanilla JS/HTML single-file app (`index.html`), Supabase Postgres (`supabase/schema.sql`), Playwright e2e (`tests/`).

## Global Constraints

- All app code in `/Users/guiz/Documents/Claude/Claude Code/PFP/index.html`; match the compact existing style.
- This builds on Phase 1 (branch `feat/spot-attributes`): the constants `SPOT_DISCIPLINES/SPOT_FACILITIES/SPOT_WATER_TYPES/SPOT_TIDE_PREFS/SPOT_CROWD_LEVELS/SPOT_SKILL_LEVELS`, the global helpers `readMultiAttr(id)`/`readSingleAttr(id)`/`toggleAttrSingle(btn)`, and the display helper `spotAttributesHTML` already exist. Do NOT redefine them.
- 6 attribute columns mirror `spot_info`: `disciplines text[]`, `facilities text[]`, `water_type text`, `tide_pref text`, `crowd_level text`, `skill_level text`. All nullable. Idempotent migration.
- Suggest-form button-group ids are `suDisciplines`, `suFacilities`, `suWaterType`, `suTidePref`, `suCrowdLevel`, `suSkillLevel` (distinct from the admin form's `ad*` ids).
- Apply = REPLACE: on approval, set all 6 attribute columns from the suggestion (including empty→null) so the suggester's full state applies and they can clear a field. Detect an attribute suggestion by `('disciplines' in u || 'facilities' in u || 'water_type' in u || 'tide_pref' in u || 'crowd_level' in u || 'skill_level' in u)`.
- The submit guard must accept attributes-only suggestions (not just dirs/tip).
- Store `null` (not `[]`/`''`) when a group is empty (the read helpers already do this).
- Tests are Playwright e2e under `tests/`, driven via `gotoApp('signedOut'|'signedIn'|'admin')` + `page.evaluate`. Run from `tests/`: `npx playwright test e2e/<file>`. Request-capture uses `page.waitForRequest(r => r.url().includes('/rest/v1/<table>') && (r.method()==='POST'||r.method()==='PATCH'))`.
- Commit after each task. Branch: `feat/spot-attributes` (Phase 1 + 2 ship together).

---

### Task 1: Migration + shared builder refactor

**Files:**
- Modify: `supabase/schema.sql` (after line 434, the last `spot_update_suggestions` ADD COLUMN)
- Modify: `index.html` (add `attrMultiHTML`/`attrSingleHTML` at module scope near the other attribute helpers ~`readMultiAttr`; rewrite `adminOpenSpot`'s local `_attrMulti`/`_attrSingle` to call them)
- Test: existing `tests/e2e/spot-attributes.spec.ts` (the admin-editor tests must still pass — this task adds no new test, it's a safe refactor verified by existing coverage)

**Interfaces:**
- Produces: globals `attrMultiHTML(id, opts, sel) -> string` (multi-select `.s-btn` group, `active` where `Array.isArray(sel)&&sel.includes(opt)`, `onclick="this.classList.toggle('active')"`); `attrSingleHTML(id, opts, sel) -> string` (single-select, `active` where `sel===opt`, `onclick="toggleAttrSingle(this)"`). Both wrap buttons in `<div id="${id}" class="s-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`.

- [ ] **Step 1: Add the migration**

In `supabase/schema.sql`, immediately after line 434 (`...spot_update_suggestions ADD COLUMN approved...`), add:

```sql
-- Phase 2: community-suggestable spot attributes (mirror spot_info). Idempotent.
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_update_suggestions ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

- [ ] **Step 2: Add the module-level builders**

In `index.html`, find the global `function readMultiAttr(id){` (~line 7406). Immediately ABOVE it, add:

```javascript
// Shared attribute button-group builders — used by both the admin editor
// (adOpenSpot) and the community suggest form (openSuggestUpdate). Multi:
// click toggles active. Single: toggleAttrSingle gives radio behaviour.
function attrMultiHTML(id,opts,sel){
  const set=new Set(Array.isArray(sel)?sel:[]);
  return `<div id="${id}" class="s-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
    +opts.map(o=>`<button type="button" class="s-btn${set.has(o)?' active':''}" data-val="${o}" onclick="this.classList.toggle('active')">${o}</button>`).join('')
    +`</div>`;
}
function attrSingleHTML(id,opts,sel){
  return `<div id="${id}" class="s-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
    +opts.map(o=>`<button type="button" class="s-btn${sel===o?' active':''}" data-val="${o}" onclick="toggleAttrSingle(this)">${o}</button>`).join('')
    +`</div>`;
}
```

- [ ] **Step 3: Point `adminOpenSpot` at the shared builders**

In `adminOpenSpot` (~line 7123), DELETE the two local builders and update `attrSectionHTML` to call the globals. Replace this block:

```javascript
  const _attrMulti=(id,opts,sel)=>{
    const set=new Set(Array.isArray(sel)?sel:[]);
    return `<div id="${id}" class="s-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
      +opts.map(o=>`<button type="button" class="s-btn${set.has(o)?' active':''}" data-val="${o}" onclick="this.classList.toggle('active')">${o}</button>`).join('')
      +`</div>`;
  };
  const _attrSingle=(id,opts,sel)=>`<div id="${id}" class="s-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">`
      +opts.map(o=>`<button type="button" class="s-btn${sel===o?' active':''}" data-val="${o}" onclick="toggleAttrSingle(this)">${o}</button>`).join('')
      +`</div>`;
  const attrSectionHTML=`
      <div style="margin:14px 0 4px;font-size:.78rem;font-weight:700;color:var(--accent)">🪁 Spot attributes</div>
      <label class="pp-label">Disciplines</label>
      ${_attrMulti('adDisciplines',SPOT_DISCIPLINES,s?.disciplines)}
      <label class="pp-label">Facilities</label>
      ${_attrMulti('adFacilities',SPOT_FACILITIES,s?.facilities)}
      <label class="pp-label">Water type</label>
      ${_attrSingle('adWaterType',SPOT_WATER_TYPES,s?.water_type)}
      <label class="pp-label">Tide</label>
      ${_attrSingle('adTidePref',SPOT_TIDE_PREFS,s?.tide_pref)}
      <label class="pp-label">Crowd</label>
      ${_attrSingle('adCrowdLevel',SPOT_CROWD_LEVELS,s?.crowd_level)}
      <label class="pp-label">Suitable level</label>
      ${_attrSingle('adSkillLevel',SPOT_SKILL_LEVELS,s?.skill_level)}`;
```

with:

```javascript
  const attrSectionHTML=`
      <div style="margin:14px 0 4px;font-size:.78rem;font-weight:700;color:var(--accent)">🪁 Spot attributes</div>
      <label class="pp-label">Disciplines</label>
      ${attrMultiHTML('adDisciplines',SPOT_DISCIPLINES,s?.disciplines)}
      <label class="pp-label">Facilities</label>
      ${attrMultiHTML('adFacilities',SPOT_FACILITIES,s?.facilities)}
      <label class="pp-label">Water type</label>
      ${attrSingleHTML('adWaterType',SPOT_WATER_TYPES,s?.water_type)}
      <label class="pp-label">Tide</label>
      ${attrSingleHTML('adTidePref',SPOT_TIDE_PREFS,s?.tide_pref)}
      <label class="pp-label">Crowd</label>
      ${attrSingleHTML('adCrowdLevel',SPOT_CROWD_LEVELS,s?.crowd_level)}
      <label class="pp-label">Suitable level</label>
      ${attrSingleHTML('adSkillLevel',SPOT_SKILL_LEVELS,s?.skill_level)}`;
```

- [ ] **Step 4: Run the existing editor tests to verify the refactor is safe**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts`
Expected: all pass (the 3 admin-editor tests exercise the button groups — same ids, same behaviour). If any fail, the refactor changed behaviour — fix the refactor, not the test.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql index.html
git commit -m "refactor(spot): share attribute builders; suggestion attr columns"
```

---

### Task 2: Suggest form shows prefilled attribute groups + submit includes them

**Files:**
- Modify: `index.html` — `openSuggestUpdate` (`#suggestUpdateContent` template, ~line 5475) and `submitSuggestUpdate` (~line 5510).
- Test: `tests/e2e/spot-attributes.spec.ts` (append) — or create `tests/e2e/spot-attributes-phase2.spec.ts`.

**Interfaces:**
- Consumes: `attrMultiHTML`/`attrSingleHTML` (Task 1); `readMultiAttr`/`readSingleAttr` (Phase 1).
- Produces: suggest overlay contains button groups `suDisciplines`/`suFacilities`/`suWaterType`/`suTidePref`/`suCrowdLevel`/`suSkillLevel`, prefilled from `_cachedSpotInfo`; the submit insert carries the 6 attribute fields; the submit guard accepts attributes-only suggestions.

- [ ] **Step 1: Write the failing test (create `tests/e2e/spot-attributes-phase2.spec.ts`)**

```typescript
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('suggest form shows prefilled attribute groups and submits them', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Sugg Spot', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Sugg Spot', disciplines: ['Twintip'], facilities: null,
      water_type: 'Flat', tide_pref: null, crowd_level: null, skill_level: null };
    openSuggestUpdate();
  });
  // prefill: Twintip discipline + Flat water are active
  await expect(page.locator('#suDisciplines .s-btn.active[data-val="Twintip"]')).toHaveCount(1);
  await expect(page.locator('#suWaterType .s-btn.active[data-val="Flat"]')).toHaveCount(1);

  // add a facility + a crowd level, then submit and capture the insert
  await page.locator('#suFacilities .s-btn[data-val="Kiteshop"]').click();
  await page.locator('#suCrowdLevel .s-btn[data-val="Crowded"]').click();

  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('Kiteshop');
  expect(body).toContain('"crowd_level":"Crowded"');
});

test('an attributes-only suggestion (no dir/tip) is allowed', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    cachedLoc = { name: 'Attr Only', latitude: 51.35, longitude: 3.28, country: 'BE' };
    _cachedSpotInfo = { spot_name: 'Attr Only' };
    openSuggestUpdate();
    // clear any prefilled dirs so only an attribute is set
    document.querySelectorAll('#suDirBtns .s-btn.active').forEach(b => b.classList.remove('active'));
    (document.querySelector('#suDisciplines .s-btn[data-val="Wing"]') as HTMLButtonElement).click();
  });
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_update_suggestions') && r.method() === 'POST');
  await page.evaluate(() => submitSuggestUpdate());
  const body = (await req).postData() || '';
  expect(body).toContain('Wing'); // submitted, not blocked by the dir/tip guard
});
```

- [ ] **Step 2: Run to verify it fails**

From `tests/`: `npx playwright test e2e/spot-attributes-phase2.spec.ts`
Expected: FAIL — `#suDisciplines` not found (groups not in the suggest form yet).

- [ ] **Step 3: Add the attribute groups to the suggest overlay**

In `openSuggestUpdate`, the template assigns `$('suggestUpdateContent').innerHTML`. Find the tip textarea block ending with the `<div ...>Want to update business info…</div>` line, which sits just before the submit button:

```javascript
    <div style="font-size:.67rem;color:var(--tdim);margin-bottom:18px;">Want to update business info, booking links or contact details? <span style="color:var(--accent);cursor:pointer" onclick="closeSuggestUpdate();openClaimFlow()">Claim this spot →</span></div>

    <button class="btn pp-save-btn" id="suSubmitBtn" onclick="submitSuggestUpdate()" style="width:100%">Send suggestion →</button>
```

Insert the attributes section on the line BEFORE that submit button (after the "Want to update…" div):

```javascript
    <label class="pp-label" style="margin-top:6px">🪁 Spot attributes <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--tdim)">— what you can ride & what's here</span></label>
    <label class="pp-label">Disciplines</label>
    ${attrMultiHTML('suDisciplines',SPOT_DISCIPLINES,info.disciplines)}
    <label class="pp-label">Facilities</label>
    ${attrMultiHTML('suFacilities',SPOT_FACILITIES,info.facilities)}
    <label class="pp-label">Water type</label>
    ${attrSingleHTML('suWaterType',SPOT_WATER_TYPES,info.water_type)}
    <label class="pp-label">Tide</label>
    ${attrSingleHTML('suTidePref',SPOT_TIDE_PREFS,info.tide_pref)}
    <label class="pp-label">Crowd</label>
    ${attrSingleHTML('suCrowdLevel',SPOT_CROWD_LEVELS,info.crowd_level)}
    <label class="pp-label">Suitable level</label>
    ${attrSingleHTML('suSkillLevel',SPOT_SKILL_LEVELS,info.skill_level)}
```

(`info` is already defined at the top of `openSuggestUpdate` as `_cachedSpotInfo||{}`.)

- [ ] **Step 4: Include attributes in the submit insert + fix the guard**

In `submitSuggestUpdate`, read the 6 groups and add them to the insert. First, the existing guard is:

```javascript
  if(!selDirs.length&&!tip){ showToast('Add a wind direction or a tip before sending.'); return; }
```

Add the attribute reads ABOVE the guard and widen it:

```javascript
  const _disc=readMultiAttr('suDisciplines'), _fac=readMultiAttr('suFacilities');
  const _water=readSingleAttr('suWaterType'), _tide=readSingleAttr('suTidePref');
  const _crowd=readSingleAttr('suCrowdLevel'), _skill=readSingleAttr('suSkillLevel');
  const _hasAttr=!!(_disc||_fac||_water||_tide||_crowd||_skill);
  if(!selDirs.length&&!tip&&!_hasAttr){ showToast('Add a wind direction, a tip, or a spot attribute before sending.'); return; }
```

Then in the `sb.from('spot_update_suggestions').insert({...})` object, after
`suggested_dirs:..., tip:...,`, add:

```javascript
    disciplines:_disc, facilities:_fac, water_type:_water,
    tide_pref:_tide, crowd_level:_crowd, skill_level:_skill,
```

- [ ] **Step 5: Run to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes-phase2.spec.ts`
Expected: both tests pass. If `openSuggestUpdate` early-returns because the test
user isn't signed in, confirm `gotoApp('signedIn')` set `_authSession` (it does);
if it needs the overlay element present, that's in the app shell.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/spot-attributes-phase2.spec.ts
git commit -m "feat(spot): suggest form attribute groups + submit"
```

---

### Task 3: Admin review summary + apply (REPLACE)

**Files:**
- Modify: `index.html` — add `suggestionAttrSummary(u)` helper; add a summary line to the admin pending-row detail (~line 6978-6980); extend `adminApplyUpdate` (~line 7270) to apply the 6 attributes.
- Test: `tests/e2e/spot-attributes-phase2.spec.ts` (append).

**Interfaces:**
- Consumes: the suggestion object `u` (now carrying the 6 attribute keys when present).
- Produces: `suggestionAttrSummary(u) -> string` (joined "🪁 …" summary or `''`); `adminApplyUpdate` writes the 6 attribute columns to `spot_info` when `u` is an attribute suggestion.

- [ ] **Step 1: Write the failing tests (append)**

```typescript
test('suggestionAttrSummary joins present attributes and is empty when none', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const { full, empty } = await page.evaluate(() => ({
    full: suggestionAttrSummary({ disciplines: ['Twintip','Wing'], facilities: ['Kiteshop'],
      water_type: 'Flat', tide_pref: null, crowd_level: 'Crowded', skill_level: null }),
    empty: suggestionAttrSummary({ disciplines: null, facilities: null, water_type: null,
      tide_pref: null, crowd_level: null, skill_level: null }),
  }));
  expect(full).toContain('Twintip');
  expect(full).toContain('Kiteshop');
  expect(full).toContain('Flat');
  expect(full).toContain('Crowded');
  expect(empty).toBe('');
});

test('adminApplyUpdate writes the attribute fields to spot_info (replace, incl. clear)', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_info') && (r.method() === 'POST' || r.method() === 'PATCH'));
  await page.evaluate(() => {
    adminApplyUpdate({ id: 'x1', spot_name: 'Apply Spot',
      disciplines: ['Twintip'], facilities: null, // facilities explicitly cleared → null
      water_type: 'Flat', tide_pref: null, crowd_level: 'Crowded', skill_level: null });
  });
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('"facilities":null');     // cleared field applied as null
  expect(body).toContain('"crowd_level":"Crowded"');
});
```

- [ ] **Step 2: Run to verify it fails**

From `tests/`: `npx playwright test e2e/spot-attributes-phase2.spec.ts -g "suggestionAttrSummary|adminApplyUpdate writes"`
Expected: FAIL — `suggestionAttrSummary` undefined; apply body lacks attribute keys.

- [ ] **Step 3: Add `suggestionAttrSummary` + wire it into the admin row**

In `index.html`, near `renderAdminPanel` (or with the other helpers), add:

```javascript
// Compact one-line summary of a suggestion's attributes for the admin review row.
function suggestionAttrSummary(u){
  const parts=[];
  if(Array.isArray(u.disciplines)&&u.disciplines.length) parts.push('🪁 '+u.disciplines.join(', '));
  if(Array.isArray(u.facilities)&&u.facilities.length)   parts.push('🏖️ '+u.facilities.join(', '));
  if(u.water_type)  parts.push('🌊 '+u.water_type);
  if(u.tide_pref)   parts.push('🌙 '+u.tide_pref);
  if(u.crowd_level) parts.push('👥 '+u.crowd_level);
  if(u.skill_level) parts.push('🟢 '+u.skill_level);
  return parts.join(' · ');
}
```

Then in the admin pending-row detail list (~line 6978-6980), add an `Attrs:` entry after the `Tip:` line. Change:

```javascript
      u.suggested_dirs?.length&&`Dirs: ${dirsLabel}`,
      u.tip&&`Tip: "${u.tip}"`,
    ].filter(Boolean).join(' · ');
```

to:

```javascript
      u.suggested_dirs?.length&&`Dirs: ${dirsLabel}`,
      u.tip&&`Tip: "${u.tip}"`,
      (()=>{const s=suggestionAttrSummary(u);return s?`Attrs: ${s}`:'';})(),
    ].filter(Boolean).join(' · ');
```

- [ ] **Step 4: Apply the attributes in `adminApplyUpdate` (REPLACE)**

In `adminApplyUpdate`, after the legacy `if(u.field)` block that builds `updates`
(the line `if(u.tip) updates.spot_tip=u.tip;` then `if(Object.keys(updates).length){...}`),
insert — BEFORE the `if(Object.keys(updates).length)` upsert call — the explicit
attribute block:

```javascript
  // REPLACE semantics: if this suggestion carries attributes, apply all 6
  // (including cleared → null) so the suggester's full intended state takes hold.
  const _isAttrSugg=('disciplines' in u||'facilities' in u||'water_type' in u||'tide_pref' in u||'crowd_level' in u||'skill_level' in u);
  if(_isAttrSugg){
    updates.disciplines=u.disciplines??null;
    updates.facilities =u.facilities ??null;
    updates.water_type =u.water_type ??null;
    updates.tide_pref  =u.tide_pref  ??null;
    updates.crowd_level=u.crowd_level??null;
    updates.skill_level=u.skill_level??null;
  }
```

Then, so the open spot's chips refresh after an attributes-only apply, find the
end of `adminApplyUpdate` (after the suggestion is marked reviewed/approved) and
ensure the card re-renders when the current spot changed. If there is not already
an unconditional refresh, add after the `reviewed:true,approved:true` update:

```javascript
  if(cachedLoc?.name===u.spot_name){ _cachedSpotInfo=null; renderSpotInfoCard(u.spot_name); }
```

(Check first — `renderSpotInfoCard` re-fetches `spot_info`, so clearing
`_cachedSpotInfo` is optional; if a refresh already exists in the dirs branch,
make it run for attribute-only applies too rather than duplicating.)

- [ ] **Step 5: Run to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes-phase2.spec.ts`
Expected: all pass. The apply test asserts `"facilities":null` is in the upsert
body — confirm the `??null` produces an explicit null (it does; `JSON.stringify`
emits `null`).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/spot-attributes-phase2.spec.ts
git commit -m "feat(spot): admin review summary + apply suggested attributes"
```

---

### Task 4: Full regression + visual check + finalize

**Files:** none (verification + integration).

- [ ] **Step 1: Full e2e suite**

From `tests/`: `npx playwright test`
Expected: all pass (Phase-1 + Phase-2 spot-attribute tests + unchanged suites).
Note: `admin.spec.ts:113` is a known parallel flake — if it fails, re-run alone
(`npx playwright test e2e/admin.spec.ts:113`) to confirm; unrelated.

- [ ] **Step 2: Manual visual check**

As a signed-in non-admin: open a spot → "Suggest an update" → confirm the
attribute groups appear prefilled, select some, send. As admin: open the Admin
panel → confirm the pending row shows the `Attrs:` summary → click "Apply →" →
reopen the spot and confirm the chips reflect the applied attributes.

- [ ] **Step 3: Report the two live-DB migrations to the user**

Phase 1 added 6 columns to `spot_info`; Phase 2 adds 6 to
`spot_update_suggestions`. BOTH migration blocks must be run against the live
Supabase DB before the features work in production. Surface both SQL blocks to
the user.

- [ ] **Step 4: Do NOT push or create a PR here.**

Phase 1 + 2 live on `feat/spot-attributes`. The controller handles
push/PR/merge after the final whole-branch review (and once `gh auth login` is
done, or via the compare URL). This task ends at "all tests green + reported".

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1), shared-builder refactor (Task 1),
  suggest-form prefilled groups + submit + guard (Task 2), admin summary
  (Task 3), apply REPLACE incl. clear + legacy-untouched detection (Task 3),
  card refresh on apply (Task 3), tests each task, both live migrations reported
  (Task 4). All spec sections mapped.
- **Placeholder scan:** none — every code step is concrete.
- **Type consistency:** `attrMultiHTML`/`attrSingleHTML` defined in Task 1 and
  consumed in Tasks 1 & 2; `su*` ids consistent across Task 2 form + submit;
  `readMultiAttr`/`readSingleAttr` (Phase 1) reused; `suggestionAttrSummary`
  defined + consumed in Task 3; the 6 attribute key names match `spot_info`
  and `spot_update_suggestions` columns everywhere.
- **Verified against real code:** suggest insert at ~5524, guard at ~5520,
  admin detail list at ~6978-6980, `adminApplyUpdate` at ~7270, local builders
  at ~7123, schema anchor at `supabase/schema.sql:434`. Line numbers are
  approximate (rebased branch) — each task says what text to find, not just a
  line.

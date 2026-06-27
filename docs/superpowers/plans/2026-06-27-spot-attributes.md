# Structured Spot-Info Fields (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Surfr-style structured attributes (Disciplines, Facilities, Water, Tide, Crowd, Level) to a spot's info card — displayed as chips, editable by admins/owners.

**Architecture:** 6 new nullable columns on `spot_info`; option lists as JS constants in `index.html`; a chips block added to `renderSpotInfoCard`'s body; a toggle-button "Spot attributes" section in the admin edit form persisted by `adminSaveSpotInfo`. Pure additive change — dataless spots render exactly as today.

**Tech Stack:** Vanilla JS/HTML/CSS single-file app (`index.html`), Supabase Postgres (`supabase/schema.sql`), Playwright e2e (`tests/`).

## Global Constraints

- All app code lives in `/Users/guiz/Documents/Claude/Claude Code/PFP/index.html`; match the existing compact style (`$('id')`, template-string innerHTML, no framework).
- Attribute **values only ever come from the fixed option lists** below — never free-typed — so raw interpolation into innerHTML is safe and matches existing card code (`info.description` is interpolated raw today). Still guard arrays with `Array.isArray(...)`.
- Store **`null`** (not `[]` or `''`) when nothing is selected, so the display's "any attribute set?" check is a simple length/truthiness test.
- 6 columns, exact names/types: `disciplines text[]`, `facilities text[]`, `water_type text`, `tide_pref text`, `crowd_level text`, `skill_level text`. All nullable.
- Migration must be idempotent (`ADD COLUMN` guarded by `EXCEPTION WHEN duplicate_column`), matching the existing `spot_tip` migration at `supabase/schema.sql:422`.
- Phase 1 = display + admin/owner edit ONLY. Do NOT touch `openSuggestUpdate`/`submitSuggestUpdate`/`spot_update_suggestions` (community suggestions = Phase 2).
- Tests are Playwright e2e under `tests/`, driven via `gotoApp('signedOut'|'admin')` + `page.evaluate` calling app globals. Run from `tests/`: `npx playwright test e2e/<file>`.
- Commit after each task. Branch already in use: `feat/spot-attributes`.

### Option lists (exact — used verbatim in Task 1)

```js
const SPOT_DISCIPLINES = ['Twintip','Hydrofoil','Wave','Wing','Surf'];
const SPOT_FACILITIES  = ['Free parking','Paid parking','Kiteshop','Kite rental','Lessons','Restaurant/bar','Showers','Toilets','Rescue','Storage'];
const SPOT_WATER_TYPES = ['Flat','Choppy','Waves','Flat & choppy','Choppy & waves'];
const SPOT_TIDE_PREFS  = ['All tides','Best at high','Best at low'];
const SPOT_CROWD_LEVELS = ['Quiet','Moderate','Crowded','Extremely crowded'];
const SPOT_SKILL_LEVELS = ['Beginner-friendly','Intermediate','Advanced'];
const FACILITY_EMOJI = {'Free parking':'🅿️','Paid parking':'🅿️','Kiteshop':'🛍️','Kite rental':'🪁','Lessons':'🎓','Restaurant/bar':'🍽️','Showers':'🚿','Toilets':'🚻','Rescue':'🛟','Storage':'📦'};
```

---

### Task 1: DB migration + option constants + render helper

**Files:**
- Modify: `supabase/schema.sql` (after line 422, the `spot_tip` migration)
- Modify: `index.html` (add constants + `spotAttributesHTML()` helper near the other spot-info code, e.g. just before `renderSpotInfoCard` ~line 3520)
- Test: `tests/e2e/spot-attributes.spec.ts` (create)

**Interfaces:**
- Produces: globals `SPOT_DISCIPLINES, SPOT_FACILITIES, SPOT_WATER_TYPES, SPOT_TIDE_PREFS, SPOT_CROWD_LEVELS, SPOT_SKILL_LEVELS, FACILITY_EMOJI`; function `spotAttributesHTML(info) -> string` returning the chips/conditions HTML, or `''` when no attribute is set.

- [ ] **Step 1: Add the idempotent migration**

In `supabase/schema.sql`, immediately after line 422 (`...ADD COLUMN spot_tip text...`), add:

```sql
-- Structured spot attributes (Surfr-style): disciplines/facilities (multi),
-- water/tide/crowd/skill (single). All nullable. Idempotent.
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN disciplines text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN facilities  text[]; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN water_type  text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN tide_pref   text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN crowd_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE spot_info ADD COLUMN skill_level text;   EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

- [ ] **Step 2: Write the failing test**

Create `tests/e2e/spot-attributes.spec.ts`:

```typescript
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

test('spotAttributesHTML renders chips + conditions for a fully-populated spot', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: ['Twintip', 'Wing'],
    facilities: ['Free parking', 'Kiteshop'],
    water_type: 'Flat', tide_pref: 'All tides',
    crowd_level: 'Crowded', skill_level: 'Beginner-friendly',
  }));
  expect(html).toContain('Twintip');
  expect(html).toContain('Wing');
  expect(html).toContain('Free parking');
  expect(html).toContain('🛍️'); // Kiteshop emoji
  expect(html).toContain('Flat');
  expect(html).toContain('Crowded');
  expect(html).toContain('Beginner-friendly');
  expect(html).toContain('spot-attr-block');
});

test('spotAttributesHTML returns empty string when no attribute is set', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: null, facilities: null, water_type: null,
    tide_pref: null, crowd_level: null, skill_level: null,
  }));
  expect(html).toBe('');
});

test('spotAttributesHTML omits unset sub-parts (only disciplines set)', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  const html = await page.evaluate(() => spotAttributesHTML({
    disciplines: ['Hydrofoil'], facilities: null, water_type: null,
    tide_pref: null, crowd_level: null, skill_level: null,
  }));
  expect(html).toContain('Hydrofoil');
  expect(html).not.toContain('spot-attr-conditions'); // no scalar row
  expect(html).not.toContain('Facilities');
});
```

- [ ] **Step 3: Run test to verify it fails**

From `tests/`:

```bash
npx playwright test e2e/spot-attributes.spec.ts
```

Expected: FAIL — `spotAttributesHTML is not defined`.

- [ ] **Step 4: Add the constants + helper**

In `index.html`, just before `async function renderSpotInfoCard` (~line 3520), add the constants from Global Constraints, then:

```javascript
// Build the structured-attributes block for a spot-info card. Values come only
// from the fixed option lists. Returns '' when nothing is set so dataless spots
// are unchanged. (Phase 1 — display.)
function spotAttributesHTML(info){
  if(!info) return '';
  const disc=Array.isArray(info.disciplines)?info.disciplines:[];
  const fac =Array.isArray(info.facilities)?info.facilities:[];
  const conds=[
    info.water_type ?['🌊','Water',info.water_type]:null,
    info.tide_pref  ?['🌙','Tide',info.tide_pref]:null,
    info.crowd_level?['👥','Crowd',info.crowd_level]:null,
    info.skill_level?['🟢','Level',info.skill_level]:null,
  ].filter(Boolean);
  if(!disc.length&&!fac.length&&!conds.length) return '';
  let html='<div class="spot-attr-block">';
  if(disc.length){
    html+='<div class="spot-attr-label">🪁 Disciplines</div><div class="spot-attr-chips">'
      +disc.map(d=>`<span class="spot-chip spot-chip-disc">${d}</span>`).join('')+'</div>';
  }
  if(fac.length){
    html+='<div class="spot-attr-label">🏖️ Facilities</div><div class="spot-attr-chips">'
      +fac.map(f=>`<span class="spot-chip">${FACILITY_EMOJI[f]?FACILITY_EMOJI[f]+' ':''}${f}</span>`).join('')+'</div>';
  }
  if(conds.length){
    html+='<div class="spot-attr-conditions">'
      +conds.map(([e,l,v])=>`<span class="spot-attr-cond">${e} <span class="spot-attr-cond-lbl">${l}</span> ${v}</span>`).join('')+'</div>';
  }
  return html+'</div>';
}
```

- [ ] **Step 5: Run test to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql index.html tests/e2e/spot-attributes.spec.ts
git commit -m "feat(spot): attribute columns + option constants + render helper"
```

---

### Task 2: Show the attributes block in the spot-info card + CSS

**Files:**
- Modify: `index.html` — call `spotAttributesHTML(info)` in `renderSpotInfoCard`'s body (the `.spot-info-body` template, ~line 3619-3625) and add CSS near `.spot-info-body` (~line 843).
- Test: `tests/e2e/spot-attributes.spec.ts` (extend)

**Interfaces:**
- Consumes: `spotAttributesHTML(info)` from Task 1.
- Produces: a `.spot-attr-block` rendered at the top of `.spot-info-body` when `_cachedSpotInfo`/`info` has attributes.

- [ ] **Step 1: Write the failing test (append to the spec file)**

```typescript
test('the spot-info card body shows the attributes block when set', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');
  await page.evaluate(() => {
    // stub fetchSpotInfo to return a populated info row, then render
    (window as any).fetchSpotInfo = async () => ({
      spot_name: 'Test Spot', verified: true,
      disciplines: ['Twintip'], facilities: ['Kiteshop'],
      water_type: 'Flat', tide_pref: null, crowd_level: 'Quiet', skill_level: null,
    });
  });
  await page.evaluate(() => renderSpotInfoCard('Test Spot'));
  // expand the card body (it starts collapsed)
  await page.locator('.spot-info-header').click();
  await expect(page.locator('.spot-attr-block')).toBeVisible();
  await expect(page.locator('.spot-attr-chips')).toContainText('Twintip');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Flat');
  await expect(page.locator('.spot-attr-conditions')).toContainText('Quiet');
});
```

- [ ] **Step 2: Run test to verify it fails**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts -g "card body shows"`
Expected: FAIL — `.spot-attr-block` not found (helper not yet wired into the card).

- [ ] **Step 3: Wire the helper into the card body**

In `index.html` `renderSpotInfoCard`, the `.spot-info-body` opens at ~line 3619 with `${ctaGrid}` first. Insert the attributes block as the FIRST child of the body. Change:

```javascript
      <div class="spot-info-body" style="display:none">
        ${ctaGrid}
```

to:

```javascript
      <div class="spot-info-body" style="display:none">
        ${spotAttributesHTML(info)}
        ${ctaGrid}
```

- [ ] **Step 4: Add the CSS**

In `index.html`, after the `.spot-info-body { ... }` rule (~line 843), add:

```css
    .spot-attr-block { display:flex; flex-direction:column; gap:6px; }
    .spot-attr-label { font-size:.62rem; font-weight:700; color:var(--tdim); text-transform:uppercase; letter-spacing:.04em; margin-top:4px; }
    .spot-attr-chips { display:flex; flex-wrap:wrap; gap:5px; }
    .spot-chip { background:rgba(255,255,255,.06); border:1px solid var(--border); border-radius:999px; padding:3px 9px; font-size:.7rem; color:var(--text); white-space:nowrap; }
    .spot-chip-disc { background:rgba(0,212,255,.12); border-color:rgba(0,212,255,.3); color:#7dd3fc; }
    .spot-attr-conditions { display:flex; flex-wrap:wrap; gap:12px; margin-top:4px; font-size:.72rem; color:var(--text); }
    .spot-attr-cond-lbl { color:var(--tdim); }
```

- [ ] **Step 5: Run test to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts`
Expected: all passed (Task 1 tests + the new card test).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/spot-attributes.spec.ts
git commit -m "feat(spot): show attribute chips in the spot-info card body"
```

---

### Task 3: Admin/owner editor — attribute toggle buttons

**Files:**
- Modify: `index.html` — add an "Spot attributes" section to `adminOpenSpot`'s template (before the save button at ~line 7087), plus read helpers.
- Test: `tests/e2e/spot-attributes.spec.ts` (extend)

**Interfaces:**
- Consumes: the option-list constants from Task 1; the prefill object `s` (which now carries `s.disciplines`/`s.facilities`/`s.water_type`/`s.tide_pref`/`s.crowd_level`/`s.skill_level` from the fetched `spot_info` row).
- Produces: form button-groups with container ids `adDisciplines`, `adFacilities`, `adWaterType`, `adTidePref`, `adCrowdLevel`, `adSkillLevel`; helpers `readMultiAttr(id)->string[]|null` and `readSingleAttr(id)->string|null`; click handler `toggleAttrSingle(btn)` for radio groups.

- [ ] **Step 1: Write the failing test (append)**

```typescript
test('the admin edit form prefills + toggles attribute buttons', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    openProfilePanel('admin');
    // render the form prefilled with a spot that has some attributes
    adminOpenSpot(null, {
      spot_name: 'Edit Me', _lat: 51, _lon: 3, _loc: 'BE',
      disciplines: ['Twintip'], facilities: [],
      water_type: 'Flat', tide_pref: null, crowd_level: null, skill_level: null,
    });
    // prefill: Twintip + Flat active
    const twintipActive = !!document.querySelector('#adDisciplines .s-btn.active[data-val="Twintip"]');
    const flatActive = !!document.querySelector('#adWaterType .s-btn.active[data-val="Flat"]');
    // toggle: add Wing discipline, switch water to Choppy (radio)
    (document.querySelector('#adDisciplines .s-btn[data-val="Wing"]') as HTMLButtonElement).click();
    (document.querySelector('#adWaterType .s-btn[data-val="Choppy"]') as HTMLButtonElement).click();
    return {
      twintipActive, flatActive,
      disciplines: readMultiAttr('adDisciplines'),
      water: readSingleAttr('adWaterType'),
      // single-select must have cleared 'Flat'
      flatStillActive: !!document.querySelector('#adWaterType .s-btn.active[data-val="Flat"]'),
    };
  });
  expect(result.twintipActive).toBe(true);
  expect(result.flatActive).toBe(true);
  expect(result.disciplines.sort()).toEqual(['Twintip', 'Wing']);
  expect(result.water).toBe('Choppy');
  expect(result.flatStillActive).toBe(false); // radio behaviour
});

test('read helpers return null when nothing selected', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    openProfilePanel('admin');
    adminOpenSpot(null, { spot_name: 'Empty', _lat: 51, _lon: 3, _loc: 'BE' });
    return { disc: readMultiAttr('adDisciplines'), water: readSingleAttr('adWaterType') };
  });
  expect(r.disc).toBeNull();
  expect(r.water).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts -g "admin edit form prefills"`
Expected: FAIL — `#adDisciplines` not found / `readMultiAttr` undefined.

- [ ] **Step 3: Add the read helpers + radio handler**

In `index.html`, near `adminSaveSpotInfo` (or with the other helpers), add:

```javascript
function readMultiAttr(id){
  const el=$(id); if(!el) return null;
  const vals=[...el.querySelectorAll('.s-btn.active')].map(b=>b.dataset.val);
  return vals.length?vals:null;
}
function readSingleAttr(id){
  const el=$(id); if(!el) return null;
  const b=el.querySelector('.s-btn.active');
  return b?b.dataset.val:null;
}
// radio behaviour for single-select attribute groups
function toggleAttrSingle(btn){
  const grp=btn.parentElement;
  const wasActive=btn.classList.contains('active');
  grp.querySelectorAll('.s-btn').forEach(b=>b.classList.remove('active'));
  if(!wasActive) btn.classList.add('active'); // tapping the active one clears it
}
```

- [ ] **Step 4: Add the "Spot attributes" section to the form**

In `adminOpenSpot`, immediately before the save-button row (the `<button ... id="adSaveBtn"...>` at ~line 7087), insert a helper-built block. First add a local builder inside `adminOpenSpot` (above the `el.innerHTML=` assignment), then reference it in the template.

Add this builder near the top of `adminOpenSpot` (after `const isNew = ...`):

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

Then, in the template, insert `${attrSectionHTML}` immediately before the
save-button wrapper. The exact block in the template (verified ~line 7086-7089)
is:

```javascript
      <div style="display:flex;gap:8px">
        <button class="btn pp-save-btn" id="adSaveBtn" onclick="adminSaveSpotInfo()" style="flex:1">${isNew?'Add spot':'Save changes'}</button>
        <button onclick="closeAdminEditForm()" ...>Cancel</button>
      </div>
```

Insert `${attrSectionHTML}` on the line **directly above** `<div style="display:flex;gap:8px">`
so the attributes section appears after the membership-note field and before the
Save/Cancel buttons.

- [ ] **Step 5: Run test to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts`
Expected: all passed. The form function is `adminOpenSpot(spotName, prefill)`
(confirmed), so `adminOpenSpot(null, {...})` in the test renders a new-spot form
prefilled with the given object. If a test fails because the form needs the
admin panel open first, ensure `openProfilePanel('admin')` ran (the tests do
this).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/spot-attributes.spec.ts
git commit -m "feat(spot): admin/owner attribute editor (toggle buttons)"
```

---

### Task 4: Persist attributes in adminSaveSpotInfo + round-trip test

**Files:**
- Modify: `index.html` — extend the `adminSaveSpotInfo` upsert `row` (~line 7308-7310) with the 6 fields.
- Test: `tests/e2e/spot-attributes.spec.ts` (extend)

**Interfaces:**
- Consumes: `readMultiAttr`/`readSingleAttr` from Task 3; the form button-groups.
- Produces: the `spot_info` upsert payload now carries `disciplines, facilities, water_type, tide_pref, crowd_level, skill_level`.

- [ ] **Step 1: Write the failing test (append)**

This asserts the PATCH/POST body sent to Supabase includes the attribute fields
when the admin saves. Reuse the request-capture pattern from `admin.spec.ts`.

```typescript
test('saving the admin form sends the attribute fields to spot_info', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    openProfilePanel('admin');
    adminOpenSpot(null, { spot_name: 'Attr Spot', _lat: 51, _lon: 3, _loc: 'BE',
      disciplines: ['Twintip'], facilities: null, water_type: null,
      tide_pref: null, crowd_level: null, skill_level: null });
    // also select a facility + crowd so the payload has both array + scalar
    (document.querySelector('#adFacilities .s-btn[data-val="Kiteshop"]') as HTMLButtonElement).click();
    (document.querySelector('#adCrowdLevel .s-btn[data-val="Crowded"]') as HTMLButtonElement).click();
  });
  const req = page.waitForRequest(r =>
    r.url().includes('/rest/v1/spot_info') && (r.method() === 'POST' || r.method() === 'PATCH'));
  await page.evaluate(() => adminSaveSpotInfo());
  const body = (await req).postData() || '';
  expect(body).toContain('"disciplines"');
  expect(body).toContain('Twintip');
  expect(body).toContain('Kiteshop');
  expect(body).toContain('"crowd_level":"Crowded"');
});
```

- [ ] **Step 2: Run test to verify it fails**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts -g "sends the attribute fields"`
Expected: FAIL — body lacks `disciplines`/`crowd_level` (not yet in the upsert).

- [ ] **Step 3: Extend the upsert row**

In `index.html` `adminSaveSpotInfo`, find the upsert `row` object (the lines with
`description:`, `spot_tip:`, `membership_note:` at ~7308-7310). Add after
`membership_note:`:

```javascript
    disciplines: readMultiAttr('adDisciplines'),
    facilities:  readMultiAttr('adFacilities'),
    water_type:  readSingleAttr('adWaterType'),
    tide_pref:   readSingleAttr('adTidePref'),
    crowd_level: readSingleAttr('adCrowdLevel'),
    skill_level: readSingleAttr('adSkillLevel'),
```

- [ ] **Step 4: Run test to verify it passes**

From `tests/`: `npx playwright test e2e/spot-attributes.spec.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/e2e/spot-attributes.spec.ts
git commit -m "feat(spot): persist attribute fields on admin save"
```

---

### Task 5: Full regression run + visual check + push + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Full e2e suite**

From `tests/`: `npx playwright test`
Expected: all pass (new `spot-attributes.spec.ts` + unchanged suites). Note: a
known `admin.spec.ts:113` sort test is occasionally flaky in parallel — if it
fails, re-run it alone (`npx playwright test e2e/admin.spec.ts:113`) to confirm
it passes; that flake is unrelated.

- [ ] **Step 2: Manual visual check**

Open `index.html`, load a spot, open the admin form (admin user), set
disciplines/facilities/water/crowd, Save. Reopen the spot-info card and confirm
the chips + conditions row render; re-open the admin form and confirm the
buttons pre-fill from the saved values.

- [ ] **Step 3: Apply the SQL migration to the live DB**

The 6 columns must exist in Supabase before save works in production. Run the
migration block from Task 1 Step 1 against the project DB (Supabase SQL editor),
or confirm `supabase/schema.sql` is the deploy source of truth. Report to the
user that the migration must be applied.

- [ ] **Step 4: Push + PR (gh CLI is unavailable — provide the compare URL)**

```bash
git push -u origin feat/spot-attributes
```

Then give the user the PR compare URL:
`https://github.com/Tomguiz/kiteforecast/compare/main...feat/spot-attributes?expand=1`
with a ready-to-paste title/body. (Per project memory, `gh` is not installed —
do not attempt `gh pr create`.)

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1 migration + constants), chip display
  (Task 1 helper + Task 2 card wiring + CSS), admin/owner editor (Task 3),
  persistence (Task 4), tests (each task), empty→null + legacy-value guards
  (Task 1 helper `Array.isArray`, read helpers return null), Phase-2 suggestion
  flow explicitly untouched (Global Constraints). All spec sections mapped.
- **Placeholder scan:** none — every code step is concrete.
- **Type consistency:** `spotAttributesHTML(info)`, `readMultiAttr(id)`,
  `readSingleAttr(id)`, `toggleAttrSingle(btn)` and the container ids
  (`adDisciplines`…`adSkillLevel`) are defined in Task 1/3 and consumed
  consistently in Tasks 2/3/4. Option-list constant names match across tasks.
- **Verified against the real code:** the admin form function is
  `adminOpenSpot(spotName, prefill)` (NOT `renderAdminEditForm`), and the save
  button is wrapped in `<div style="display:flex;gap:8px">` — both confirmed and
  reflected in Task 3. The `spot_tip` migration anchor is `supabase/schema.sql:422`.

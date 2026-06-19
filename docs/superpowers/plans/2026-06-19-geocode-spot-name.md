# Find Coordinates From Spot Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "📍 Find coordinates" button to the spot-request form that geocodes the spot name via OpenStreetMap Nominatim and fills lat/lon, so mobile users never have to copy coordinates from Google Maps.

**Architecture:** One new client function `findCoordsFromName()` that calls Nominatim directly from the browser (no backend), fills `#suggestLat`/`#suggestLon`/`#suggestCoords`, and shows a confirmation line. A button + status `<div>` added next to the spot-name input. Existing website "✨ Autofill" untouched. Plus a small copy fix to the now-unhelpful Google Maps instructions.

**Tech Stack:** Vanilla JS + HTML in `index.html`; Playwright tests in `tests/` (Nominatim mocked via `page.route`).

---

## File Structure

- Modify: `index.html`
  - Markup: spot-name field (~line 1188-1191) → add button + status; coordinates label/help (~line 1214, 1221) → reword.
  - JS: add `findCoordsFromName()` near the existing `autofillFromWebsite` (~line 5711).
- Create: `tests/e2e/geocode.spec.ts`

---

## Task 1: Add the `findCoordsFromName()` function (TDD)

**Files:**
- Modify: `index.html` — add function near `autofillFromWebsite` (~line 5711)
- Test: `tests/e2e/geocode.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/geocode.spec.ts`. The test seeds `#suggestName`, mocks the
Nominatim endpoint, calls `findCoordsFromName()`, and asserts lat/lon filled.
The suggest-form inputs exist in the DOM at load (inside the profile panel), so
we can set their values directly without opening the form UI.

```ts
import { test, expect } from '../fixtures/auth';

test('Find coordinates fills lat/lon from the geocoder', async ({ gotoApp, page }) => {
  // Mock Nominatim BEFORE navigation
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ lat: '36.0921', lon: '27.7619', display_name: 'Prasonisi, Rhodes, Greece' }]),
    }));
  await gotoApp('signedIn');

  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'Prasonisi Rhodos';
    // @ts-expect-error app global
    return findCoordsFromName();
  });

  await expect(page.locator('#suggestLat')).toHaveValue('36.0921');
  await expect(page.locator('#suggestLon')).toHaveValue('27.7619');
  await expect(page.locator('#findCoordsStatus')).toContainText('Prasonisi, Rhodes, Greece');
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test geocode --reporter=line`
Expected: FAIL — `findCoordsFromName` is not defined (ReferenceError) and/or
`#findCoordsStatus` not found.

- [ ] **Step 3: Implement `findCoordsFromName()`**

In `index.html`, immediately BEFORE `async function autofillFromWebsite(){`
(~line 5711), insert:

```js
// Geocode the spot name → fill lat/lon. Uses OpenStreetMap Nominatim (free, no
// key), called directly from the browser. Lets mobile users skip copying coords
// from Google Maps. Best-match + confirmation line; user can still edit manually.
async function findCoordsFromName(){
  const name=($('suggestName')?.value||'').trim();
  const status=$('findCoordsStatus'); const btn=$('findCoordsBtn');
  if(!name){ showToast('Enter the spot name first'); return; }
  // Refine the query with city/country if the user already filled them.
  const city=($('suggestLocation')?.value||'').trim();
  const country=($('suggestCountry')?.value||'').trim();
  const q=[name,city,country].filter(Boolean).join(', ');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Searching…'; }
  if(status){ status.style.display='block'; status.style.color='var(--tdim)'; status.textContent='Searching for the spot…'; }
  try{
    const url='https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q);
    const res=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!res.ok) throw new Error('http '+res.status);
    const arr=await res.json();
    if(!Array.isArray(arr)||!arr.length){
      if(status){ status.textContent='⚠️ Couldn\'t find that spot — try a more specific name (add the city/country) or enter coordinates manually.'; status.style.color='#f59e0b'; }
      return;
    }
    const top=arr[0];
    const lat=parseFloat(top.lat), lon=parseFloat(top.lon);
    if(isNaN(lat)||isNaN(lon)){ if(status){ status.textContent='⚠️ Geocoder returned no coordinates — enter them manually.'; status.style.color='#f59e0b'; } return; }
    const latStr=lat.toFixed(6), lonStr=lon.toFixed(6);
    if($('suggestLat')) $('suggestLat').value=latStr;
    if($('suggestLon')) $('suggestLon').value=lonStr;
    if($('suggestCoords')) $('suggestCoords').value=latStr+', '+lonStr;
    if(status){ status.innerHTML='✓ Found: '+(top.display_name||name)+' <span style="color:var(--tdim)">('+latStr+', '+lonStr+')</span> — not the right place? edit the fields manually.'; status.style.color='#4ade80'; }
  }catch(e){
    if(status){ status.textContent='⚠️ Couldn\'t reach the geocoder — enter coordinates manually.'; status.style.color='#f59e0b'; }
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='📍 Find coordinates'; }
  }
}
```

- [ ] **Step 4: Add the button + status markup**

Replace the spot-name field block (lines 1188-1191):
```html
        <div>
          <label class="pp-label">Spot name <span style="color:#f87171">*</span></label>
          <input type="text" id="suggestName" class="pp-input" placeholder="e.g. Koksijde Beach"/>
        </div>
```
with:
```html
        <div>
          <label class="pp-label">Spot name <span style="color:#f87171">*</span></label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="suggestName" class="pp-input" placeholder="e.g. Koksijde Beach" style="flex:1"/>
            <button type="button" id="findCoordsBtn" onclick="findCoordsFromName()" style="flex-shrink:0;padding:10px 14px;border-radius:10px;border:1.5px solid var(--accent);background:rgba(0,212,255,.1);color:var(--accent);font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap">📍 Find coordinates</button>
          </div>
          <div id="findCoordsStatus" style="font-size:.72rem;color:var(--tdim);margin-top:4px;display:none"></div>
        </div>
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test geocode --reporter=line`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
git add index.html tests/e2e/geocode.spec.ts
git commit -m "feat(spot): find coordinates from spot name via Nominatim geocode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Error-path tests (no result, network error, empty name)

**Files:**
- Modify: `tests/e2e/geocode.spec.ts`

- [ ] **Step 1: Add the three error tests**

Append to `tests/e2e/geocode.spec.ts`:

```ts
test('zero results shows a "couldn\'t find" message, leaves fields empty', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'zzzznowhere';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await expect(page.locator('#findCoordsStatus')).toContainText(/couldn.t find/i);
  await expect(page.locator('#suggestLat')).toHaveValue('');
});

test('network error shows a "couldn\'t reach" message', async ({ gotoApp, page }) => {
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) =>
    route.fulfill({ status: 500, body: 'err' }));
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = 'Knokke';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  await expect(page.locator('#findCoordsStatus')).toContainText(/couldn.t reach/i);
});

test('empty name does not call the geocoder', async ({ gotoApp, page }) => {
  let called = false;
  await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, (route) => { called = true; route.fulfill({ status: 200, body: '[]' }); });
  await gotoApp('signedIn');
  await page.evaluate(() => {
    (document.getElementById('suggestName') as HTMLInputElement).value = '';
    // @ts-expect-error app global
    return findCoordsFromName();
  });
  expect(called).toBe(false);
});
```

- [ ] **Step 2: Run the geocode tests — expect PASS**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test geocode --reporter=list`
Expected: 4 passed. If the empty-name test flakes because the route check races,
add `await page.waitForTimeout(200);` before the `expect(called)`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
git add tests/e2e/geocode.spec.ts
git commit -m "test(spot): geocode error paths (no result, network error, empty name)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Reword the Google Maps coordinate instructions

**Files:**
- Modify: `index.html` — coordinates label (~line 1214) and maps link (~line 1221)

- [ ] **Step 1: Update the Coordinates label hint**

Replace (line 1214):
```html
          <label class="pp-label">Coordinates <span style="color:#f87171">*</span> <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--tdim)">(paste from Google Maps)</span></label>
```
with:
```html
          <label class="pp-label">Coordinates <span style="color:#f87171">*</span> <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--tdim)">(use 📍 Find coordinates above, or enter manually)</span></label>
```

- [ ] **Step 2: Reword the Google Maps fallback link**

Replace (line 1221):
```html
        <a href="https://maps.google.com" target="_blank" rel="noopener" id="suggestMapsLink" onclick="this.href=spotMapsSearchUrl()" style="display:inline-flex;align-items:center;gap:5px;margin-top:-4px;padding:6px 12px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.25);border-radius:8px;font-size:.72rem;font-weight:700;color:var(--accent);text-decoration:none">📍 Open Google Maps → long-press the spot → tap the coordinates → copy</a>
```
with:
```html
        <a href="https://maps.google.com" target="_blank" rel="noopener" id="suggestMapsLink" onclick="this.href=spotMapsSearchUrl()" style="display:inline-flex;align-items:center;gap:5px;margin-top:-4px;padding:6px 12px;background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.25);border-radius:8px;font-size:.72rem;font-weight:700;color:var(--accent);text-decoration:none">🗺️ Or check the location on Google Maps</a>
```

- [ ] **Step 3: Smoke test (no console errors from markup change)**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test smoke --reporter=line`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
git add index.html
git commit -m "copy(spot): point coordinate help at the new Find coordinates button

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full suite + verify + push

- [ ] **Step 1: Run the FULL suite twice (determinism)**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test --reporter=line` (×2)
Expected: all green both runs (existing 27 + 4 geocode = 31).

- [ ] **Step 2: Manual headed check**

Run: `cd "/Users/guiz/Documents/Claude/Claude Code/PFP/tests" && npx playwright test geocode --headed`
Watch: the function fills lat/lon and the confirmation line appears.

- [ ] **Step 3: Push**

```bash
cd "/Users/guiz/Documents/Claude/Claude Code/PFP"
git push origin main
```

- [ ] **Step 4: Confirm CI green**

Check the Actions tab / workflow runs API; expect the `tests` workflow to pass.

---

## Self-Review notes

- **Spec coverage:** button + status (Task 1 markup), `findCoordsFromName` with
  Nominatim direct call + best-match + confirmation (Task 1), city/country query
  refinement (Task 1 `q`), error paths empty/zero/network (Tasks 1-2), button
  disabled-while-searching (Task 1 `btn.disabled`), reworded Maps copy (Task 3),
  tests with mocked Nominatim (Tasks 1-2). All mapped.
- **No backend:** direct browser `fetch` to nominatim — matches spec decision.
- **Name consistency:** `findCoordsFromName`, `#findCoordsBtn`, `#findCoordsStatus`,
  `#suggestName`/`#suggestLat`/`#suggestLon`/`#suggestCoords` used identically in
  function, markup, and tests. Verified `#suggestCoords` has an `oninput=splitCoords`
  but we set `.value` directly (no input event needed; we also set lat/lon directly).
- **Mock isolation:** the existing supabase-mock only routes `*.supabase.co`, so the
  test's `page.route` for nominatim is the only handler for it — no conflict.

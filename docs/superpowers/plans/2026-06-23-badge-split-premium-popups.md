# Badge Split + Premium Feature Pop-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Make each header bubble badge only its own notification sources; (B) make premium feature tiles/rows clickable, opening an informational detail pop-up.

**Architecture:** Two independent edits to the single-file app `index.html`. Part A rewrites one function body (`recomputeProfileBtnBadge`). Part B introduces a `PREMIUM_FEATURES` data array that renders both premium lists as clickable items and a new `#featureModalOverlay` modal following the app's existing overlay pattern.

**Tech Stack:** Plain HTML/JS single-page app (`index.html`), Playwright e2e tests under `tests/`.

## Global Constraints

- No build step — `index.html` is edited directly.
- User-facing dynamic text rendered via `textContent` or escaped (XSS-safe; matches recent hardening).
- Match existing code style: `$()` helper, inline `style`/`cssText`, existing CSS classes/vars.
- The feature pop-up overlay MUST sit ABOVE the profile overlay: `#profileOverlay` is `z-index:400` and `.modal-overlay` is `z-index:300`, so `#featureModalOverlay` needs an explicit higher z-index (use `500`) or it renders behind the open profile panel.
- Tests run from `tests/`: `npx playwright test`. Admin/test email fixture: `admin@test.dev`.
- Keep the function name `recomputeProfileBtnBadge` (called from `_setTabBadge` at index.html:6419) — change only its body.

---

### Task 1: Part A — split the badge sources per bubble

**Files:**
- Modify: `index.html:6422-6438` (`recomputeProfileBtnBadge` body + comment)
- Test: `tests/e2e/burger-nav.spec.ts` (append two tests)

**Interfaces:**
- Consumes: the hidden carrier spans `#ppNotifCount`, `#ppFriendReqCount`, `#ppContribCount`, `#ppAdminCount` (existing), the `.profile-btn-dot` (a.k.a. `#profileDot`) and `#burgerDot` elements (existing).
- Produces: `recomputeProfileBtnBadge()` writes ONLY notifs to the profile dot, and friends+contrib+admin to the burger dot. Same name, same call site.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/burger-nav.spec.ts`:

```ts
// A notification badges ONLY the bubble it belongs to. Notifs → profile dot;
// friends/contrib/admin → burger dot.
test('an unread alert badges the profile dot but not the burger dot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    localStorage.setItem('kf_notifsSeenAt', '1');
    const notifs = [{
      id: 'n1', type: 'spot', spotName: 'Test Spot', spotLat: 1, spotLon: 1,
      label: 'All sessions', createdAt: new Date().toISOString(),
    }];
    localStorage.setItem('kf_notifs', JSON.stringify(notifs));
    // @ts-expect-error app global
    if (typeof updateTabBadges === 'function') updateTabBadges();
  });
  await expect(page.locator('#profileDot')).toHaveText('1');
  await expect(page.locator('#profileDot')).toHaveClass(/visible/);
  await expect(page.locator('#burgerDot')).not.toHaveClass(/visible/);
});

test('a pending friend request badges the burger dot but not the profile dot', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.evaluate(() => {
    // Simulate the friends badge being set (the real count comes from a mocked
    // Supabase query); drive the carrier span + recompute directly.
    const c = document.getElementById('ppFriendReqCount');
    if (c) { c.textContent = '2'; c.style.display = 'inline'; }
    // @ts-expect-error app global
    if (typeof recomputeProfileBtnBadge === 'function') recomputeProfileBtnBadge();
  });
  await expect(page.locator('#burgerDot')).toHaveText('2');
  await expect(page.locator('#burgerDot')).toHaveClass(/visible/);
  await expect(page.locator('#profileDot')).not.toHaveClass(/visible/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests && npx playwright test e2e/burger-nav.spec.ts -g "badges the"`
Expected: FAIL — current code mirrors the combined total onto both dots, so the "not visible" assertions fail (both dots light up).

- [ ] **Step 3: Replace the function body**

In `index.html`, replace lines 6422-6438 (the comment + `recomputeProfileBtnBadge`) with:

```js
// Each header bubble badges only its own sources. The profile bubble shows
// unread notifications; the menu (burger) bubble shows the actionable items
// reached through the menu (friends + contributions + admin). A count is only
// added when its carrier span is visible, so hidden sections don't leak.
function recomputeProfileBtnBadge(){
  const sum=ids=>{
    let t=0;
    for(const id of ids){
      const el=$(id);
      if(el && el.style.display!=='none') t+=parseInt(el.textContent,10)||0;
    }
    return t;
  };
  const fmt=n=>n>99?'99+':String(n);
  const profileTotal=sum(['ppNotifCount']);
  const menuTotal=sum(['ppFriendReqCount','ppContribCount','ppAdminCount']);
  document.querySelectorAll('.profile-btn-dot').forEach(d=>{
    d.textContent=fmt(profileTotal);
    d.classList.toggle('visible',profileTotal>0);
  });
  const bd=$('burgerDot');
  if(bd){ bd.textContent=fmt(menuTotal); bd.classList.toggle('visible',menuTotal>0); }
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd tests && npx playwright test e2e/burger-nav.spec.ts -g "badges the"`
Expected: PASS (both).

- [ ] **Step 5: Run the full burger-nav spec for regressions**

Run: `cd tests && npx playwright test e2e/burger-nav.spec.ts`
Expected: PASS — including the existing "an unseen alert badges the burger icon" test. NOTE: that existing test sets a NOTIF and asserts `#burgerDot` shows `1`. Under the new split, notifs no longer badge the burger dot — so that test WILL now fail. This is an intended behavior change. Update that existing test to assert the notif badges `#profileDot` instead of `#burgerDot` (keep its burger-list item badge assertion `#burger_notifs_badge` = `1`, which is unchanged because per-item badges are independent of the dot split).

Specifically, in the existing test `'an unseen alert badges the burger icon'`:
- change `await expect(page.locator('#burgerDot')).toHaveText('1');` → `await expect(page.locator('#profileDot')).toHaveText('1');`
- change `await expect(page.locator('#burgerDot')).toHaveClass(/visible/);` → `await expect(page.locator('#profileDot')).toHaveClass(/visible/);`
- rename the test title to `'an unseen alert badges the profile icon'`
- leave the `#burger_notifs_badge` assertion (after opening the burger) as-is.

Re-run: `cd tests && npx playwright test e2e/burger-nav.spec.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/burger-nav.spec.ts
git commit -m "fix(nav): badge profile bubble for notifs, menu bubble for friends/contrib/admin"
```

---

### Task 2: Part B — `PREMIUM_FEATURES` data + render both lists as clickable items

**Files:**
- Modify: `index.html:1484-1498` (non-premium upgrade card — replace inline `<br/>` list with a container)
- Modify: `index.html:1500-1520` (premium-active card — replace the 6 hardcoded tile divs with a container)
- Modify: `index.html` (add `PREMIUM_FEATURES` array + `renderPremiumFeatureLists()` near the premium UI code, ~line 7251; call it on load)
- Test: deferred to Task 3 (rendering is verified together with the modal)

**Interfaces:**
- Consumes: nothing new.
- Produces: global `const PREMIUM_FEATURES` (array of `{key,emoji,label,blurb}`); `renderPremiumFeatureLists()` which fills `#ppPremiumGrid` and `#ppUpgradeFeatures` with clickable items, each carrying `data-feature="<key>"` and wired to `openFeatureModal('<key>')` (defined in Task 3). Items render regardless of premium state.

- [ ] **Step 1: Add the data array**

In `index.html`, immediately above `function updatePremiumUI(){` (line 7251), add:

```js
const PREMIUM_FEATURES = [
  { key:'favs',    emoji:'⭐', label:'Unlimited fav spots',
    blurb:'Save as many favourite spots as you like. The free plan caps you at 1 — Premium removes the limit entirely.' },
  { key:'digest',  emoji:'📬', label:'Weekly wind digest',
    blurb:'Every Monday, get an email forecast for the week ahead across all your favourite spots, so you can plan your sessions early.' },
  { key:'tides',   emoji:'🌊', label:'Tide times',
    blurb:'See the full tide schedule — highs, lows and timing — directly on every spot\'s forecast.' },
  { key:'session', emoji:'🏄', label:'Session tracking',
    blurb:'Log your sessions and let friends know when you\'re on the water, building your riding history over time.' },
  { key:'support', emoji:'🤝', label:'Support indie dev',
    blurb:'KiteForecast is built by one person. Your purchase keeps it running and free for everyone else.' },
  { key:'priority',emoji:'🎯', label:'Priority support',
    blurb:'Get direct access to the team — your questions and requests jump to the front of the queue.' },
];

// Render both premium feature lists (active grid + upgrade list) from the single
// PREMIUM_FEATURES source so they never drift. Each item is clickable and opens
// the feature detail modal. Idempotent — clears its containers before filling.
function renderPremiumFeatureLists(){
  const grid=$('ppPremiumGrid');
  if(grid){
    grid.innerHTML='';
    for(const f of PREMIUM_FEATURES){
      const tile=document.createElement('button');
      tile.type='button';
      tile.className='premium-feature-tile';
      tile.dataset.feature=f.key;
      tile.textContent=`${f.emoji} ${f.label}`;
      tile.onclick=()=>openFeatureModal(f.key);
      grid.appendChild(tile);
    }
  }
  const list=$('ppUpgradeFeatures');
  if(list){
    list.innerHTML='';
    for(const f of PREMIUM_FEATURES){
      const row=document.createElement('button');
      row.type='button';
      row.className='premium-feature-row';
      row.dataset.feature=f.key;
      row.textContent=`${f.emoji} ${f.label}`;
      row.onclick=()=>openFeatureModal(f.key);
      list.appendChild(row);
    }
  }
}
```

- [ ] **Step 2: Replace the premium-active grid markup**

In `index.html`, replace the static grid (lines 1510-1517 — the `<div style="display:grid;...">` containing the six hardcoded tile divs) with an empty container:

```html
            <div id="ppPremiumGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.72rem;"></div>
```

- [ ] **Step 3: Replace the non-premium upgrade list markup**

In `index.html`, replace the inline feature text block (lines 1488-1495 — the `<div style="font-size:.75rem;...">` with the `<br/>`-separated features) with an empty container:

```html
            <div id="ppUpgradeFeatures" style="font-size:.75rem;line-height:1.6;margin-bottom:2px;"></div>
```

Leave the `⚡ Lifetime Access` header (line 1486), the price/subtitle line (1487), and the `Get Lifetime Access` button (1496) unchanged.

- [ ] **Step 4: Add tile/row CSS**

In `index.html`, in the stylesheet (near the other premium styles — search for `.premium-card` or `.btn-premium` and add after), add:

```css
    .premium-feature-tile, .premium-feature-row {
      display:block; width:100%; text-align:left; cursor:pointer;
      font:inherit; color:var(--gray);
      background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.15);
      border-radius:8px; padding:8px 10px;
    }
    .premium-feature-row { margin-bottom:4px; background:transparent; border:1px solid transparent; padding:4px 6px; }
    .premium-feature-tile:hover, .premium-feature-row:hover { border-color:rgba(245,158,11,.4); }
```

- [ ] **Step 5: Call the renderer on load**

In `index.html`, find where `updatePremiumUI()` is first invoked at startup (search for `updatePremiumUI()` call sites — there is an init/boot path). Add a `renderPremiumFeatureLists();` call once during boot, near that invocation. If `updatePremiumUI` is called in multiple places, add the render call ONCE in the initial boot sequence (not inside `updatePremiumUI` itself, to avoid re-rendering on every premium-state refresh). A safe location: immediately after the DOMContentLoaded/init block that first calls `updatePremiumUI()`.

If no obvious single boot call exists, add `renderPremiumFeatureLists();` at the end of `updatePremiumUI()` guarded so it only renders once:

```js
  if(!renderPremiumFeatureLists._done){ renderPremiumFeatureLists(); renderPremiumFeatureLists._done=true; }
```

Place that line just before the closing brace of `updatePremiumUI()`.

- [ ] **Step 6: Verify no JS syntax errors / lists render**

This task's behavior is fully exercised by Task 3's tests (which open the panel and click items). For now, verify the file parses by loading it: run `cd tests && npx playwright test e2e/premium.spec.ts` — the existing two premium tests must still PASS (they check `#ppUpgradeBtn` presence and the `#ppPremiumUpgrade` hidden-for-premium toggle; neither is broken by these container swaps).
Expected: PASS (2 existing tests).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(premium): drive feature lists from PREMIUM_FEATURES data, clickable items"
```

---

### Task 3: Part B — feature detail modal + dismiss wiring + tests

**Files:**
- Modify: `index.html` (add `#featureModalOverlay` HTML near other overlays; add `openFeatureModal`/`closeFeatureModal`/`handleFeatureOverlayClick`; add Escape branch at the keydown handler ~line 4368; add modal CSS)
- Test: `tests/e2e/premium.spec.ts` (append modal tests)

**Interfaces:**
- Consumes: `PREMIUM_FEATURES` (Task 2), the clickable items wired to `openFeatureModal` (Task 2).
- Produces: `openFeatureModal(key)`, `closeFeatureModal()`, `handleFeatureOverlayClick(e)`; the `#featureModalOverlay` / `#featureModalTitle` / `#featureModalBlurb` / `#featureModalEmoji` DOM.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/premium.spec.ts`:

```ts
test('premium user can open a feature detail popup from a grid tile', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="tides"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await expect(page.locator('#featureModalTitle')).toHaveText('Tide times');
  await expect(page.locator('#featureModalBlurb')).toContainText('tide schedule');
});

test('non-premium user can open a feature detail popup from the upgrade list', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await page.locator('#ppUpgradeFeatures .premium-feature-row[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await expect(page.locator('#featureModalTitle')).toHaveText('Unlimited fav spots');
  await expect(page.locator('#featureModalBlurb')).toContainText('favourite spots');
});

test('the feature popup closes via the X button and leaves the profile panel open', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await page.locator('#featureModal .m-close').click();
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the feature popup closes via backdrop click', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  // click the overlay itself (top-left corner avoids the centered card)
  await page.locator('#featureModalOverlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});

test('the feature popup closes via Escape and leaves the profile panel open', async ({ gotoApp, page }) => {
  await gotoApp('premium');
  await page.waitForTimeout(300);
  await page.locator('#profileBtn').click();
  await page.locator('#ppPremiumGrid .premium-feature-tile[data-feature="favs"]').click();
  await expect(page.locator('#featureModalOverlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#featureModalOverlay')).toBeHidden();
  await expect(page.locator('#profileOverlay')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests && npx playwright test e2e/premium.spec.ts -g "feature"`
Expected: FAIL — `#featureModalOverlay` does not exist yet, and `openFeatureModal` is undefined (tile clicks throw).

- [ ] **Step 3: Add the modal HTML**

In `index.html`, near the other overlay divs (e.g. just after the `#profileOverlay` block, or alongside `#suggestUpdateOverlay` ~line 8941), add:

```html
<div id="featureModalOverlay" class="modal-overlay feature-modal-overlay" style="display:none" onclick="handleFeatureOverlayClick(event)">
  <div class="feature-modal" id="featureModal" role="dialog" aria-modal="true" aria-labelledby="featureModalTitle">
    <button class="m-close" onclick="closeFeatureModal()" aria-label="Close" style="position:absolute;top:8px;right:10px">✕</button>
    <div id="featureModalEmoji" style="font-size:2rem;line-height:1;margin-bottom:6px"></div>
    <h3 id="featureModalTitle" style="margin:0 0 8px;font-size:1rem;color:#f59e0b"></h3>
    <p id="featureModalBlurb" style="margin:0;font-size:.82rem;color:var(--gray);line-height:1.5"></p>
  </div>
</div>
```

- [ ] **Step 4: Add the modal CSS**

In `index.html` stylesheet, add (the explicit `z-index:500` is REQUIRED — it must sit above `#profileOverlay`'s z-index:400):

```css
    .feature-modal-overlay { z-index:500; }
    .feature-modal {
      position:relative; max-width:340px; width:calc(100% - 32px);
      background:var(--panel,#0f1626); border:1px solid rgba(245,158,11,.25);
      border-radius:14px; padding:22px 20px 20px; text-align:left;
      box-shadow:0 12px 40px rgba(0,0,0,.5);
    }
```

(If `--panel` is not a defined CSS var, use the same background the other cards use, e.g. `#0f1626` / the profile panel's background — match an existing card.)

- [ ] **Step 5: Add the JS functions**

In `index.html`, near `openFeatureModal`'s consumers (next to `renderPremiumFeatureLists`, ~line 7251), add:

```js
function openFeatureModal(key){
  const f=PREMIUM_FEATURES.find(x=>x.key===key); if(!f) return;
  $('featureModalEmoji').textContent=f.emoji;
  $('featureModalTitle').textContent=f.label;
  $('featureModalBlurb').textContent=f.blurb;
  $('featureModalOverlay').style.display='flex';
}
function closeFeatureModal(){ $('featureModalOverlay').style.display='none'; }
function handleFeatureOverlayClick(e){ if(e.target===$('featureModalOverlay')) closeFeatureModal(); }
```

- [ ] **Step 6: Wire Escape**

In `index.html`, in the keydown handler (line 4368, the chain of `else if(e.key==='Escape'...)`), add a branch BEFORE the `profileOverlay` branch so the popup closes first without closing the profile panel:

```js
  if(e.key==='Escape'&&$('featureModalOverlay').style.display==='flex'){closeFeatureModal();return;}
```

Add this as the FIRST Escape check in that handler (before the existing `modalOverlay` checks is fine too, as long as it is before `profileOverlay`). Using `return` after `closeFeatureModal()` ensures no other overlay also reacts to the same Escape.

- [ ] **Step 7: Run the modal tests to verify they pass**

Run: `cd tests && npx playwright test e2e/premium.spec.ts -g "feature"`
Expected: PASS (all five new tests).

- [ ] **Step 8: Run the full premium spec + full suite for regressions**

Run: `cd tests && npx playwright test e2e/premium.spec.ts`
Expected: PASS (2 existing + 5 new = 7).

Run: `cd tests && npx playwright test`
Expected: PASS (full suite). Report the total count.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/e2e/premium.spec.ts
git commit -m "feat(premium): feature detail popup with backdrop/X/Escape dismiss"
```

---

## Self-Review

**Spec coverage:**
- Part A: profile dot = notifs, menu dot = friends+contrib+admin → Task 1. ✅
- Part A keeps per-item burger badges, hidden-span guard, function name → Task 1. ✅
- Part A updates the now-contradicted existing burger-icon test → Task 1 Step 5. ✅
- Part B: `PREMIUM_FEATURES` single source → Task 2. ✅
- Part B: both premium-active grid AND non-premium upgrade list clickable → Task 2 (both containers). ✅
- Part B: detail popup with emoji/title/blurb, textContent → Task 3. ✅
- Part B: dismiss via backdrop + ✕ + Escape, returns to profile view → Task 3 (3 dismiss tests assert profile still visible). ✅
- Part B: popup renders ABOVE the profile overlay (z-index) → Global Constraints + Task 3 Step 4. ✅

**Placeholder scan:** No TBD/TODO; every code step has full code/commands. The one conditional ("if `--panel` is not defined…", "if no obvious boot call…") gives an explicit fallback, not a placeholder. ✅

**Type/name consistency:** `PREMIUM_FEATURES`, `renderPremiumFeatureLists`, `openFeatureModal`, `closeFeatureModal`, `handleFeatureOverlayClick`, `#ppPremiumGrid`, `#ppUpgradeFeatures`, `#featureModalOverlay`, `.premium-feature-tile`, `.premium-feature-row`, `data-feature` used identically across Tasks 2-3 and the tests. ✅

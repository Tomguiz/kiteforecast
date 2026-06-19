# Burger Menu Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded 7-tab profile panel with two clear entry points — a profile bubble that opens Profile only, and a ☰ burger menu that lists the feature sections, each opening full-screen.

**Architecture:** Reuse the existing `#profileOverlay` / `#profilePanel` as the full-screen section view. The burger opens a list panel; tapping an item calls `openSection(key)` which opens the overlay showing ONLY that section's existing panel body, with a back-arrow header (instead of the tab strip). The profile bubble opens the overlay to Profile only. All per-section render functions and panel bodies are reused in place — only the navigation shell and header change.

**Tech Stack:** Vanilla JS + HTML/CSS in `index.html`; Playwright tests in `tests/`.

---

## File Structure

- Modify: `index.html`
  - Header (`.hero`, ~line 1062): add ☰ burger button.
  - New `#burgerMenu` overlay + list (after the profile panel block, ~line 1340).
  - `#profilePanel` header (~line 1345-1356): replace `.pp-tabs` strip with a back-arrow + title header used by section view.
  - JS: refactor `switchPpTab` → `openSection(key)` + `openProfileSheet()`; add `openBurger()` / `closeBurger()`; generalize badge spans to the burger.
- Modify: `tests/e2e/*.spec.ts` — re-point nav interactions; add `tests/e2e/burger-nav.spec.ts`.

### Section keys (canonical, used everywhere)
`profile | notifs | stats | friends | myspot | contrib | admin`

### Section metadata (single source of truth, added in Task 2)
```
const SECTIONS = {
  notifs:  { title: 'Notifications', icon: '🔔', badge: 'ppNotifCount',     render: renderNotifList },
  stats:   { title: 'Stats',         icon: '📊', badge: null,               render: renderStats },
  friends: { title: 'Friends',       icon: '👥', badge: 'ppFriendReqCount', render: renderFriendsPanel },
  myspot:  { title: 'My Spot',       icon: '📍', badge: null,               render: renderMySpot },
  contrib: { title: 'Contributions', icon: '🎁', badge: 'ppContribCount',   render: renderMyContributions },
  admin:   { title: '⚙️ Admin',      icon: '⚙️', badge: 'ppAdminCount',     render: renderAdminPanel },
};
```

---

## Task 1: Add the burger button to the header

**Files:**
- Modify: `index.html` header (`.hero`), CSS near `.profile-btn` (~line 566)

- [ ] **Step 1: Add the burger button markup**

In the `.hero` header, immediately AFTER the `.home-btn` `<button>` block (the
logo button, ~line 1062) and BEFORE the `.profile-btn`, insert:

```html
  <button class="burger-btn" id="burgerBtn" onclick="openBurger()" title="Menu" aria-label="Menu">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    <span class="burger-dot" id="burgerDot"></span>
  </button>
```

- [ ] **Step 2: Add burger button CSS**

Immediately BEFORE the `.profile-btn {` rule (~line 566), add:

```css
    .burger-btn {
      position:absolute; left:14px; top:14px; z-index:30;
      width:38px; height:38px; border-radius:50%;
      background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2);
      display:flex; align-items:center; justify-content:center; cursor:pointer;
    }
    .burger-btn:hover { background:rgba(255,255,255,.2); }
    .burger-btn svg { stroke:rgba(255,255,255,.7); display:block; }
    .burger-dot {
      position:absolute; top:-4px; right:-4px;
      min-width:16px; height:16px; padding:0 4px; box-sizing:border-box;
      border-radius:999px; background:#f87171; border:2px solid var(--bg);
      color:#fff; font-size:.6rem; font-weight:800; line-height:12px;
      text-align:center; display:none;
    }
    .burger-dot.visible { display:block; }
```

- [ ] **Step 3: Verify it renders without error**

Run: `cd tests && npx playwright test smoke --reporter=line`
Expected: 1 passed (no console errors; `openBurger` not yet defined is fine — it's only called on click).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(nav): add burger button to header"
```

---

## Task 2: Add the burger menu overlay + SECTIONS metadata + openBurger/closeBurger

**Files:**
- Modify: `index.html` — new overlay markup (after `#profileOverlay` block, ~line 1340), JS (near `openProfilePanel`, ~line 5052)

- [ ] **Step 1: Add the burger menu overlay markup**

Immediately AFTER the closing `</div>` of `#profileOverlay` (the line before
`<!-- ══ MODAL ══ -->`, ~line 1340), insert:

```html
<!-- ══ BURGER MENU ══ -->
<div id="burgerOverlay" style="display:none" onclick="if(event.target===this)closeBurger()">
  <div id="burgerPanel">
    <div class="burger-hdr">
      <span class="burger-title">Menu</span>
      <button class="pp-close" onclick="closeBurger()" aria-label="Close">✕</button>
    </div>
    <div id="burgerList"></div>
  </div>
</div>
```

- [ ] **Step 2: Add burger menu CSS**

After the `.burger-dot.visible` rule from Task 1, add:

```css
    #burgerOverlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:200; display:flex; align-items:flex-start; justify-content:flex-start; }
    #burgerPanel { background:var(--surface); width:min(320px,82vw); height:100%; border-right:1px solid var(--border); display:flex; flex-direction:column; animation:burgerSlide .2s ease; overflow-y:auto; }
    @keyframes burgerSlide { from{transform:translateX(-100%)} to{transform:translateX(0)} }
    .burger-hdr { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid var(--border); }
    .burger-title { font-size:1rem; font-weight:800; color:var(--text); }
    .burger-item { display:flex; align-items:center; gap:12px; width:100%; padding:14px 18px; background:none; border:none; border-bottom:1px solid var(--border); color:var(--text); font-size:.9rem; font-weight:600; cursor:pointer; text-align:left; }
    .burger-item:hover { background:var(--card-hov); }
    .burger-item-icon { font-size:1.1rem; width:24px; text-align:center; flex-shrink:0; }
    .burger-item-label { flex:1; }
    .burger-item-badge { min-width:18px; height:18px; padding:0 5px; box-sizing:border-box; border-radius:999px; background:#f87171; color:#fff; font-size:.65rem; font-weight:700; line-height:18px; text-align:center; display:none; }
    .burger-item-badge.visible { display:block; }
```

- [ ] **Step 3: Add SECTIONS metadata + openBurger/closeBurger/renderBurgerList**

Immediately BEFORE `function openProfilePanel(tab){` (~line 5052), insert:

```js
// Section registry — single source of truth for the burger menu + section view.
// NOTE: the render fns (renderStats etc.) are top-level `function` declarations,
// so they're HOISTED — referencing them here is fine even though some are defined
// later in the file.
const SECTIONS = {
  notifs:  { title: 'Notifications', icon: '🔔', badge: 'ppNotifCount',     render: renderNotifList },
  stats:   { title: 'Stats',         icon: '📊', badge: null,               render: renderStats },
  friends: { title: 'Friends',       icon: '👥', badge: 'ppFriendReqCount', render: renderFriendsPanel },
  myspot:  { title: 'My Spot',       icon: '📍', badge: null,               render: renderMySpot },
  contrib: { title: 'Contributions', icon: '🎁', badge: 'ppContribCount',   render: renderMyContributions },
  admin:   { title: '⚙️ Admin',      icon: '⚙️', badge: 'ppAdminCount',     render: renderAdminPanel },
};
// Which optional sections are currently visible (mirrors the old tab visibility).
function sectionVisible(key){
  if(key==='myspot')  return $('ppTabMySpot')  && $('ppTabMySpot').style.display!=='none';
  if(key==='contrib') return $('ppTabContrib') && $('ppTabContrib').style.display!=='none';
  if(key==='admin')   return !!loadProfile().isAdmin;
  return true; // notifs, stats, friends always listed
}
function renderBurgerList(){
  const el=$('burgerList'); if(!el) return;
  el.innerHTML=Object.keys(SECTIONS).filter(sectionVisible).map(key=>{
    const s=SECTIONS[key];
    return `<button class="burger-item" onclick="openSection('${key}')">
      <span class="burger-item-icon">${s.icon}</span>
      <span class="burger-item-label">${s.title}</span>
      <span class="burger-item-badge" id="burger_${key}_badge"></span>
    </button>`;
  }).join('');
  updateTabBadges(); // refresh counts into the new badge spans
}
function openBurger(){
  renderBurgerList();
  $('burgerOverlay').style.display='flex';
  document.body.style.overflow='hidden';
}
function closeBurger(){
  $('burgerOverlay').style.display='none';
  document.body.style.overflow='';
}
```

- [ ] **Step 4: Verify the burger opens and lists sections**

Run: `cd tests && npx playwright test smoke --reporter=line`
Expected: 1 passed. (`openSection` referenced but only on click — defined in Task 3. If smoke fails on a ReferenceError, it means a render fn name is wrong — verify against index.html.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(nav): add burger menu overlay + section registry"
```

---

## Task 3: Refactor switchPpTab into openSection (full-screen section view)

**Files:**
- Modify: `index.html` — `#profilePanel` header (~line 1345-1356), `switchPpTab` (~line 5106-5135), `openProfilePanel` (~line 5052)

- [ ] **Step 1: Replace the tab strip with a section-view header**

Replace the `.pp-tabs` `<div>` block (lines 1346-1354, the 7 tab buttons) with:

```html
      <button class="pp-back" id="ppBackBtn" onclick="backToBurger()" style="display:none" aria-label="Back">‹</button>
      <span class="pp-hdr-title" id="ppHdrTitle">Profile</span>
      <!-- badge spans kept (hidden) so updateTabBadges still finds them -->
      <span id="ppNotifCount" style="display:none"></span>
      <span id="ppFriendReqCount" style="display:none"></span>
      <span id="ppContribCount" style="display:none"></span>
      <span id="ppAdminCount" style="display:none"></span>
```

NOTE: keep the four badge `<span>` ids — `updateTabBadges()` and
`recomputeProfileBtnBadge()` reference them. They're now invisible carriers; the
visible badges live on the burger items + the bubble/burger icons.

- [ ] **Step 2: Add header/back CSS**

After the burger CSS from Task 2, add:

```css
    .pp-back { background:none; border:none; color:var(--accent); font-size:1.8rem; line-height:1; cursor:pointer; padding:0 8px 0 0; }
    .pp-hdr-title { font-size:1rem; font-weight:800; color:var(--text); flex:1; }
```

- [ ] **Step 3: Replace switchPpTab with section-aware logic**

Replace the entire `switchPpTab` function (lines 5106-5135) with:

```js
// Show exactly one panel body in the overlay; hide the rest.
function _showOnlyPanel(key){
  const map={profile:'ppPanelProfile',notifs:'ppPanelNotifs',stats:'ppPanelStats',
    myspot:'ppPanelMySpot',contrib:'ppPanelContrib',admin:'ppPanelAdmin',friends:'ppPanelFriends'};
  Object.values(map).forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
  const showId=map[key]; const showEl=$(showId); if(showEl) showEl.style.display='block';
  ppCurrentTab=key;
}
// Open the Profile sheet (from the profile bubble).
function openProfileSheet(){
  $('profileOverlay').style.display='flex';
  document.body.style.overflow='hidden';
  $('ppBackBtn').style.display='none';
  $('ppHdrTitle').textContent='Profile';
  _showOnlyPanel('profile');
}
// Open a feature section full-screen (from the burger). Reuses the overlay.
function openSection(key){
  const s=SECTIONS[key]; if(!s) return;
  closeBurger();
  $('profileOverlay').style.display='flex';
  document.body.style.overflow='hidden';
  $('ppBackBtn').style.display='block';
  $('ppHdrTitle').textContent=s.title;
  _showOnlyPanel(key);
  s.render();
  // Mark-seen side effects (preserved from the old switchPpTab)
  if(key==='notifs'){ try{ localStorage.setItem('kf_notifsSeenAt', Date.now()); }catch{} _setTabBadge('ppNotifCount',0); }
  if(key==='contrib') markContributionsSeen();
  updateTabBadges();
}
// Back arrow: close the section, reopen the burger list.
function backToBurger(){
  $('profileOverlay').style.display='none';
  openBurger();
}
```

- [ ] **Step 4: Point openProfilePanel at the new functions**

In `openProfilePanel` (~line 5052), replace the body so the bubble opens Profile,
and any legacy `openProfilePanel('<section>')` callers route to the section view.
Replace `switchPpTab(tab);` (line 5058) with:

```js
    if(tab && tab!=='profile' && SECTIONS[tab]){ openSection(tab); return; }
    openProfileSheet();
```

(Leave the rest of `openProfilePanel` — nickname input setup, sync, ensureSession
— intact; it runs for the Profile sheet.)

- [ ] **Step 5: Update the badge recompute to also drive the burger icon + items**

Find `recomputeProfileBtnBadge` (search `function recomputeProfileBtnBadge`).
Append, just before its closing `}`:

```js
  // Mirror the same total onto the burger icon.
  const bd=$('burgerDot'); if(bd){ bd.textContent=total>99?'99+':String(total); bd.classList.toggle('visible',total>0); }
```

Then update `_setTabBadge` (search `function _setTabBadge`) to also write the
matching burger-item badge. Replace its body with:

```js
function _setTabBadge(id,count){
  const b=$(id); if(b){ b.textContent=count||0; b.style.display=count>0?'inline':'none'; }
  // mirror onto the burger list item badge, if present
  const key=Object.keys(SECTIONS).find(k=>SECTIONS[k].badge===id);
  if(key){ const bb=$('burger_'+key+'_badge'); if(bb){ bb.textContent=count||0; bb.classList.toggle('visible',count>0); } }
  recomputeProfileBtnBadge();
}
```

- [ ] **Step 6: Run the full suite (expect FAILURES in old nav tests — fixed in Task 4)**

Run: `cd tests && npx playwright test --reporter=line`
Expected: smoke/auth/premium/favourites PASS; friends/admin/notifications MAY FAIL
because they call `openProfilePanel('friends'|'admin'|'notifs')` and assert the
old tab DOM. Those are re-pointed in Task 4. Note which fail.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(nav): full-screen section view via openSection; bubble opens Profile only"
```

---

## Task 4: Update existing tests to the new navigation

**Files:**
- Modify: `tests/e2e/friends.spec.ts`, `tests/e2e/admin.spec.ts`, `tests/e2e/notifications.spec.ts`, `tests/e2e/premium.spec.ts`

The render targets and ids are unchanged (`#friendsList`, `#ppAdminContent`,
`#ppNotifCount`, `#ppUpgradeBtn`, `#adminEditForm`); only the way a section is
OPENED changes. Every `openProfilePanel('<section>')` still works (Task 3 routes
it to `openSection`). The Profile tab is now opened via `openProfileSheet()`.

- [ ] **Step 1: Friends tests — opening still works (no change needed, verify)**

The friends specs call `openProfilePanel('friends')` which now routes to
`openSection('friends')` and renders into `#friendsList`. Run:

Run: `cd tests && npx playwright test friends --reporter=line`
Expected: PASS. If a test asserted the tab button existed, remove that assertion.

- [ ] **Step 2: Admin tests — verify open + Review/Reject**

Run: `cd tests && npx playwright test admin --reporter=line`
Expected: PASS (opens via `openProfilePanel('admin')` → `openSection`, renders
`#ppAdminContent`). If any step referenced `#ppTabAdmin`, replace with opening
via `openSection('admin')`.

- [ ] **Step 3: Notifications badge-clear test — verify**

The notifications spec opens `openProfilePanel('notifs')`; that now routes to
`openSection('notifs')`, which still runs the mark-seen + badge clear. Run:

Run: `cd tests && npx playwright test notifications --reporter=line`
Expected: PASS (badge clears on open).

- [ ] **Step 4: Premium test — Profile sheet open**

`premium.spec.ts` opens the profile panel and checks `#ppUpgradeBtn` /
`#ppPremiumUpgrade`. With the bubble now opening Profile directly, this still
works. Run:

Run: `cd tests && npx playwright test premium --reporter=line`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd tests && npx playwright test --reporter=line`
Expected: all PASS. Fix any spec that asserted the removed tab strip.

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test(nav): re-point existing specs to burger/section navigation"
```

---

## Task 5: New burger-nav regression tests

**Files:**
- Create: `tests/e2e/burger-nav.spec.ts`

- [ ] **Step 1: Write the burger navigation tests**

```ts
import { test, expect } from '../fixtures/auth';

test('burger menu opens and lists feature sections', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerOverlay')).toBeVisible();
  const list = page.locator('#burgerList');
  await expect(list).toContainText('Notifications');
  await expect(list).toContainText('Stats');
  await expect(list).toContainText('Friends');
});

test('admin sees Admin in the burger; non-signed-out does not', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).toContainText('Admin');
});

test('tapping Friends opens the full-screen section with a back arrow', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await page.getByRole('button', { name: /Friends/ }).click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Friends');
  await expect(page.locator('#ppBackBtn')).toBeVisible();
  await expect(page.locator('#friendsList')).toContainText('Ruben');
  // back arrow returns to the burger list
  await page.locator('#ppBackBtn').click();
  await expect(page.locator('#burgerOverlay')).toBeVisible();
});

test('profile bubble opens Profile only (no tab strip, no back arrow)', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#profileBtn').click();
  await expect(page.locator('#profileOverlay')).toBeVisible();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Profile');
  await expect(page.locator('#ppBackBtn')).toBeHidden();
  await expect(page.locator('.pp-tab')).toHaveCount(0); // old tab strip gone
});
```

- [ ] **Step 2: Run the new tests**

Run: `cd tests && npx playwright test burger-nav --reporter=line`
Expected: 4 passed. If "Friends" button match is ambiguous, scope it to
`page.locator('#burgerList').getByText('Friends')`.

- [ ] **Step 3: Run the FULL suite twice (determinism)**

Run: `cd tests && npx playwright test --reporter=line` (×2)
Expected: all green both runs.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/burger-nav.spec.ts
git commit -m "test(nav): burger menu + section view regression tests"
```

---

## Task 6: Manual verify on the running app + push

- [ ] **Step 1: Drive the live shell in a browser (headed) to eyeball it**

Run: `cd tests && npx playwright test burger-nav --headed`
Watch: burger slides in from the left, sections list with icons + badges,
tapping opens full-screen with back arrow, bubble opens Profile only.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Confirm CI green**

Check the Actions tab / `curl` the workflow runs API; expect the `tests` workflow
to pass.

---

## Self-Review notes

- **Spec coverage:** bubble=Profile (Task 3 `openProfileSheet`), burger list with
  conditional sections (Task 2 `renderBurgerList`+`sectionVisible`), full-screen
  per section + back (Task 3 `openSection`/`backToBurger`), badges reused on
  burger icon+items (Task 3 Step 5), reuse of render fns (SECTIONS registry),
  signed-out section guards (unchanged render fns), tests (Tasks 4-5). All mapped.
- **Reuse-not-move:** panel bodies stay in `#profilePanel`; `_showOnlyPanel`
  toggles them — avoids risky DOM relocation in an 8.8k-line file.
- **Badge ids preserved:** the four count spans remain in the header (hidden) so
  `updateTabBadges`/`recomputeProfileBtnBadge` keep working; `_setTabBadge`
  mirrors to the burger.
- **Type/name consistency:** section keys `notifs|stats|friends|myspot|contrib|admin`
  used identically in SECTIONS, `_showOnlyPanel`, `sectionVisible`, tests. Render
  fn names match index.html (`renderNotifList`, `renderStats`, `renderFriendsPanel`,
  `renderMySpot`, `renderMyContributions`, `renderAdminPanel`).
- **Known adjustment points** flagged inline (ambiguous button matches, removed
  tab-strip assertions) with concrete fallbacks.

# Users Tab — Sort, Nickname, Click-to-see-Spots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the admin Users section so it shows each user's nickname, can be sorted by Created or Last-seen date, and lets the admin click a user to inline-expand their favourite and followed spots.

**Architecture:** One SQL line (nickname on `admin_list_users()`); the rest is client-side in `renderAdminUsers()` plus small helpers, using direct `favourites`/`reminders` table queries (admin RLS already grants read). The Playwright Supabase mock gains per-email keying for those two tables.

**Tech Stack:** Plain HTML/JS single-page app (`index.html`), supabase-js, Playwright e2e under `tests/`.

## Global Constraints

- No build step — `index.html` edited directly.
- Dynamic/user-controlled text (emails, nicknames, spot names) via `textContent` — never `innerHTML` interpolation.
- Direct table queries via `getSb()` (no new RPCs); only `admin_list_users()` SQL changes (adds `nickname`).
- Followed spots = `reminders` where `notif_type='spot'` AND `cancelled=false`, de-duplicated by `spot_name`.
- Favourite display label = `spot_label || spot_name`.
- Sort default: `{key:'created', dir:'desc'}` (preserves current newest-first). Missing/null date sorts to the BOTTOM regardless of direction.
- Accordion: at most one user expanded at a time.
- Tests run from `tests/`: `npx playwright test`. Admin fixture email: `admin@test.dev`.
- SQL is applied to Supabase manually (no migration runner) — "verify SQL" means a static read.

---

### Task 1: SQL — add nickname to `admin_list_users()`

**Files:**
- Modify: `supabase/rls-hardening.sql` (the existing `admin_list_users()` block near the end)

**Interfaces:**
- Produces: `admin_list_users()` now returns a 4th column `nickname text` (from `profiles.nickname`). Existing 3 columns and ordering unchanged.

- [ ] **Step 1: Update the function**

In `supabase/rls-hardening.sql`, replace the existing `admin_list_users()` definition (the `CREATE OR REPLACE FUNCTION admin_list_users() ... $$;` block plus its REVOKE/GRANT) with:

```sql
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE(email text, created_at timestamptz, last_seen_at timestamptz, nickname text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email::text, u.created_at, p.last_seen_at, p.nickname
  FROM auth.users u
  LEFT JOIN profiles p ON p.email = u.email
  WHERE is_admin()
  ORDER BY u.created_at DESC;
$$;
REVOKE ALL ON FUNCTION admin_list_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
```

- [ ] **Step 2: Verify SQL is well-formed**

No DB runner in-repo. Verify by reading: the `RETURNS TABLE(...)` has 4 columns ending in `nickname text`; the SELECT projects `p.nickname` as the 4th column; `WHERE is_admin()` and the REVOKE/GRANT pair are present.
Run: `grep -n "p.nickname\|nickname text" supabase/rls-hardening.sql`
Expected: both the RETURNS column and the SELECT projection appear in the `admin_list_users` block.

- [ ] **Step 3: Commit**

```bash
git add supabase/rls-hardening.sql
git commit -m "feat(admin): return nickname from admin_list_users()"
```

---

### Task 2: Test fixtures — nickname + per-email favourites/reminders mock

**Files:**
- Modify: `tests/fixtures/seed-data.ts` (nickname on `adminUserRows`; add canned spots)
- Modify: `tests/fixtures/supabase-mock.ts` (`MockOptions` + per-email favourites/reminders keying)

**Interfaces:**
- Consumes: nothing at runtime (mock fakes responses).
- Produces:
  - `adminUserRows` now each carry a `nickname` (null for one).
  - `adminFavourites` / `adminReminders`: `Record<email, rows[]>` exported from seed-data.
  - `mockSupabase(page, { usersRpc, adminFavourites, adminReminders })`: GET requests to `favourites`/`reminders` filtered by `?email=eq.<x>` return the rows for that email (or `[]`).

- [ ] **Step 1: Extend the seed data**

In `tests/fixtures/seed-data.ts`, replace `adminUserRows` (lines 49-54) and add canned spots:

```ts
// Canned roster for the admin Users section (admin_list_users RPC).
export const adminUserRows = [
  { email: 'newbie@example.com', created_at: '2026-06-22T10:00:00Z', last_seen_at: null,                 nickname: null },
  { email: 'alice@example.com',  created_at: '2026-06-20T09:00:00Z', last_seen_at: '2026-06-23T08:00:00Z', nickname: 'Alice' },
  { email: 'admin@test.dev',     created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-06-24T07:00:00Z', nickname: 'Boss' },
];

// Per-user favourites / followed spots for the admin Users expand view.
export const adminFavourites: Record<string, Array<{spot_name:string; spot_label:string|null}>> = {
  'alice@example.com': [
    { spot_name: 'Knokke',   spot_label: null },
    { spot_name: 'Oostende', spot_label: 'Oostende beach' },
  ],
  'newbie@example.com': [],
};
export const adminReminders: Record<string, Array<{spot_name:string}>> = {
  'alice@example.com': [
    { spot_name: 'Knokke' }, { spot_name: 'Knokke' }, // dup → de-dups to 1
    { spot_name: 'De Panne' },
  ],
  'newbie@example.com': [],
};
```

Note the last-seen values: alice `2026-06-23`, admin `2026-06-24` (more recent), newbie `null`. This makes a Last-seen sort assertion meaningful (admin newest, then alice, then newbie at the bottom).

- [ ] **Step 2: Add mock options + per-email keying**

In `tests/fixtures/supabase-mock.ts`:

(a) Extend `MockOptions` (currently lines 7-13):

```ts
export type MockOptions = {
  email?: string;
  isPremium?: boolean;
  isAdmin?: boolean;
  favourites?: unknown[];
  usersRpc?: unknown[];
  adminFavourites?: Record<string, unknown[]>;
  adminReminders?: Record<string, unknown[]>;
};
```

(b) In the REST GET branch, before the generic `tableResponse` path, intercept `favourites`/`reminders` when an `email=eq.<x>` filter is present and a per-email map is provided. Add this inside the `if (method === 'GET' || method === 'HEAD')` block, right after `table` is known:

```ts
      // Admin Users expand: per-email favourites/reminders keyed by the email filter.
      const url = req.url();
      const emailMatch = url.match(/email=eq\.([^&]+)/);
      const wantEmail = emailMatch ? decodeURIComponent(emailMatch[1]) : null;
      if (wantEmail && table === 'favourites' && opts.adminFavourites) {
        const rows = opts.adminFavourites[wantEmail] ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows) });
      }
      if (wantEmail && table === 'reminders' && opts.adminReminders) {
        const rows = opts.adminReminders[wantEmail] ?? [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows) });
      }
```

This sits ABOVE the existing generic `tableResponse` handling, so unrelated favourites/reminders queries (no `adminFavourites`/`adminReminders` provided) fall through to the existing behavior unchanged.

- [ ] **Step 3: Type-check**

Run: `cd tests && npx tsc --noEmit`
Expected: PASS (no new type errors).

- [ ] **Step 4: Run the existing admin spec for regressions**

Run: `cd tests && npx playwright test e2e/admin.spec.ts`
Expected: PASS — the nickname field is additive; the existing Users tests don't assert on it yet (Task 4 adds nickname assertions). The `admin_list_users` mock returns `adminUserRows` which now includes `nickname`, harmless to existing assertions.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/seed-data.ts tests/fixtures/supabase-mock.ts
git commit -m "test(admin): seed nicknames + per-email favourites/reminders mock"
```

---

### Task 3: Sort state + helper + sort bar (no expand yet)

**Files:**
- Modify: `index.html` (module state vars + `_sortAdminUsers` + `setAdminUsersSort` + rework `renderAdminUsers` to cache, render a sort bar, and render sorted cards with nickname)
- Test: `tests/e2e/admin.spec.ts` (nickname + sort tests)

**Interfaces:**
- Consumes: `sb.rpc('admin_list_users')` (now returns nickname), `#ppAdminUsersContent`.
- Produces:
  - module vars `_adminUsers`, `_adminUsersSort`, (expand vars added in Task 4).
  - `_sortAdminUsers(arr)` pure sort by `_adminUsersSort`.
  - `setAdminUsersSort(key)` updates state + re-renders.
  - `renderAdminUsers()` renders a sort bar (`#ppUsersSortBar` with buttons `data-sort="created"` / `data-sort="seen"`) and one card per user; email line shows `email · nickname` when nickname present.
  - Each card carries `data-email="<email>"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/admin.spec.ts` (it already imports from `'../fixtures/seed-data'` — add the new names to that import: `adminUserRows, adminFavourites, adminReminders`):

```ts
test('Users cards show the nickname when present, email-only when null', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');
  await expect(content.locator('[data-email="alice@example.com"]')).toContainText('Alice');
  // newbie has null nickname → no separator dot in its email line
  const newbieLine = await content.locator('[data-email="newbie@example.com"]').innerText();
  expect(newbieLine).toContain('newbie@example.com');
  expect(newbieLine).not.toContain('· '); // no "email · nickname" separator
});

test('Users list sorts by created (default) then by last seen, and flips direction', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');

  const order = async () => (await content.innerText());
  // Default: created desc → newbie (Jun 22) before alice (Jun 20) before admin (Jan 1)
  let t = await order();
  expect(t.indexOf('newbie@example.com')).toBeLessThan(t.indexOf('alice@example.com'));
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('admin@test.dev'));

  // Sort by Last seen → admin (Jun 24) before alice (Jun 23); newbie (null) last.
  await content.locator('#ppUsersSortBar [data-sort="seen"]').click();
  t = await order();
  expect(t.indexOf('admin@test.dev')).toBeLessThan(t.indexOf('alice@example.com'));
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('newbie@example.com'));

  // Click active Last seen again → flip to asc → alice before admin; newbie still last (null sinks).
  await content.locator('#ppUsersSortBar [data-sort="seen"]').click();
  t = await order();
  expect(t.indexOf('alice@example.com')).toBeLessThan(t.indexOf('admin@test.dev'));
  expect(t.indexOf('admin@test.dev')).toBeLessThan(t.indexOf('newbie@example.com'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users cards show the nickname|sorts by created"`
Expected: FAIL — no `#ppUsersSortBar`, no `data-email` attrs, nickname not rendered.

- [ ] **Step 3: Add module state + sort helper**

In `index.html`, just above `async function renderAdminUsers(){` (line 6520), add:

```js
let _adminUsers=null;                              // cached roster from admin_list_users
let _adminUsersSort={key:'created',dir:'desc'};    // current sort
const _adminUserSpots={};                          // email → {favs, follows} cache
let _adminUsersExpanded=null;                      // email of the one expanded card, or null

// Pure: return a sorted COPY of the roster by the current sort. Missing dates
// sink to the bottom regardless of direction.
function _sortAdminUsers(arr){
  const field=_adminUsersSort.key==='seen'?'last_seen_at':'created_at';
  const dir=_adminUsersSort.dir==='asc'?1:-1;
  const ts=v=>{ const t=v?new Date(v).getTime():NaN; return isNaN(t)?null:t; };
  return arr.slice().sort((a,b)=>{
    const ta=ts(a[field]), tb=ts(b[field]);
    if(ta===null && tb===null) return 0;
    if(ta===null) return 1;          // a missing → after b
    if(tb===null) return -1;         // b missing → after a
    return (ta-tb)*dir;
  });
}

function setAdminUsersSort(key){
  if(_adminUsersSort.key===key){ _adminUsersSort.dir=_adminUsersSort.dir==='desc'?'asc':'desc'; }
  else { _adminUsersSort={key,dir:'desc'}; }
  _renderAdminUsersList();
}
```

- [ ] **Step 4: Rework `renderAdminUsers` to fetch+cache, and split out list rendering**

Replace the body of `renderAdminUsers()` (lines 6520-6562) with a fetch wrapper + a `_renderAdminUsersList()` that draws the sort bar and cards. The card rendering keeps the existing card style and adds the nickname + `data-email`:

```js
async function renderAdminUsers(){
  const el=$('ppAdminUsersContent'); if(!el) return;
  if(!loadProfile().isAdmin){ el.innerHTML='<div class="stats-empty">Access denied.</div>'; return; }
  el.innerHTML='<div class="stats-empty">Loading…</div>';
  const sb=getSb(); if(!sb) return;
  const{data,error}=await sb.rpc('admin_list_users');
  if(error){
    console.error('[admin] admin_list_users error:',error);
    el.innerHTML='<div class="stats-empty">Couldn\'t load users.</div>';
    return;
  }
  _adminUsers=data||[];
  _adminUsersExpanded=null;
  _renderAdminUsersList();
}

function _renderAdminUsersList(){
  const el=$('ppAdminUsersContent'); if(!el) return;
  const users=_adminUsers||[];
  if(!users.length){ el.innerHTML='<div class="stats-empty">No users.</div>'; return; }
  el.innerHTML='';

  const header=document.createElement('div');
  header.className='stats-section-title';
  header.style.marginBottom='8px';
  header.textContent=`Users (${users.length})`;
  el.appendChild(header);

  // Sort bar
  const bar=document.createElement('div');
  bar.id='ppUsersSortBar';
  bar.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:.72rem;color:var(--tdim)';
  const lbl=document.createElement('span'); lbl.textContent='Sort:'; bar.appendChild(lbl);
  const arrow=k=> _adminUsersSort.key===k ? (_adminUsersSort.dir==='desc'?' ↓':' ↑') : '';
  for(const [k,label] of [['created','Created'],['seen','Last seen']]){
    const b=document.createElement('button');
    b.type='button'; b.dataset.sort=k;
    b.style.cssText='font:inherit;cursor:pointer;border-radius:6px;padding:3px 8px;border:1px solid '+
      (_adminUsersSort.key===k?'rgba(56,189,248,.5)':'var(--border)')+';'+
      'background:'+(_adminUsersSort.key===k?'rgba(56,189,248,.12)':'transparent')+';color:var(--gray)';
    b.textContent=label+arrow(k);
    b.onclick=()=>setAdminUsersSort(k);
    bar.appendChild(b);
  }
  el.appendChild(bar);

  for(const u of _sortAdminUsers(users)){
    const card=document.createElement('div');
    card.dataset.email=u.email;
    card.style.cssText='background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.2);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer';

    const emailEl=document.createElement('div');
    emailEl.style.cssText='font-size:.82rem;font-weight:700;color:#38bdf8;word-break:break-all';
    emailEl.textContent = u.nickname ? `${u.email} · ${u.nickname}` : u.email;
    card.appendChild(emailEl);

    const created=u.created_at
      ? new Date(u.created_at).toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'})
      : '—';
    const meta=document.createElement('div');
    meta.style.cssText='font-size:.7rem;color:var(--tdim);margin-top:2px';
    meta.textContent=`created ${created} · last seen ${_usersRelTime(u.last_seen_at)}`;
    card.appendChild(meta);

    // Detail container (filled lazily in Task 4)
    const detail=document.createElement('div');
    detail.className='pp-user-detail';
    detail.style.cssText='display:none;margin-top:8px';
    card.appendChild(detail);

    card.onclick=()=>toggleUserExpand(u.email,card);
    el.appendChild(card);
  }
}
```

NOTE: `toggleUserExpand` is defined in Task 4. To keep Task 3 independently runnable, add a temporary stub immediately after `_renderAdminUsersList`:

```js
function toggleUserExpand(){ /* implemented in Task 4 */ }
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users cards show the nickname|sorts by created"`
Expected: PASS (both).

- [ ] **Step 6: Run the full admin spec for regressions**

Run: `cd tests && npx playwright test e2e/admin.spec.ts`
Expected: PASS (existing Users tests + the new two). The existing "lists each account" / ordering / empty / error tests still hold (default sort is created-desc; empty + error paths unchanged).

- [ ] **Step 7: Commit**

```bash
git add index.html tests/e2e/admin.spec.ts
git commit -m "feat(admin): sortable Users list (created/last seen) + nickname"
```

---

### Task 4: Click-to-expand favourites + followed spots (accordion)

**Files:**
- Modify: `index.html` (replace the `toggleUserExpand` stub with the real accordion + lazy fetch + render)
- Test: `tests/e2e/admin.spec.ts` (expand tests)

**Interfaces:**
- Consumes: `_adminUsersExpanded`, `_adminUserSpots`, the per-card `.pp-user-detail` container, `getSb()`.
- Produces: `toggleUserExpand(email, cardEl)` — accordion toggle; on first expand fetches favourites + followed (deduped) and renders two labelled lists with counts + empty/error states; caches per email.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/admin.spec.ts`:

```ts
test('clicking a user expands their favourites and following spots', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const alice = page.locator('#ppAdminUsersContent [data-email="alice@example.com"]');
  await alice.click();
  const detail = alice.locator('.pp-user-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Favourites (2)');
  await expect(detail).toContainText('Knokke');
  await expect(detail).toContainText('Oostende beach');   // spot_label preferred
  await expect(detail).toContainText('Following (2)');     // 3 reminder rows, Knokke dup → 2 distinct
  await expect(detail).toContainText('De Panne');

  // Clicking again collapses
  await alice.click();
  await expect(detail).toBeHidden();
});

test('expanding a second user collapses the first (accordion)', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const content = page.locator('#ppAdminUsersContent');
  const alice = content.locator('[data-email="alice@example.com"]');
  const newbie = content.locator('[data-email="newbie@example.com"]');
  await alice.click();
  await expect(alice.locator('.pp-user-detail')).toBeVisible();
  await newbie.click();
  await expect(alice.locator('.pp-user-detail')).toBeHidden();
  await expect(newbie.locator('.pp-user-detail')).toBeVisible();
});

test('a user with no favourites or follows shows empty states', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows, adminFavourites, adminReminders });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  const newbie = page.locator('#ppAdminUsersContent [data-email="newbie@example.com"]');
  await newbie.click();
  const detail = newbie.locator('.pp-user-detail');
  await expect(detail).toContainText('No favourites');
  await expect(detail).toContainText('Not following any spots');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "expands their favourites|accordion|empty states"`
Expected: FAIL — `toggleUserExpand` is a no-op stub.

- [ ] **Step 3: Implement `toggleUserExpand`**

In `index.html`, replace the `function toggleUserExpand(){ /* implemented in Task 4 */ }` stub with:

```js
async function toggleUserExpand(email,card){
  const detail=card.querySelector('.pp-user-detail'); if(!detail) return;

  // Collapse if this one is already open.
  if(_adminUsersExpanded===email){
    detail.style.display='none';
    _adminUsersExpanded=null;
    return;
  }
  // Accordion: collapse any other open card.
  if(_adminUsersExpanded){
    const prev=$('ppAdminUsersContent').querySelector(`[data-email="${CSS.escape(_adminUsersExpanded)}"] .pp-user-detail`);
    if(prev) prev.style.display='none';
  }
  _adminUsersExpanded=email;
  detail.style.display='block';

  // Cached? render from cache.
  if(_adminUserSpots[email]){ _renderUserSpots(detail,_adminUserSpots[email]); return; }

  detail.innerHTML='<div style="font-size:.7rem;color:var(--tdim)">Loading…</div>';
  const sb=getSb(); if(!sb) return;
  const [favRes,remRes]=await Promise.all([
    sb.from('favourites').select('spot_name,spot_label').eq('email',email).order('spot_name'),
    sb.from('reminders').select('spot_name').eq('email',email).eq('notif_type','spot').eq('cancelled',false).order('spot_name'),
  ]);
  // De-dupe follows by spot_name.
  let follows=null;
  if(!remRes.error){
    const seen=new Set(); follows=[];
    for(const r of (remRes.data||[])){ if(!seen.has(r.spot_name)){ seen.add(r.spot_name); follows.push(r.spot_name); } }
  }
  const data={
    favs: favRes.error ? null : (favRes.data||[]).map(f=>f.spot_label||f.spot_name),
    follows,
  };
  _adminUserSpots[email]=data;
  // Only render if still the expanded one (admin may have clicked elsewhere).
  if(_adminUsersExpanded===email) _renderUserSpots(detail,data);
}

// Render the two spot lists into a card's detail container. `favs`/`follows`
// are arrays of display strings, or null when their query errored.
function _renderUserSpots(detail,{favs,follows}){
  detail.innerHTML='';
  const section=(emoji,label,items,emptyMsg)=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='margin-top:6px';
    const head=document.createElement('div');
    head.style.cssText='font-size:.72rem;font-weight:700;color:var(--gray)';
    head.textContent = items===null ? `${emoji} ${label}` : `${emoji} ${label} (${items.length})`;
    wrap.appendChild(head);
    const body=document.createElement('div');
    body.style.cssText='font-size:.72rem;color:var(--tdim);margin-top:2px;word-break:break-word';
    if(items===null){ body.textContent='Couldn\'t load.'; }
    else if(!items.length){ body.textContent=emptyMsg; }
    else { body.textContent=items.join(' · '); }
    wrap.appendChild(body);
    return wrap;
  };
  detail.appendChild(section('⭐','Favourites',favs,'No favourites'));
  detail.appendChild(section('🔔','Following',follows,'Not following any spots'));
}
```

NOTE on the click handler: the card's `onclick` calls `toggleUserExpand`. The detail container is INSIDE the card, so clicks inside the expanded detail will bubble to the card and re-toggle. To prevent a click on the detail area from collapsing the card, the detail content is non-interactive text — but to be safe, stop propagation on the detail container. Add this in `_renderAdminUsersList` where the detail is created (Task 3 created it), OR add at the end of `_renderUserSpots`: `detail.onclick=e=>e.stopPropagation();`. Include `detail.onclick=e=>e.stopPropagation();` at the end of `_renderUserSpots` and also set it on the loading placeholder by adding `detail.onclick=e=>e.stopPropagation();` right after `detail.innerHTML='<div ...>Loading…</div>';` in `toggleUserExpand`.

- [ ] **Step 4: Run the expand tests to verify they pass**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "expands their favourites|accordion|empty states"`
Expected: PASS (all three).

- [ ] **Step 5: Full admin spec + full suite**

Run: `cd tests && npx playwright test e2e/admin.spec.ts`
Expected: PASS.

Run: `cd tests && npx playwright test`
Expected: PASS (report total).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/admin.spec.ts
git commit -m "feat(admin): inline-expand a user's favourite + followed spots (accordion)"
```

---

## Self-Review

**Spec coverage:**
- Nickname on RPC + in card → Task 1 + Task 3. ✅
- Sort by created/last-seen, toggle direction, null sinks to bottom, client-side → Task 3 (`_sortAdminUsers`, `setAdminUsersSort`, sort bar). ✅
- Click → inline expand favourites + following, accordion, lazy fetch + cache, dedupe follows, label preference, empty/error states → Task 4. ✅
- Direct table queries (no new RPC) → Task 4. ✅
- Mock per-email keying + nickname seed → Task 2. ✅
- Tests for nickname, sort (default/switch/flip), expand, accordion, empty → Tasks 3-4. ✅

**Placeholder scan:** Task 3 adds an explicit `toggleUserExpand` stub that Task 4 replaces — not a placeholder, a deliberate seam (noted in both tasks). No TBD/TODO. ✅

**Type/name consistency:** `_adminUsers`, `_adminUsersSort`, `_adminUserSpots`, `_adminUsersExpanded`, `_sortAdminUsers`, `setAdminUsersSort`, `_renderAdminUsersList`, `toggleUserExpand`, `_renderUserSpots`, `#ppUsersSortBar`, `data-sort`, `data-email`, `.pp-user-detail`, `adminFavourites`/`adminReminders` used identically across tasks and tests. ✅

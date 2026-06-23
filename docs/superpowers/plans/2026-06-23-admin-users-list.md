# Admin Users List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Users" section that lists every account with email, true account-created date, and last login — newest signups first.

**Architecture:** A `SECURITY DEFINER` Postgres RPC (`admin_list_users()`) joins `auth.users` (true `created_at`) with `profiles` (`last_seen_at`) and is gated server-side by `is_admin()`. The single-page `index.html` app gains a new `users` entry in the `SECTIONS` registry (admin-gated), its own panel, and a `renderAdminUsers()` function that calls the RPC and renders rows with emails written via `textContent` (XSS-safe).

**Tech Stack:** Plain HTML/JS single-page app (`index.html`), `supabase-js` client, PostgreSQL/Supabase RLS, Playwright e2e tests.

## Global Constraints

- No build step — `index.html` is a single static file edited directly.
- supabase-js direct queries / RPC via the shared `getSb()` client; no new dependencies.
- User-controlled strings (emails) MUST be rendered via `textContent` or escaped, never raw `innerHTML` interpolation (consistent with recent XSS-hardening commits).
- SQL lives in `supabase/rls-hardening.sql`; functions are `CREATE OR REPLACE`, idempotent.
- Admin email in tests/seed fixtures: `admin@test.dev` (`ADMIN_EMAIL` in `tests/fixtures/seed-data.ts`). The production admin is `tom.guisgand@gmail.com`, but tests use the fixture value.
- Tests run from the `tests/` directory with `npx playwright test`.

---

### Task 1: Backend RPC `admin_list_users()`

**Files:**
- Modify: `supabase/rls-hardening.sql` (append at end of file)
- Test: `tests/backend/rls-invariants.sql` (append a documented invariant note)

**Interfaces:**
- Produces: SQL function `admin_list_users()` returning rows `{ email text, created_at timestamptz, last_seen_at timestamptz }`, ordered by `created_at DESC`. Callable from the client as `supabase.rpc('admin_list_users')`. Returns zero rows for non-admin callers.

- [ ] **Step 1: Add the function to `supabase/rls-hardening.sql`**

Append at the end of the file:

```sql
-- ---------------------------------------------------------------------------
-- admin_list_users(): admin-only roster of every account.
-- Joins auth.users (true signup date — not client-queryable directly) with
-- profiles (last_seen_at). SECURITY DEFINER so it can read auth.users; gated
-- by is_admin() so a non-admin caller gets ZERO rows even with EXECUTE granted.
-- LEFT JOIN so a brand-new auth user without a profiles row still appears.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE(email text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email::text, u.created_at, p.last_seen_at
  FROM auth.users u
  LEFT JOIN profiles p ON p.email = u.email
  WHERE is_admin()
  ORDER BY u.created_at DESC;
$$;
REVOKE ALL ON FUNCTION admin_list_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
```

- [ ] **Step 2: Record the invariant**

Append to `tests/backend/rls-invariants.sql`:

```sql
-- admin_list_users(): SECURITY DEFINER, gated by is_admin().
--   * EXECUTE granted to authenticated, REVOKEd from anon/public.
--   * A non-admin caller receives zero rows (WHERE is_admin() short-circuits).
--   * Returns email, created_at (from auth.users), last_seen_at (from profiles).
```

- [ ] **Step 3: Verify SQL is well-formed**

This project applies SQL via the Supabase dashboard / CLI manually (no automated migration runner in-repo). Verify by reading the appended block: confirm balanced `$$ ... $$`, the `REVOKE`/`GRANT` pair present, and `WHERE is_admin()` present. No command to run.

Expected: the block matches Step 1 exactly; `grep -c "admin_list_users" supabase/rls-hardening.sql` returns `3` (definition + REVOKE + GRANT).

- [ ] **Step 4: Commit**

```bash
git add supabase/rls-hardening.sql tests/backend/rls-invariants.sql
git commit -m "feat(admin): admin_list_users() RPC reading auth.users (admin-gated)"
```

---

### Task 2: Mock support for the RPC in tests

**Files:**
- Modify: `tests/fixtures/supabase-mock.ts:72-95` (REST route handler)
- Modify: `tests/fixtures/seed-data.ts` (add `adminUserRows`)
- Modify: `tests/fixtures/supabase-mock.ts:7-12` (add `usersRpc` option)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (the mock fakes the RPC response).
- Produces: `mockSupabase(page, { usersRpc })` — when the app POSTs to `/rest/v1/rpc/admin_list_users`, the mock returns `usersRpc` (an array of `{ email, created_at, last_seen_at }`) instead of the generic empty-write response. Default canned rows exported as `adminUserRows`.

- [ ] **Step 1: Add seed rows**

Append to `tests/fixtures/seed-data.ts`:

```ts
// Canned roster for the admin Users section (admin_list_users RPC).
export const adminUserRows = [
  { email: 'newbie@example.com', created_at: '2026-06-22T10:00:00Z', last_seen_at: null },
  { email: 'alice@example.com',  created_at: '2026-06-20T09:00:00Z', last_seen_at: '2026-06-23T08:00:00Z' },
  { email: 'admin@test.dev',     created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-06-23T07:00:00Z' },
];
```

- [ ] **Step 2: Add the `usersRpc` option to `MockOptions`**

In `tests/fixtures/supabase-mock.ts`, change the `MockOptions` type (lines 7-12) to add one field:

```ts
export type MockOptions = {
  email?: string;
  isPremium?: boolean;
  isAdmin?: boolean;
  favourites?: unknown[];
  usersRpc?: unknown[];   // rows returned by the admin_list_users RPC
};
```

- [ ] **Step 3: Handle the RPC POST in the REST route**

In `tests/fixtures/supabase-mock.ts`, inside the REST route handler, replace the final write-handling line (currently line 93-94):

```ts
    // INSERT/UPDATE/DELETE — return an empty 200/201
    return json(route, [], method === 'POST' ? 201 : 200);
```

with:

```ts
    // RPC calls POST to /rest/v1/rpc/<fn>. Answer admin_list_users explicitly.
    if (method === 'POST' && path.endsWith('/rpc/admin_list_users')) {
      return json(route, opts.usersRpc ?? []);
    }
    // INSERT/UPDATE/DELETE — return an empty 200/201
    return json(route, [], method === 'POST' ? 201 : 200);
```

- [ ] **Step 4: Verify the mock file type-checks**

Run: `cd tests && npx tsc --noEmit`
Expected: PASS (no type errors). If `tsc` reports unrelated pre-existing errors, confirm none reference `supabase-mock.ts` or `seed-data.ts`.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/supabase-mock.ts tests/fixtures/seed-data.ts
git commit -m "test(admin): mock admin_list_users RPC + canned user roster"
```

---

### Task 3: Register the `users` section (gating + panel)

**Files:**
- Modify: `index.html:5091-5098` (SECTIONS registry)
- Modify: `index.html:5100-5105` (sectionVisible)
- Modify: `index.html:1533-1535` (admin panel HTML — add sibling panel)
- Test: `tests/e2e/admin.spec.ts` (append visibility tests)

**Interfaces:**
- Consumes: `loadProfile().isAdmin` (existing), `renderAdminUsers` (defined in Task 4 — referenced here by name).
- Produces: `SECTIONS.users` entry with `panel: 'ppPanelAdminUsers'`; DOM nodes `#ppPanelAdminUsers` and `#ppAdminUsersContent`; `sectionVisible('users')` returns the admin flag.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/admin.spec.ts`:

```ts
test('admin sees Users in the burger menu; non-admin does not', async ({ gotoApp, page }) => {
  await gotoApp('admin');
  await page.waitForTimeout(300); // profile refresh sets isAdmin
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).toContainText('Users');
});

test('non-admin does not see Users in the burger', async ({ gotoApp, page }) => {
  await gotoApp('signedIn');
  await page.locator('#burgerBtn').click();
  await expect(page.locator('#burgerList')).not.toContainText('Users');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users in the burger"`
Expected: FAIL — burger list does not contain "Users" (admin case fails).

- [ ] **Step 3: Add the SECTIONS entry**

In `index.html`, change the registry (lines 5091-5098) to add a `users` line after `admin`:

```js
const SECTIONS = {
  notifs:  { title: 'Notifications', icon: '🔔', badge: 'ppNotifCount',     render: renderNotifList,        panel: 'ppPanelNotifs' },
  stats:   { title: 'Stats',         icon: '📊', badge: null,               render: renderStats,            panel: 'ppPanelStats' },
  friends: { title: 'Friends',       icon: '👥', badge: 'ppFriendReqCount', render: renderFriendsPanel,     panel: 'ppPanelFriends' },
  myspot:  { title: 'My Spot',       icon: '📍', badge: null,               render: renderMySpot,           panel: 'ppPanelMySpot' },
  contrib: { title: 'Contributions', icon: '🎁', badge: 'ppContribCount',   render: renderMyContributions,  panel: 'ppPanelContrib' },
  admin:   { title: 'Admin',         icon: '⚙️', badge: 'ppAdminCount',     render: renderAdminPanel,       panel: 'ppPanelAdmin' },
  users:   { title: 'Users',         icon: '🧑‍🤝‍🧑', badge: null,           render: renderAdminUsers,       panel: 'ppPanelAdminUsers' },
};
```

- [ ] **Step 4: Gate it in `sectionVisible`**

In `index.html`, change `sectionVisible` (lines 5100-5105) to add the `users` gate alongside `admin`:

```js
function sectionVisible(key){
  if(key==='myspot')  return $('ppTabMySpot')  && $('ppTabMySpot').style.display!=='none';
  if(key==='contrib') return $('ppTabContrib') && $('ppTabContrib').style.display!=='none';
  if(key==='admin')   return !!loadProfile().isAdmin;
  if(key==='users')   return !!loadProfile().isAdmin;
  return true; // notifs, stats, friends always listed
}
```

- [ ] **Step 5: Add the panel DOM**

In `index.html`, after the admin panel block (lines 1533-1535), add a sibling:

```html
    <div id="ppPanelAdmin" class="pp-body" style="display:none">
      <div id="ppAdminContent"></div>
    </div>
    <div id="ppPanelAdminUsers" class="pp-body" style="display:none">
      <div id="ppAdminUsersContent"></div>
    </div>
```

- [ ] **Step 6: Add a stub `renderAdminUsers` so the registry resolves**

Task 4 fills this in. To keep Task 3 independently runnable, add a minimal stub immediately before `renderAdminPanel` (line 6502):

```js
async function renderAdminUsers(){
  const el=$('ppAdminUsersContent'); if(!el) return;
  if(!loadProfile().isAdmin){ el.innerHTML='<div class="stats-empty">Access denied.</div>'; return; }
  el.innerHTML='<div class="stats-empty">Loading…</div>';
}
```

- [ ] **Step 7: Run the visibility tests to verify they pass**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users in the burger"`
Expected: PASS (both the admin-sees and non-admin-does-not tests).

- [ ] **Step 8: Commit**

```bash
git add index.html tests/e2e/admin.spec.ts
git commit -m "feat(admin): register admin-only Users section + panel"
```

---

### Task 4: `renderAdminUsers()` — fetch + render rows

**Files:**
- Modify: `index.html` (replace the stub `renderAdminUsers` from Task 3, before line 6502)
- Test: `tests/e2e/admin.spec.ts` (append render tests)

**Interfaces:**
- Consumes: `getSb().rpc('admin_list_users')` (Task 1 / mocked in Task 2), `loadProfile().isAdmin`, `#ppAdminUsersContent`.
- Produces: rendered roster — a `Users (N)` header and one card per user. Emails written via `textContent`. Created date as `DD Mon YYYY`; last seen as relative time with "never" fallback when null.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/admin.spec.ts`:

```ts
import { adminUserRows } from '../fixtures/seed-data';

test('Users section lists each account with created + last-seen', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppHdrTitle')).toHaveText('Users');
  const content = page.locator('#ppAdminUsersContent');
  await expect(content).toContainText('Users (3)');
  await expect(content).toContainText('newbie@example.com');
  await expect(content).toContainText('alice@example.com');
  // newest signup first: newbie (Jun 22) appears before alice (Jun 20)
  const text = await content.innerText();
  expect(text.indexOf('newbie@example.com')).toBeLessThan(text.indexOf('alice@example.com'));
  // a user who never logged in shows "never"
  await expect(content).toContainText('never');
});

test('Users section shows empty state when there are no users', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: [] });
  await page.waitForTimeout(300);
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppAdminUsersContent')).toContainText('No users');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users section"`
Expected: FAIL — stub renders only "Loading…", so "Users (3)" / "No users" are absent.

- [ ] **Step 3: Implement `renderAdminUsers`**

In `index.html`, replace the stub added in Task 3 (before `renderAdminPanel`) with the full implementation:

```js
// Relative "time ago" for the Users roster. Returns 'never' for null.
function _usersRelTime(iso){
  if(!iso) return 'never';
  const then=new Date(iso).getTime();
  if(isNaN(then)) return 'never';
  const secs=Math.floor((Date.now()-then)/1000);
  if(secs<60) return 'just now';
  const mins=Math.floor(secs/60); if(mins<60) return mins+'m ago';
  const hrs=Math.floor(mins/60);  if(hrs<24)  return hrs+'h ago';
  const days=Math.floor(hrs/24);  if(days<30) return days+'d ago';
  return new Date(iso).toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'});
}

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
  const users=data||[];
  if(!users.length){ el.innerHTML='<div class="stats-empty">No users.</div>'; return; }

  // Build via DOM so user-controlled emails go through textContent (no XSS).
  el.innerHTML='';
  const header=document.createElement('div');
  header.className='stats-section-title';
  header.style.marginBottom='8px';
  header.textContent=`Users (${users.length})`;
  el.appendChild(header);

  for(const u of users){
    const card=document.createElement('div');
    card.style.cssText='background:rgba(56,189,248,.06);border:1px solid rgba(56,189,248,.2);border-radius:10px;padding:10px 12px;margin-bottom:8px;';

    const emailEl=document.createElement('div');
    emailEl.style.cssText='font-size:.82rem;font-weight:700;color:#38bdf8;word-break:break-all';
    emailEl.textContent=u.email;
    card.appendChild(emailEl);

    const created=u.created_at
      ? new Date(u.created_at).toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'})
      : '—';
    const meta=document.createElement('div');
    meta.style.cssText='font-size:.7rem;color:var(--tdim);margin-top:2px';
    meta.textContent=`created ${created} · last seen ${_usersRelTime(u.last_seen_at)}`;
    card.appendChild(meta);

    el.appendChild(card);
  }
}
```

- [ ] **Step 4: Run the render tests to verify they pass**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "Users section"`
Expected: PASS (both the roster and empty-state tests).

- [ ] **Step 5: Run the full admin spec for regressions**

Run: `cd tests && npx playwright test e2e/admin.spec.ts`
Expected: PASS (all admin tests, including the Task 3 visibility tests and pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/e2e/admin.spec.ts
git commit -m "feat(admin): render Users roster from admin_list_users RPC"
```

---

### Task 5: RPC-error path test + full suite + push

**Files:**
- Test: `tests/e2e/admin.spec.ts` (append error-path test)

**Interfaces:**
- Consumes: everything above. No new production code unless the error test reveals a gap.

- [ ] **Step 1: Write the error-path test**

The mock answers `admin_list_users` with `200 + rows`. To force the error branch, register a one-off route override in the test that returns a 500 for the RPC, then assert the "Couldn't load" copy.

Append to `tests/e2e/admin.spec.ts`:

```ts
test('Users section shows an error state when the RPC fails', async ({ gotoApp, page }) => {
  await gotoApp('admin', { usersRpc: adminUserRows });
  await page.waitForTimeout(300);
  // Override just the admin_list_users RPC with a 500 (registered last = wins).
  await page.route(/.*\/rest\/v1\/rpc\/admin_list_users.*/, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) }));
  await page.locator('#burgerBtn').click();
  await page.locator('#burgerList').getByText('Users').click();
  await expect(page.locator('#ppAdminUsersContent')).toContainText(/couldn.?t load users/i);
});
```

- [ ] **Step 2: Run the error-path test**

Run: `cd tests && npx playwright test e2e/admin.spec.ts -g "error state when the RPC fails"`
Expected: PASS — `renderAdminUsers` hits the `error` branch and renders "Couldn't load users."

- [ ] **Step 3: Run the full e2e suite for regressions**

Run: `cd tests && npx playwright test`
Expected: PASS (all specs). If any unrelated spec was already failing on `main`, note it but do not fix it here.

- [ ] **Step 4: Commit and push**

```bash
git add tests/e2e/admin.spec.ts
git commit -m "test(admin): cover Users RPC error state"
git push
```

---

## Self-Review

**Spec coverage:**
- RPC reading `auth.users` (admin-gated) → Task 1. ✅
- New top-level admin-only `users` SECTIONS entry + gating + panel → Task 3. ✅
- `renderAdminUsers` calling `sb.rpc('admin_list_users')`, count header, newest-first (handled server-side by `ORDER BY created_at DESC`) → Task 4. ✅
- Columns email / created / last-seen, "never" for null last seen → Task 4 + test. ✅
- Emails via `textContent` (XSS-safe) → Task 4. ✅
- Error state + empty state → Task 4 (empty) & Task 5 (error). ✅
- Tests for hidden-for-non-admin / visible-for-admin / never-logged-in / empty / error → Tasks 3-5. ✅
- Mock support for the new RPC (necessary because the generic mock returns `[]` for POSTs) → Task 2. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code and exact commands. ✅

**Type/name consistency:** `renderAdminUsers`, `ppAdminUsersContent`, `ppPanelAdminUsers`, `admin_list_users`, `usersRpc`, `adminUserRows`, `_usersRelTime` used identically across all tasks. The stub in Task 3 is replaced (not duplicated) in Task 4. ✅

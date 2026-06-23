# Admin Users List — Design

**Date:** 2026-06-23
**Status:** Approved

## Goal

Give admins an admin-only **Users** section that lists every account with:

- email
- account-created date (the **true** signup date)
- last login (`last_seen_at`)

Ordered newest-signup-first, with a total user count at the top, so an admin can see new sign-ups at a glance.

## Background / constraints

- The app is a single-page app in `index.html` using `supabase-js` with direct table queries (no RPC functions exist yet).
- `profiles` table has `last_seen_at` (updated on sign-in / navigation via `updateLastSeen`) but **no** `created_at` column.
- The real account-creation date lives in Supabase's internal `auth.users.created_at`, which the browser client **cannot** query directly.
- RLS: `profiles_select_own` already allows an admin (`is_admin()`) to read all profile rows. The `is_admin()` SECURITY DEFINER helper already exists in `rls-hardening.sql`.
- Admin sections are gated client-side by `loadProfile().isAdmin` and via `sectionVisible()`.

## Approach

Source the created date from `auth.users` via a new **SECURITY DEFINER RPC** (the project's first), admin-gated server-side. Surface the list as a new top-level admin-only **Users** section in the `SECTIONS` registry.

### 1. Backend — `admin_list_users()` RPC

Added to `supabase/rls-hardening.sql`:

```sql
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE(email text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email::text, u.created_at, p.last_seen_at
  FROM auth.users u
  LEFT JOIN profiles p ON p.email = u.email
  WHERE is_admin()
  ORDER BY u.created_at DESC;
$$;
REVOKE ALL ON FUNCTION admin_list_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
```

- `WHERE is_admin()` → a non-admin caller gets **zero rows** even though `EXECUTE` is granted. Defense in depth alongside the client gate.
- `LEFT JOIN` → a brand-new auth user without a `profiles` row still appears (with `last_seen_at = null`).
- `ORDER BY u.created_at DESC` → newest first; no client-side sort needed.
- `SET search_path = public` → safety for SECURITY DEFINER.

### 2. Frontend — new `users` section in `index.html`

- **SECTIONS registry** (~line 5097): add
  `users: { title: 'Users', icon: '👥', badge: null, render: renderAdminUsers, panel: 'ppPanelAdminUsers' }`
- **`sectionVisible()`** (~line 5103): add `if(key==='users') return !!loadProfile().isAdmin;`
- **HTML panel** (near line 1535):
  `<div id="ppPanelAdminUsers" class="pp-body" style="display:none"><div id="ppAdminUsersContent"></div></div>`
- **`renderAdminUsers()`** function:
  - Re-check `if(!loadProfile().isAdmin)` → access-denied fallback.
  - Call `await getSb().rpc('admin_list_users')`.
  - Render count header (`Users (N)`) + one card per user, matching the existing admin card style.
  - Dates: created → calendar date; last seen → relative ("2h ago") with date fallback, "never" when null.
  - All user-controlled text (emails) rendered via `textContent` / escaped — consistent with recent XSS-hardening work.

### 3. Data flow

`renderAdminUsers` → `supabase.rpc('admin_list_users')` → rows pre-sorted newest-first → render. No client-side sorting.

### 4. Error / empty handling

- RPC error → `<div class="stats-empty">Couldn't load users.</div>`
- Empty result → `<div class="stats-empty">No users.</div>`

### 5. Testing

Add a spec under `tests/` mirroring the existing nav/section tests:

- Users section hidden for non-admin, visible for admin (`sectionVisible`).
- `renderAdminUsers` renders rows from a mocked `rpc` response.
- Covers: a user who never logged in (`last_seen_at = null` → "never"), the empty-list case, and the RPC-error case.

## Out of scope (YAGNI)

- Search / pagination / column sorting in the UI.
- Premium/admin badges (considered, declined for v1).
- Editing or deleting users from this view.

# Users Tab — Sort, Nickname, Click-to-see-Spots — Design

**Date:** 2026-06-24
**Status:** Approved

Three additions to the existing admin **Users** section in `index.html`:
1. Sort the list by **Created** or **Last seen** date (toggle buttons, flip direction).
2. Show each user's **nickname**.
3. Click a user to inline-expand their **Favourites** and **Following** (notification-trigger) spots.

All data is readable with the admin's existing RLS access (`favourites`, `reminders`, `profiles` all carry `email = auth_email() OR is_admin()` SELECT policies). Only one line of new SQL (nickname); the rest is direct client table queries.

## Background

- `admin_list_users()` RPC (supabase/rls-hardening.sql) returns `email, created_at, last_seen_at`.
- `renderAdminUsers()` (index.html ~6520-6562) renders one card per user (email + created + last-seen).
- `favourites` table: `email`, `spot_name`, `spot_label`, `spot_lat`, `spot_lon`, … `UNIQUE(email, spot_name)`.
- `reminders` table: `email`, `spot_name`, `notif_type` (`'spot'` | `'day'`), `cancelled`, … The followed/notification spots are `notif_type='spot' AND cancelled=false`. (The browser `kf_notifs` localStorage is just a per-user cache of this table; the table is the authoritative, admin-readable source.)
- `profiles.nickname` exists (nullable). Spots join on `spot_name` across tables.

## Part 1 — Nickname

### SQL (supabase/rls-hardening.sql)

Extend `admin_list_users()` (the only SQL change in this feature):

```sql
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE(email text, created_at timestamptz, last_seen_at timestamptz, nickname text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email::text, u.created_at, p.last_seen_at, p.nickname
  FROM auth.users u
  LEFT JOIN profiles p ON p.email = u.email
  WHERE is_admin()
  ORDER BY u.created_at DESC;
$$;
REVOKE ALL ON FUNCTION admin_list_users() FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;
```

(Must be applied to Supabase manually — no migration runner.)

### UI

In each user card, the email line becomes `email · nickname` when a nickname exists; just the email when null. Nickname rendered via `textContent` (XSS-safe).

## Part 2 — Sort toggle

A sort bar rendered once, above the user list:

```
Sort:  [ Created ↓ ]  [ Last seen ]
```

- Two buttons: **Created** and **Last seen**.
- State held in a module variable: `_adminUsersSort = { key:'created', dir:'desc' }`. Default `created`/`desc` (preserves current newest-first behavior).
- Click an INACTIVE button → switch `key` to it, reset `dir` to `desc` (most-recent first).
- Click the ACTIVE button → flip `dir` (`desc`↔`asc`).
- The active button shows `↓` (desc) or `↑` (asc); the inactive shows no arrow.
- Sorting is **client-side** on the already-fetched `_adminUsers` array (instant, no refetch). Re-render the cards in place; preserve which user (if any) is expanded by email.

### `_sortAdminUsers(arr)` (pure)

Sorts a copy of `arr` by `_adminUsersSort`. Field: `created_at` or `last_seen_at`. Compare by timestamp (`new Date(x).getTime()`, missing/`null` → treated as `-Infinity` so it always sorts to the BOTTOM regardless of direction). Returns the sorted copy.

## Part 3 — Click a user → inline expand (accordion)

Clicking a user card toggles an expanded region directly beneath that card.

- **Accordion:** opening a user collapses any other expanded user (`_adminUsersExpanded` holds at most one email).
- **Lazy fetch + cache:** on first expand of a user, fetch their spots; cache in `_adminUserSpots[email] = {favs, follows}`. Re-expanding uses the cache (no refetch).
- Re-clicking the expanded user collapses it.

### Queries (direct, admin RLS grants access)

```js
const [{data:favs,error:fErr},{data:follows,error:rErr}] = await Promise.all([
  sb.from('favourites').select('spot_name,spot_label').eq('email',email).order('spot_name'),
  sb.from('reminders').select('spot_name').eq('email',email)
    .eq('notif_type','spot').eq('cancelled',false).order('spot_name'),
]);
```

Follows may contain duplicate `spot_name` rows (one per session_date historically); de-duplicate by `spot_name` client-side before counting/rendering.

### Rendered detail

```
⭐ Favourites (3)
   Knokke · Oostende · Wissant
🔔 Following (2)
   Knokke · De Panne
```

- Favourite label preference: `spot_label || spot_name`.
- Each list shows a count and the names (via `textContent`).
- **Empty states:** "No favourites" / "Not following any spots".
- **Error fallback:** if a query errors, that list shows "Couldn't load." (the other still renders).

### Functions / boundaries

- `renderAdminUsers()` — fetch users (RPC), render sort bar + cards (extended existing fn).
- `_sortAdminUsers(arr)` — pure sort helper.
- `setAdminUsersSort(key)` — update sort state + re-render.
- `toggleUserExpand(email, cardEl)` — accordion toggle + lazy fetch + render the two lists.

Module state: `_adminUsers` (array), `_adminUsersSort`, `_adminUsersExpanded` (email|null), `_adminUserSpots` (cache).

## Data flow

`renderAdminUsers` → `rpc('admin_list_users')` → cache `_adminUsers` → render sort bar + `_sortAdminUsers(_adminUsers)` cards. Click card → `toggleUserExpand` → cache hit or `Promise.all([favs, follows])` → render lists.

## Testing (tests/e2e/admin.spec.ts + fixtures)

**Mock enhancement (tests/fixtures/supabase-mock.ts):** the REST GET handler currently returns `opts.favourites ?? []` for `favourites` and `[]` for `reminders`, ignoring the `?email=eq.<x>` filter. Enhance the mock so favourites/reminders responses can be keyed by the requested email (parse `email=eq.<value>` from the request URL and return canned rows for that email). Add `MockOptions.adminFavourites?: Record<email, rows>` and `adminReminders?: Record<email, rows>` (or equivalent); default to empty arrays when unset so existing tests are unaffected.

**Seed (tests/fixtures/seed-data.ts):** extend `adminUserRows` with `nickname` values (some null), and add canned favourites/reminders keyed by two of the seed emails.

**Tests:**
- Nickname renders in the card; the null-nickname user shows email only (no trailing `·`).
- Sort: default order is Created-desc; clicking **Last seen** reorders by last-seen desc; clicking the active **Last seen** again flips to asc (assert order via `indexOf` of two emails).
- Click a user → `⭐ Favourites (N)` and `🔔 Following (N)` appear with the expected spot names; click again → lists gone (collapsed); expanding a second user collapses the first.
- A user with no favourites / no follows shows the empty-state copy.

## Out of scope (YAGNI)

No search/filter, no pagination, no editing spots, no map, no per-spot detail, no `notif_type='day'` reminders (only ongoing `'spot'` follows).

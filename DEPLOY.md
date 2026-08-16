# Deploying

Four things ship separately, and only some are automatic. Knowing which is
which is the difference between "my fix isn't working" and a five-second check.

| What | How it ships | Automatic? |
|---|---|---|
| `index.html` (the app) | GitHub Pages, on push to `main` | ✅ |
| `supabase/functions/**` | `.github/workflows/deploy-functions.yml`, on push to `main` | ✅ |
| `supabase/schema.sql`, `rls-hardening.sql` | You run it by hand | ❌ |
| `emails/*.html` | Make.com fetches them live from `main` | ✅ — but mind the order below |

## First: is the fix actually deployed?

Before debugging a backend fix that "didn't work", check whether it ever
shipped. This has caused three separate incidents.

```bash
supabase functions list        # VERSION + UPDATED_AT (UTC)
git log --date=iso --format="%h %ad %s" -- supabase/functions/<fn>/index.ts
```

If `UPDATED_AT` predates the commit, the code in `main` is not the code that is
running.

- **2026-08-15** — the weekly-digest override-dirs fix was committed at 17:44
  UTC while the deployed version dated from 17:16 UTC, 28 minutes earlier. It
  mailed empty digests for a month.
- **2026-08-15** — the CI workflow deploys **all** functions from `main`, so an
  unrelated merge reverted a manual hotfix that lived only in an unmerged
  branch. **Never leave a manual deploy ahead of `main`**: merge it, or the next
  push silently rolls it back.
- **2026-08-16** — the deploy job failed in 6 seconds. `supabase/setup-cli` was
  set to `version: latest`, which resolves the release through an
  unauthenticated GitHub API call, and that call was rate-limited. The workflow
  now pins a version. Bump it deliberately.

## Schema: applied by hand

`supabase/schema.sql` is the source of truth, but nothing runs it for you. A
column committed to that file does not exist in the live database until someone
applies it. Forgetting produces:

> Could not find the 'crowd_level' column of 'spot_info' in the schema cache

(seen 2026-06-30: the spot-attributes columns were committed but never applied.)

The project is linked (`supabase/.temp/project-ref`), so the CLI can run SQL
against the **remote** database through the Management API — **no Docker, no DB
password**:

```bash
# Apply the whole schema (idempotent — safe to re-run):
supabase db query --linked --yes -f supabase/schema.sql

# Or a one-off statement:
supabase db query --linked --yes "ALTER TABLE spot_info ADD COLUMN IF NOT EXISTS foo text;"
```

`schema.sql` is idempotent: `CREATE TABLE IF NOT EXISTS`, and `ADD COLUMN`
guarded by `EXCEPTION WHEN duplicate_column`.

Two traps:

- **`supabase db query` chokes on SQL beginning with a `--` comment.** The CLI
  reads the leading dashes as a flag and fails with `unknown flag`. Strip
  leading comment lines, or start the file with a statement.
- **`rls-hardening.sql` is not fully applied live.** Its policies are all in
  place (verified 2026-08-16 — every public table has 3–4), but the
  `_drop_all_policies()` helper it defines does **not** exist in the database.
  Anything calling that helper fails; write explicit `DROP POLICY IF EXISTS`.

## After any DDL: reload the PostgREST cache

PostgREST caches the schema and will not see new columns until told:

```sql
NOTIFY pgrst, 'reload schema';
```

## Verify what is actually live

```bash
supabase db query --linked \
  "select column_name from information_schema.columns
   where table_schema='public' and table_name='spot_info' order by column_name;"
```

Verify *after* applying, not before — the apply step is where a typo surfaces.

## Email templates: order matters

Make.com fetches templates from `raw.githubusercontent.com/.../main/emails/…`
at send time and fills them with a nested `replace()` chain, one call per
`[[placeholder]]`. **That chain lives in Make, not in this repo.**

So adding a placeholder has a strict order:

1. Add the mapping in the Make scenario **first**.
2. Then merge the template change.

Reversed, every email — including for users who never opted into the feature —
ships a literal `[[nearby_html]]` in its body. A placeholder with no mapping
renders as raw text; a mapping with no placeholder is harmless.

## Frontend: expect a delay

GitHub Pages serves `index.html` with `cache-control: max-age=600`, so a change
can take up to ten minutes to reach a browser that has already loaded the page,
and longer in an installed PWA until it is reopened. If a released feature still
looks gated on a device, check the served file before suspecting the code:

```bash
curl -s https://tomguiz.github.io/kiteforecast/ | grep -o "NEARBY_RELEASED = [a-z]*"
```

## Checklist when adding a column or table

- [ ] Add the idempotent DDL to `supabase/schema.sql`
- [ ] Apply it live (`supabase db query --linked --yes -f supabase/schema.sql`)
- [ ] `NOTIFY pgrst, 'reload schema';`
- [ ] Verify the column exists live (query above)
- [ ] Commit + push

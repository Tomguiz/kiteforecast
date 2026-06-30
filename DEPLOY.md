# Deploying database changes

`supabase/schema.sql` is the **source of truth**, but it is **applied manually** —
there is no automated migration runner. When a feature adds a column/table to
`schema.sql` (or to `rls-hardening.sql`), that change does **not** reach the live
database until someone runs it. Forgetting this produces PostgREST errors like:

> Could not find the 'crowd_level' column of 'spot_info' in the schema cache

(seen 2026-06-30: the spot-attributes columns were committed but never applied.)

## Apply schema changes to the live DB

The project is linked (`supabase/.temp/project-ref`). The Supabase CLI can run SQL
against the **remote** database via the Management API — **no Docker, no DB
password required** — using `--linked`:

```bash
# Run a migration / DDL against production:
supabase db query --linked --yes -f supabase/schema.sql

# Or run a one-off statement:
supabase db query --linked --yes "ALTER TABLE spot_info ADD COLUMN IF NOT EXISTS foo text;"
```

`schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded by
`EXCEPTION WHEN duplicate_column`), so re-running it is safe.

## After any DDL: reload the PostgREST schema cache

PostgREST caches the schema and may not see new columns immediately. Always end with:

```sql
NOTIFY pgrst, 'reload schema';
```

## Verify what's actually live

```bash
supabase db query --linked -o csv \
  "select column_name from information_schema.columns
   where table_schema='public' and table_name='spot_info' order by column_name;"
```

## Checklist when adding a column/table

- [ ] Add the idempotent DDL to `supabase/schema.sql`
- [ ] Apply it to the live DB (`supabase db query --linked --yes -f supabase/schema.sql`)
- [ ] `NOTIFY pgrst, 'reload schema';`
- [ ] Verify the column exists live (query above)
- [ ] Commit + push

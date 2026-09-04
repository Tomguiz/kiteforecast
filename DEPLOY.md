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
- **2026-08-20** — the merge of #48 emitted **no push event at all**. Not one
  workflow ran: no `tests`, no `pages-build-deployment`, no `deploy-functions`.
  The PR said "merged", `origin/main` had the commit, and nothing shipped. The
  change had touched both `index.html` and `_shared/rideability.ts`, so the two
  halves of one rule drifted apart in production: the edge functions were
  redeployed by hand to a 30-degree tolerance while Pages still served the
  build from the previous day at 22.5. See **When a push event goes missing**.

## Secrets the functions read

Set with `supabase secrets set NAME=value --project-ref kpwmajtxmcfpakvonimf`
(or in the dashboard under Edge Functions → Secrets). A function reads them at
call time, so a change takes effect on the next request, no redeploy needed.

| Secret | Read by | Without it |
|---|---|---|
| `STORMGLASS_KEY` | `forecast`, `tide-proxy` | Forecasts fall back to Open-Meteo and say so in `wx.provider`; the tide badge is empty |
| `STORMGLASS_SOURCE` (optional) | `forecast` | Defaults to `sg`, Stormglass's per-point pick of the best model. Set a named source (`icon`, `ecmwf`, `meteofrance`, ...) to pin one |
| `SB_SERVICE_ROLE_KEY` | every function that writes | Nothing works |

The forecast function counts Stormglass's daily quota from each answer and
stops asking a few requests short of it, so the tide badge keeps its share.
Once that reserve is reached, or Stormglass answers 402, the rest of the day
is served from Open-Meteo — the app keeps working, on the free numbers.

## When a push event goes missing

Everything here triggers on `push` to `main`. If GitHub does not emit that
event, every job is skipped silently — there is no failed run to notice,
because there is no run. A green PR page proves the merge, never the deploy.

Check what is actually being served, not what `git log` says:

```bash
curl -sI https://kiteforecast.app/index.html | grep -i last-modified
gh run list --limit 5 --json headSha,workflowName,status \
  -q '.[]|"\(.headSha[0:7]) \(.workflowName) \(.status)"'
```

If `last-modified` predates the merge, or no run lists the merge commit's SHA,
nothing shipped.

Re-triggering differs per workflow, because only one of them can be dispatched:

```bash
# deploy-functions HAS workflow_dispatch — just re-run it
gh workflow run deploy-functions --ref main

# pages-build-deployment is GitHub-generated and has NO workflow_dispatch
# (dispatching it returns HTTP 422). It needs a real push:
git commit --allow-empty -m "chore(ci): re-trigger the deploy chain"
git push origin main
```

An empty commit is the only lever for Pages. That is a deliberate exception to
the PR-only flow: no PR can fix a push event that was never emitted.

**Deploy a rule that lives in two places all at once.** `rideability.ts` and
`index.html` hold the same wind rule. Half-deployed, the app and the emails
disagree — which is the exact bug the shared module was created to prevent.

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
curl -s https://kiteforecast.app/ | grep -o "NEARBY_RELEASED = [a-z]*"
```

## The domain

The app is served at `https://kiteforecast.app`, from the same GitHub Pages
build as before. The `CNAME` file at the repo root is what tells Pages to claim
that domain — deleting it silently hands the site back to
`tomguiz.github.io/kiteforecast/` and breaks every link already sitting in a
sent email.

DNS lives in Cloudflare. The apex is a CNAME to `tomguiz.github.io` (Cloudflare
flattens it, which is legal at the apex where a raw CNAME is not), **DNS-only —
grey cloud, not proxied**. Proxying breaks GitHub's certificate issuance: it
answers the ACME challenge itself and Pages never gets its cert. Turn the proxy
on afterwards if you want it, and only with SSL mode *Full*.

**Order matters, and getting it backwards takes the site down.** The `CNAME`
file makes Pages redirect `tomguiz.github.io/kiteforecast/` to the new domain,
so if that domain does not resolve yet, both URLs are dead:

1. Add the DNS record in Cloudflare. Nothing breaks — the domain simply starts
   answering with a Pages 404, while `github.io` keeps serving the app.
2. Then merge. Pages picks up `CNAME`, requests the certificate, and starts
   redirecting.

```bash
dig +short kiteforecast.app                        # must answer before step 2
curl -sI https://kiteforecast.app/ | head -1       # 200 once the cert is issued
curl -sI https://tomguiz.github.io/kiteforecast/ | grep -i ^location  # the redirect
```

Two things live outside this repo and will not follow the merge:

- **Google sign-in.** The One Tap client
  (`927737240724-…apps.googleusercontent.com`) validates the page's origin, so
  both origins are listed on it — done on 2026-09-01, alongside the switch. If
  sign-in ever fails with `origin_mismatch`, that list is the first place to
  look: console.cloud.google.com/auth/clients, project `kiteforecast-498013`.
  Reach it by **project number** (`?project=927737240724`) or by that id — the
  display name `kiteforecast` in the URL returns "You need additional access",
  which reads like a permissions problem and is not one.
- **Stripe.** Nothing to change: checkout and portal URLs are sent by the
  client per request, and the functions' fallbacks now point at the new domain.

Supabase Auth needs nothing: sign-in is a six-digit code verified in the page
(`verifyOtp`), never a redirect back from a magic link, so no allow-list.

## Checklist after any merge to `main`

- [ ] A run exists for the merge commit's SHA (`gh run list`)
- [ ] `last-modified` on the live `index.html` is newer than the merge
- [ ] If functions changed, `supabase functions list` post-dates the commit
- [ ] If the change spans `index.html` **and** `supabase/functions/**`, confirm
      both halves shipped before calling it done

## Checklist when adding a column or table

- [ ] Add the idempotent DDL to `supabase/schema.sql`
- [ ] Apply it live (`supabase db query --linked --yes -f supabase/schema.sql`)
- [ ] `NOTIFY pgrst, 'reload schema';`
- [ ] Verify the column exists live (query above)
- [ ] Commit + push

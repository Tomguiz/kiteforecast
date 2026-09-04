# KiteForecast — working agreements for Claude

## Merging

Merge your own pull requests as soon as CI is green and there is no
conflict. Do not wait for Tom to confirm; he asked for this explicitly
("always merge please, do not wait for me to confirm"). Squash-merge with
the repo's commit style (`type(scope): title (#N)`), mark the PR ready for
review first (GitHub refuses to merge a draft), and unsubscribe once it is
merged. The only reason to hold a merge is a red or conflicted head.

## Shape of the repo

- `index.html` is the whole app, a single plain script. Rules shared with
  the backend (rideable hours, the day rating, kite size, the planner) exist
  twice on purpose: once in `supabase/functions/_shared/`, once in
  `index.html` between marker comments. A mirror test in `tests/unit/` pins
  each pair; change both sides together.
- Forecasts come from `supabase/functions/_shared/forecast-source.ts`.
  Open-Meteo, read from the sea grid cell, is the default for everything.
  Stormglass (paid, the `STORMGLASS_KEY` secret shared with the tide badge)
  can be laid over the first ten days with `STORMGLASS_FORECAST=on`, but it
  measured low and gusty against the Cadzand mast (see `DEPLOY.md`), so it
  stays off until `tests/tools/forecast-accuracy.mjs --rws` shows a model of
  its beating the sea cell. Every row says where it came from in
  `wx.provider`. The `forecast` function caches one row per spot; the
  reminder, new-session and digest jobs read that same row through
  `_shared/forecast-client.ts` rather than fetching their own.
- Email templates in `emails/` are fetched from `main` at send time, so
  merging a template change is deploying it. Edge functions deploy from
  `main` through `.github/workflows/deploy-functions.yml`.
- Tests live in `tests/`: `npm run unit` (vitest) and `npx playwright test`
  (e2e against a mocked Supabase). In the remote sandbox Playwright must be
  pointed at the preinstalled Chromium via `launchOptions.executablePath`,
  and a few specs (`smoke`, `attend-cancel`, `spot-data-xss`,
  `activity-feed`) fail there for environmental reasons that CI does not
  share.

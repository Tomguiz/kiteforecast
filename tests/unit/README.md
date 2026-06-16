# Unit tests (deferred)

Pure-logic unit tests are intentionally not set up yet: the app's JS lives
inline in `index.html` and was not extracted (project decision, 2026-06-17).

When logic is later moved into an importable module (e.g. `app-logic.js`
loaded by `index.html` via `<script>`), add Vitest here:

1. `npm i -D vitest` in `tests/`.
2. Add `"unit": "vitest run"` to `tests/package.json` scripts.
3. Test pure functions (note parsing, premium checks, fav limits, direction math)
   by importing the shared module.

Until then, all coverage is E2E in `../e2e/`.

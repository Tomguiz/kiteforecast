# Low-Confidence Styling for Days 11–16 — Design

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Goal

The app now fetches a 16-day forecast, but days 11–16 come from the free GFS
model and are notably less reliable than days 1–10. Visually **de-emphasise
days 11–16** (opacity fade) in both the 16-day card strip and the forecast grid,
and add one quiet caption explaining why, so users aren't misled by long-range
wind they shouldn't trust.

## Scope

- **In scope:** opacity-fade days at index ≥ 10 in the 16-day strip
  (`.tds-day-card`) and the forecast grid (`.day-card`); one CSS rule; a quiet
  caption under the "16-day overview" header. Pure front-end, single file.
- **Out of scope:** any data/API change (we already fetch 16 days); changing the
  rideable-day count or any forecast logic; per-day confidence scoring.

## Treatment

- **Threshold:** day index `i >= 10` (i.e. the 11th day onward) is
  "low-confidence". Index is 0-based over `daily.time`.
- **Visual:** the whole card is faded to `opacity: 0.5`. Cards remain fully
  tappable and functional (open-modal, session glow, etc. all still work — just
  muted). This matches the chosen mockup (option A — opacity fade).
- **Both surfaces:** the compact strip cards AND the full grid cards below.

### Implementation shape

A single shared CSS rule:

```css
.tds-day-card.tds-lowconf, .day-card.day-lowconf { opacity:.5; }
```

(Two distinct class names because the two card types are otherwise unrelated;
one rule covers both.)

- **Strip** (`renderGrid`, the `#tdsCols` builder, card template ~line 4246):
  add `${i>=10?' tds-lowconf':''}` to the `tds-day-card` class list.
- **Grid** (`renderGrid`, the `.day-card` builder, ~line 4183):
  `card.className='day-card'+(goodHours>=2?' has-session':'')+(i>=10?' day-lowconf':'')`.

Both loops already iterate `daily.time` with index `i`, so the threshold is a
trivial index check — no new data needed.

## Clarity caption

Under the "16-day overview" header (`.tds-header`, ~line 1310-1313), add a small
caption line so the fade has meaning. The header currently holds the title +
"swipe → for more". Add, BELOW the header row, a quiet micro-caption:

```html
<div class="tds-lowconf-note">ⓘ days 11–16 are a lower-confidence outlook</div>
```

styled `font-size:.6rem; color:var(--tdim); padding:0 2px 6px;`. No popup, no
interaction — just a one-line explanation. The grid below needs no separate
caption; the strip caption establishes the concept for the whole page.

Because the strip is mobile-only (`#tenDayStripWrap` is hidden ≥600px via the
existing media query), on desktop the caption is hidden with the strip. That is
acceptable for Phase 1 — the fade still de-emphasises the far grid cards on
desktop, and the caption is a nice-to-have, not load-bearing. (If desktop needs
the caption later, that's a follow-up.)

## Testing (Playwright e2e, existing patterns)

Add `tests/e2e/lowconf-days.spec.ts`:
1. Seed a 16-day `cachedWx`/`cachedHrMap`, call `renderGrid()`.
2. Assert strip: `#tdsCols .tds-day-card` at index 0–9 do NOT have `tds-lowconf`;
   indices 10–15 DO. (Select all, check `nth(9)` lacks it and `nth(10)` has it.)
3. Assert grid: `#forecastGrid .day-card` index 9 lacks `day-lowconf`, index 10
   has it.
4. Assert the caption text "lower-confidence outlook" is present in the strip
   header area.

Manual: load a real spot, confirm days 11–16 look faded in both strip and grid,
the caption reads under the strip title, and a faded card still opens its modal.

## Risks / edge cases

- **Fewer than 11 days** (e.g. a spot/cache returning <11 days): the `i>=10`
  check simply never fires — no low-conf cards, no caption needed (caption can
  always render; it's harmless even if no day is faded, but to be tidy only
  render the caption when `daily.time.length > 10`).
- **Opacity vs. session glow:** a faded `has-session` card shows a muted green
  glow — intended (a low-confidence good day is still surfaced, just de-emphasised).
- **Today is always index 0**, so "Now" is never faded.

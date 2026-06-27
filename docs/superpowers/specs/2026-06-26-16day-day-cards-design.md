# 16-Day Overview — Day-Cards Rail (Option A)

**Date:** 2026-06-26
**Status:** Approved design, pending implementation plan

## Goal

Replace the abstract vertical bar-chart "16-day overview" strip with a horizontal
rail of compact **day-cards**, mirroring the Surfr inspiration the user liked: each
card shows weekday + date + a weather emoji, a `min / max` knots range, and a small
filled wind-profile sparkline along the bottom.

This is a pure front-end change in `index.html`. **No new forecast API calls** — all
data needed is already fetched (`daily.weather_code`, `daily.temperature_2m_*`,
hourly `windspeed_10m` via `cachedHrMap` / `buildDay()`).

## Scope

- **In scope:** the mobile-only 16-day strip (`#tenDayStripWrap`, currently
  `#tdsCols` rendered as bars in the `renderGrid` flow ~line 4056-4104).
- **Out of scope:** the full per-day forecast cards in `#forecastGrid`, the modal,
  the model/layer toggles, spot-info fields, and email ads (separate future specs).
- The strip remains **mobile-only** (existing `@media (min-width:600px){ display:none }`).

## Current behaviour (what we replace)

`renderGrid()` builds `#tdsCols` as one `.tds-col` per day, each containing a vertical
`.tds-bar` whose height = peak qualifying knots, with a lighter gust-extension bar, a
day number, and a weekday/"Now" label. Tap opens the day modal. A y-axis (`#tdsYAxis`)
and gridlines (`#tdsGrid`) at 15/25/35 kn frame the chart.

## New behaviour — day-cards rail

For each day `i` in `daily.time`, render a `.tds-day-card` containing:

1. **Header line:** weekday short (`Mo`, `Tu`, …) or `Now` for today + day number
   (e.g. `Sa 27`). Reuse the existing label logic from the current strip
   (`isNow ? 'Now' : weekday/short`).
2. **Weather emoji:** `wmoInfo(daily.weather_code[i])[0]` (e.g. ☀️ ⛅ 🌧). Rendered
   next to the date like Surfr's `Sa 27 ☀️`.
3. **min / max knots:** computed from `buildDay(dateStr, sunrise, sunset).day`
   (all daylight hours). `min = Math.round(min of h.kn)`, `max = Math.round(max of h.kn)`,
   converted to knots if `.kn` is not already knots (verify in `buildDay`: `d.kn` is
   already knots per `classifyHour`). Display as `14 / 16` with the `/` dimmed.
4. **Wind-profile sparkline:** a small filled SVG/divs area chart of the daylight
   hourly knots (`buildDay().day.map(h=>h.kn)`), normalized to the same `MAX_KN=45`
   scale, color-graded with the existing `windBarColor()` (use the day's max-kn color
   for the fill, matching how bars are colored today). Height ~26px, full card width.

### Card states & interaction (preserved from current strip)

- **Session glow:** if `goodHours >= 2`, add `has-session` styling (reuse the green
  glow already on `.day-card` / current `.tds-col` session treatment).
- **Today highlight:** `tds-now` styling on today's card.
- **Tap:** `onclick="openModal('${dateStr}', ${i})"` — identical to current behaviour.
- **Scroll/swipe:** horizontal scroll rail, keep the existing `swipe → for more` hint
  and `#tenDayStripWrap` header ("16-day overview").

### Removed elements

- `#tdsYAxis` (y-axis labels) and `#tdsGrid` (gridlines) are no longer needed — the
  cards are self-contained. Remove their population in `renderGrid()` and their
  containers in the HTML (lines ~1320-1322), plus the now-unused y-axis/gridline CSS.

## Data flow

```
renderGrid()
  └─ for each daily.time[i]:
       buildDay(dateStr, sunrise[i], sunset[i])  // already called today
         → { day:[{kn,…}], goodHours, … }
       minKn = Math.round(min(day.map(h=>h.kn)))
       maxKn = Math.round(max(day.map(h=>h.kn)))
       emoji = wmoInfo(daily.weather_code[i])[0]
       spark = day.map(h=>h.kn)  → filled area, color windBarColor(maxKn)
       hasSession = goodHours >= 2
  └─ join into #tdsCols (rename conceptually to a card rail; id can stay #tdsCols)
```

`buildDay` is already invoked once per day in the current loop, so no extra cost.
Guard against empty `day` (e.g. polar/no-data days): if `day.length === 0`, show
`— / —` and an empty sparkline, no session glow.

## CSS

- Add `.tds-day-card` (flex column, fixed min-width ~58px, rounded, border, padding),
  `.tds-day-card.has-session`, `.tds-day-card.tds-now`, header/range/sparkline child
  classes. Reuse `--card`, `--border`, session-green tokens already in the file.
- Remove obsolete `.tds-bar*`, `.tds-y-lbl`, `.tds-gridline`, `#tdsYAxis`, `#tdsGrid`
  CSS once the bars are gone.
- Sparkline: simplest robust approach is an inline SVG `<polyline>`/`<path>` filled
  area; falls back gracefully. (Implementation plan picks SVG vs. div-bars; SVG
  preferred for the smooth filled profile in the inspiration.)

## Testing

The repo has client regression tests under `tests/`. Add/extend a test that:
- renders the strip for a mocked `cachedWx` with known daily + hourly data,
- asserts the number of `.tds-day-card` equals `daily.time.length`,
- asserts a card shows the correct `min / max` and emoji for a known day,
- asserts `has-session` is applied only when `goodHours >= 2`,
- asserts tapping a card calls `openModal` with the right `(dateStr, i)`.

Manual check: load a real spot on a narrow viewport, confirm the rail scrolls,
today shows `Now`, emojis/ranges look right, tap opens the correct day modal,
and the rail is hidden ≥600px wide.

## Risks / edge cases

- **`.kn` units:** confirm `buildDay().day[].kn` is already in knots (it is, per
  `classifyHour(d.kn,…)` and `windBarColor(kn)` usage). No `toKnotsR` needed on it.
- **Missing hourly data** for far-out days → empty `day` array → `— / —` fallback.
- **Very light days** (max < 10kn) still render a (small/red) sparkline and range so
  the rail stays visually consistent; only the green session glow is conditional.
- Keep the rail performant: 16 cards × small SVG is trivial.

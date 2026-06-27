# 16-Day Day-Cards Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abstract bar-chart "16-day overview" strip in `index.html` with a horizontal rail of compact day-cards (weekday + date + weather emoji, `min / max` knots, and a filled wind-profile sparkline), matching the Surfr inspiration.

**Architecture:** Pure front-end change in the single-file app `index.html`. The day-card markup is built inside the existing `renderGrid()` flow (~lines 4056-4104) from data already fetched (`cachedWx.daily`, `cachedHrMap` via `buildDay()`). New CSS for `.tds-day-card`; obsolete bar/axis/gridline CSS and DOM removed. A Playwright e2e regression test drives `renderGrid()` directly with seeded globals.

**Tech Stack:** Vanilla JS + HTML + CSS (single `index.html`), inline SVG for the sparkline, Playwright for tests (`tests/` workspace, `gotoApp` fixture).

## Global Constraints

- All app code lives in `/Users/guiz/Documents/Claude/Claude Code/PFP/index.html`. Match existing code style (compact, no framework, `$('id')` helper).
- The strip stays **mobile-only**: existing rule `@media (min-width:600px){ #tenDayStripWrap{ display:none !important } }` (~line 1038) must remain effective.
- Reuse existing helpers — do **not** reimplement: `buildDay(dateStr,sunrise,sunset)`, `windBarColor(kn)`, `wmoInfo(code)` → `[emoji,label]`, `fmtDate(str)` → `{short,...}`, `$('id')`, `openModal(dateStr,i)`. `buildDay().day[].kn` is **already in knots** (no `toKnotsR`).
- Wind scale constant: `MAX_KN = 45` (matches the rest of the strip/grid).
- Tests run from `tests/`: `npx playwright test e2e/<file>`. Tests drive the app via `gotoApp('signedOut')` + `page.evaluate` calling app globals (per `modal-swipe.spec.ts`); the open-meteo API is **not** mocked.
- Commit after each task. Branch already in use: `feat/16day-day-cards`.

---

### Task 1: Add a sparkline helper and the day-card builder; render the rail

**Files:**
- Modify: `/Users/guiz/Documents/Claude/Claude Code/PFP/index.html`
  - Add helper `tdsSparkSVG(knArr, color)` near other small render helpers (after `windBarPct`, ~line 1827).
  - Replace the `$('tdsCols').innerHTML = daily.time.map(...)` block (~lines 4076-4100) with the day-card builder.
  - Remove `$('tdsYAxis').innerHTML=...` (~lines 4067-4070) and `$('tdsGrid').innerHTML=...` (~lines 4071-4074) population.
- Test: `/Users/guiz/Documents/Claude/Claude Code/PFP/tests/e2e/day-cards.spec.ts` (created in Task 3).

**Interfaces:**
- Consumes: `buildDay(dateStr, daily.sunrise[i], daily.sunset[i]) → { day:[{kn,...}], goodHours, peakKn, ... }`; `wmoInfo(code) → [emoji, label]`; `windBarColor(kn) → '#hex'`; `fmtDate(dateStr) → {short,...}`; `openModal(dateStr, i)`.
- Produces: DOM under `#tdsCols` = one `.tds-day-card` per `daily.time[i]`, each with `.tds-dc-head` (label+emoji), `.tds-dc-range` (`min / max`), `.tds-dc-spark` (inline SVG). `has-session` class when `goodHours >= 2`; `tds-now` class on today. `tdsSparkSVG(knArr, color) → '<svg>…</svg>'` string.

- [ ] **Step 1: Add the sparkline helper**

Insert after line 1827 (`function windBarPct(kn){ return Math.min(Math.round(kn/45*100),100); }`):

```javascript
// Filled area sparkline of an array of knots, normalized to MAX_KN=45.
// Returns an inline SVG string (~58×26 viewBox). Empty/blank if no data.
function tdsSparkSVG(knArr,color){
  const W=58,H=26,MAXK=45;
  const pts=(knArr||[]).filter(v=>v!=null&&!isNaN(v));
  if(pts.length===0) return `<svg class="tds-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`;
  // single point → flat line across the card
  const n=pts.length, stepX=n>1?W/(n-1):0;
  const y=kn=>H-Math.min(kn,MAXK)/MAXK*(H-2)-1; // 1px top/bottom inset
  const line=pts.map((kn,i)=>`${(i*stepX).toFixed(1)},${y(kn).toFixed(1)}`).join(' ');
  const area=`0,${H} `+line+` ${(n>1?W:0).toFixed(1)},${H}`;
  return `<svg class="tds-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`
    +`<polygon points="${area}" fill="${color}" fill-opacity="0.22"/>`
    +`<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`
    +`</svg>`;
}
```

- [ ] **Step 2: Remove the y-axis and gridline population**

Delete these two assignments inside `renderGrid()` (~lines 4067-4074):

```javascript
    $('tdsYAxis').innerHTML=
      `<div class="tds-y-lbl" style="top:0px">45</div>`+
      [35,25,15].map(kn=>`<div class="tds-y-lbl" style="top:${knTop(kn)}px">${kn}</div>`).join('')+
      `<div class="tds-y-lbl" style="top:${BAR_H}px">kn</div>`;
    $('tdsGrid').innerHTML=[15,25,35].map(kn=>{
      const btm=Math.round(kn/MAX_KN*BAR_H);
      return `<div class="tds-gridline" style="bottom:${btm}px"></div>`;
    }).join('');
```

Also delete the now-unused locals just above them if they are only used here: `BAR_H` (line ~4060) and `knTop` (line ~4066). **Verify with grep first** (`grep -n "BAR_H\|knTop" index.html`) — remove only if no other references remain. `MAX_KN`/`RANGE`/`MIN_KN` stay (still used elsewhere in the block / file).

- [ ] **Step 3: Replace the `#tdsCols` bar builder with the day-card builder**

Replace the whole `$('tdsCols').innerHTML=daily.time.map((dateStr,i)=>{ ... }).join('');` block (~lines 4076-4100) with:

```javascript
    $('tdsCols').innerHTML=daily.time.map((dateStr,i)=>{
      const {day,goodHours:gh}=buildDay(dateStr,daily.sunrise[i],daily.sunset[i]);
      const hasSession=gh>=2;
      const kns=day.map(h=>h.kn).filter(v=>v!=null&&!isNaN(v));
      const hasData=kns.length>0;
      const minKn=hasData?Math.round(Math.min(...kns)):null;
      const maxKn=hasData?Math.round(Math.max(...kns)):null;
      const [emoji]=wmoInfo(daily.weather_code[i]);
      const sparkColor=hasData?windBarColor(maxKn):'#475569';
      const spark=tdsSparkSVG(kns,sparkColor);

      const isNow=dateStr===localStr;
      const {short}=fmtDate(dateStr);
      const lbl=isNow?'Now':(short==='Today'||short==='Tomorrow')
        ?new Date(dateStr+'T12:00:00').toLocaleDateString('en',{weekday:'short'}):short;
      const dayNum=dateStr.slice(8).replace(/^0/,'');
      const rangeTxt=hasData?`${minKn} <span class="tds-dc-sep">/</span> ${maxKn}`:`— <span class="tds-dc-sep">/</span> —`;
      const titleTxt=hasData?`${minKn}-${maxKn}kn · ${gh}h qualifying`:'no data';

      return `<div class="tds-day-card${hasSession?' has-session':''}${isNow?' tds-now':''}" onclick="openModal('${dateStr}',${i})" title="${titleTxt}">
        <div class="tds-dc-head"><span class="tds-dc-day">${lbl} ${dayNum}</span><span class="tds-dc-wx">${emoji}</span></div>
        <div class="tds-dc-range">${rangeTxt}</div>
        <div class="tds-dc-spark">${spark}</div>
      </div>`;
    }).join('');
```

(Note: `localStr` is already defined earlier in this block, ~line 4063. The trailing `strip.style.display='flex'; if(stripWrap) stripWrap.style.display='block';` lines stay unchanged.)

- [ ] **Step 4: Manual smoke check (no test yet)**

Run the app and confirm no JS errors. From `tests/`:

```bash
npx playwright test e2e/smoke.spec.ts
```

Expected: PASS (the smoke test asserts the app boots with no console errors — our changed `renderGrid` must not throw at definition time).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(16day): render day-cards rail with min/max + wind sparkline"
```

---

### Task 2: Add day-card CSS and remove obsolete bar/axis CSS

**Files:**
- Modify: `/Users/guiz/Documents/Claude/Claude Code/PFP/index.html`
  - Add `.tds-day-card` and child CSS in the `#tenDayStrip` style block (near line ~196-226).
  - Remove obsolete `.tds-bar*`, `.tds-y-lbl`, `.tds-gridline`, `.tds-col*`, `.tds-kn-lbl`, `.tds-gust-kn-lbl`, `.tds-num`, `.tds-lbl`, `.tds-bar-wrap` rules **only if** no longer referenced.
  - Remove `#tdsYAxis` and `#tdsGrid` containers from the HTML (~lines 1320-1322).

**Interfaces:**
- Consumes: classes emitted in Task 1 (`.tds-day-card`, `.tds-dc-head`, `.tds-dc-day`, `.tds-dc-wx`, `.tds-dc-range`, `.tds-dc-sep`, `.tds-dc-spark`, `.tds-spark`, plus state classes `has-session`, `tds-now`).
- Produces: styled scrollable rail.

- [ ] **Step 1: Add the day-card CSS**

Inside the existing `<style>` near the `#tenDayStrip` rules (after `#tdsCols { ... }`, ~line 226), add:

```css
    #tdsCols { display:flex; align-items:stretch; gap:8px; padding:2px 4px 4px; }
    .tds-day-card {
      flex:0 0 auto; min-width:62px; display:flex; flex-direction:column; gap:5px;
      padding:8px 8px 6px; border-radius:12px; background:var(--card);
      border:1px solid var(--border); cursor:pointer; position:relative;
      transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    .tds-day-card:active { transform:translateY(-1px); }
    .tds-day-card.tds-now { border-color:var(--accent); }
    .tds-day-card.has-session {
      border-color:rgba(34,197,94,.55);
      box-shadow:0 0 0 1px rgba(34,197,94,.18), 0 4px 16px rgba(34,197,94,.10);
    }
    .tds-dc-head { display:flex; align-items:center; justify-content:space-between; gap:4px; }
    .tds-dc-day { font-size:.62rem; font-weight:600; color:var(--text); white-space:nowrap; letter-spacing:.01em; }
    .tds-dc-wx  { font-size:.78rem; line-height:1; }
    .tds-dc-range { font-size:.82rem; font-weight:700; color:var(--text); letter-spacing:.01em; }
    .tds-dc-sep { color:var(--tdim); font-weight:400; margin:0 1px; }
    .tds-dc-spark { margin-top:auto; line-height:0; }
    .tds-spark { display:block; width:100%; height:26px; }
```

These token names are confirmed present in `:root` (~lines 63-71): `--card:#161f30`, `--border:#253450`, `--accent:#00d4ff`, `--text:#e2e8f0`, `--tdim:#6e87a2`. Use them as written.

- [ ] **Step 2: Remove the y-axis / gridline DOM**

In the HTML (~lines 1319-1324), change:

```html
      <div id="tenDayStrip">
        <div id="tdsYAxis"></div>
        <div id="tdsChart">
          <div id="tdsGrid"></div>
          <div id="tdsCols"></div>
        </div>
      </div>
```

to:

```html
      <div id="tenDayStrip">
        <div id="tdsChart">
          <div id="tdsCols"></div>
        </div>
      </div>
```

- [ ] **Step 3: Remove obsolete bar/axis CSS**

Grep for each obsolete class and delete its rule **only if** the sole remaining reference is its own CSS definition:

```bash
grep -n "tds-bar\|tds-y-lbl\|tds-gridline\|tds-col\b\|tds-kn-lbl\|tds-gust-kn-lbl\|tds-num\|tds-lbl\|tds-bar-wrap" index.html
```

Remove the CSS rules for classes that now appear only in the stylesheet (no JS/HTML emits them after Task 1). Leave any class still referenced. Also remove `#tdsYAxis`, `#tdsChart` y-axis-specific positioning if it only existed to host the removed axis (keep `#tdsChart` itself — it still wraps `#tdsCols`).

- [ ] **Step 4: Verify the app still boots cleanly**

From `tests/`:

```bash
npx playwright test e2e/smoke.spec.ts
```

Expected: PASS (no console errors; layout renders).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "style(16day): day-card rail styling; drop bar-chart axis/gridlines"
```

---

### Task 3: Regression test for the day-cards rail

**Files:**
- Create: `/Users/guiz/Documents/Claude/Claude Code/PFP/tests/e2e/day-cards.spec.ts`

**Interfaces:**
- Consumes: `gotoApp('signedOut')` fixture; app globals `cachedWx`, `cachedLoc`, `cachedHrMap`, `renderGrid()`, `openModal`.
- Produces: a passing e2e spec asserting card count, range/emoji content, session glow, and tap-to-open behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/day-cards.spec.ts`. It seeds two days of forecast data directly into the app globals, calls `renderGrid()`, and asserts on `#tdsCols`. Day 0 is a windy session (min 14 / max 25, sunny, ≥2 qualifying daylight hours); day 1 is light (min 6 / max 9, rainy, no session).

```typescript
import { test, expect } from '../fixtures/auth';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('16-day rail renders one day-card per day with min/max, emoji and session glow', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  await page.evaluate(() => {
    // @ts-expect-error app globals
    const w: any = window;
    const D0 = '2026-06-26', D1 = '2026-06-27';

    // Build cachedHrMap: per-day Map(hour -> { kn, dir, code, gustKn })
    // toKnotsR is applied at fetch time, so we set .kn directly in knots.
    const mk = (entries: Array<[number, number, number, number]>) => {
      const m = new Map<number, any>();
      for (const [hr, kn, dir, code] of entries) m.set(hr, { kn, dir, code, gustKn: kn + 4 });
      return m;
    };
    // Day0: windy NW (315°) session 10:00-15:00 at 14-25kn, clear (code 0)
    const day0 = mk([
      [9, 14, 315, 0], [10, 18, 315, 0], [11, 22, 315, 0],
      [12, 25, 315, 0], [13, 23, 315, 0], [14, 16, 315, 0],
    ]);
    // Day1: light 6-9kn, rainy (code 61) — no qualifying session
    const day1 = mk([
      [10, 6, 315, 61], [11, 7, 315, 61], [12, 9, 315, 61], [13, 8, 315, 61],
    ]);
    w.cachedHrMap = new Map([[D0, day0], [D1, day1]]);

    w.cachedLoc = { name: 'Test Spot', latitude: 50, longitude: 4, country: 'BE' };
    w.cachedWx = {
      daily: {
        time: [D0, D1],
        weather_code: [0, 61],
        temperature_2m_max: [24, 18], temperature_2m_min: [16, 14],
        windgusts_10m_max: [14.4, 6.2], // m/s-ish; only used by removed bars / grid badge
        sunrise: [`${D0}T05:54`, `${D1}T05:54`],
        sunset:  [`${D0}T21:29`, `${D1}T21:29`],
      },
    };

    // windDirs is a Set in this app (see index.html ~line 1676). Include NW (315°)
    // so day0's NW hours qualify.
    w.windDirs = (w.windDirs instanceof Set) ? w.windDirs : new Set();
    w.windDirs.add(315);

    w.renderGrid();
  });

  const cards = page.locator('#tdsCols .tds-day-card');
  await expect(cards).toHaveCount(2);

  // Day 0: sunny session card shows max 25 and the clear emoji, with session glow
  const card0 = cards.nth(0);
  await expect(card0).toHaveClass(/has-session/);
  await expect(card0.locator('.tds-dc-range')).toContainText('25');
  await expect(card0.locator('.tds-dc-wx')).toContainText('☀️');

  // Day 1: light/rainy card — no session glow
  const card1 = cards.nth(1);
  await expect(card1).not.toHaveClass(/has-session/);
});

test('tapping a day-card opens the day modal for that date', async ({ gotoApp, page }) => {
  await gotoApp('signedOut');

  await page.evaluate(() => {
    // @ts-expect-error app globals
    const w: any = window;
    const D0 = '2026-06-26';
    const day0 = new Map<number, any>();
    [[10, 18], [11, 22], [12, 25], [13, 20]].forEach(([hr, kn]) =>
      day0.set(hr, { kn, dir: 315, code: 0, gustKn: kn + 4 }));
    w.cachedHrMap = new Map([[D0, day0]]);
    w.cachedLoc = { name: 'Test Spot', latitude: 50, longitude: 4, country: 'BE' };
    w.cachedWx = { daily: {
      time: [D0], weather_code: [0],
      temperature_2m_max: [24], temperature_2m_min: [16], windgusts_10m_max: [14.4],
      sunrise: [`${D0}T05:54`], sunset: [`${D0}T21:29`],
    } };
    w.windDirs = (w.windDirs instanceof Set) ? w.windDirs : new Set();
    w.windDirs.add(315);

    // spy on openModal
    w.__openedWith = null;
    const orig = w.openModal;
    w.openModal = (dateStr: string, i: number) => { w.__openedWith = [dateStr, i]; };
    w.__origOpenModal = orig;

    w.renderGrid();
  });

  await page.locator('#tdsCols .tds-day-card').first().click();

  const opened = await page.evaluate(() => (window as any).__openedWith);
  expect(opened).toEqual(['2026-06-26', 0]);
});
```

- [ ] **Step 2: Run the test to verify it passes**

From `tests/`:

```bash
npx playwright test e2e/day-cards.spec.ts
```

Expected: Both tests PASS. If `renderGrid()` throws because it reads a daily field the seed omits (e.g. it indexes another `daily.*` array), read the actual `renderGrid` body and add that field to the seed `daily` object — do not change app code to satisfy the test. If `has-session` fails on day0, verify the app's qualifying logic (`classifyHour` + good-dir set) against the seeded dirs/codes and adjust the **seed** (more consecutive qualifying daylight hours) until day0 legitimately qualifies.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/day-cards.spec.ts
git commit -m "test(16day): regression test for day-cards rail render + tap"
```

---

### Task 4: Full regression run + push + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Run the full e2e suite**

From `tests/`:

```bash
npx playwright test
```

Expected: all specs PASS (including the new `day-cards.spec.ts` and the unchanged `modal-swipe`, `smoke`, etc.). If `modal-swipe` or any forecast-dependent test broke, inspect whether the removed DOM (`#tdsYAxis`/`#tdsGrid`) or renamed classes were referenced there and fix the reference.

- [ ] **Step 2: Manual visual check (mobile viewport)**

Open `index.html`, search a real spot, narrow the window below 600px. Confirm: the rail scrolls horizontally; today's card shows `Now <day>`; each card shows emoji + `min / max` + a filled sparkline; windy days have the green glow; tapping opens the correct day modal; the rail disappears at ≥600px width.

- [ ] **Step 3: Push and open a PR (per user's Push + PR preference)**

```bash
git push -u origin feat/16day-day-cards
gh pr create --base main --title "feat(16day): day-cards rail for the 16-day overview" --body "$(cat <<'EOF'
Replaces the bar-chart 16-day overview strip with a horizontal rail of day-cards
(weekday + date + weather emoji, min/max daylight knots, filled wind-profile
sparkline), matching the Surfr inspiration. Mobile-only, no new forecast API calls.

Spec: docs/superpowers/specs/2026-06-26-16day-day-cards-design.md
Plan: docs/superpowers/plans/2026-06-26-16day-day-cards.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report the PR URL to the user.**

---

## Self-Review Notes

- **Spec coverage:** header line + emoji (Task 1 builder + Task 2 CSS), min/max from `buildDay().day` (Task 1), sparkline via `windBarColor` (Task 1 helper + CSS), session glow + today highlight + tap-to-modal (Task 1 classes + Task 2 CSS + Task 3 test), removal of y-axis/gridlines (Task 1 + Task 2), mobile-only preserved (Global Constraints), empty-day `— / —` fallback (Task 1 `hasData`), tests (Task 3), full run (Task 4). All spec sections mapped.
- **Placeholder scan:** none — all code blocks are concrete.
- **Type consistency:** `tdsSparkSVG(knArr,color)` defined in Task 1, consumed in Task 1 builder; classes emitted in Task 1 match CSS in Task 2 and assertions in Task 3 (`.tds-day-card`, `.tds-dc-range`, `.tds-dc-wx`, `has-session`). `buildDay().day[].kn` units confirmed already-knots.
- **Known unknown:** exact CSS variable token names (`--accent` etc.) and whether `renderGrid` reads additional `daily.*` arrays — both flagged inline with a grep-first instruction so the implementer verifies against the real file rather than assuming.

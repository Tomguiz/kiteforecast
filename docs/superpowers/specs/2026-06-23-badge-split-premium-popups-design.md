# Badge Split + Clickable Premium Feature Pop-ups — Design

**Date:** 2026-06-23
**Status:** Approved

Two independent changes to `index.html`, each with its own Playwright e2e tests.

---

## Part A — A notification badges only its own bubble

### Problem

`recomputeProfileBtnBadge()` (index.html:6422-6438) sums all four per-section counts
(`ppNotifCount`, `ppFriendReqCount`, `ppContribCount`, `ppAdminCount`) into one `total`
and writes that SAME number to both the profile dot (`.profile-btn-dot`) and the menu/burger
dot (`#burgerDot`). So every notification lights up both bubbles.

### Fix

Split the computation by which bubble owns the source:

- **Profile dot** (`.profile-btn-dot`) = `ppNotifCount` only (unread bell alerts).
- **Menu dot** (`#burgerDot`) = `ppFriendReqCount` + `ppContribCount` + `ppAdminCount`.

Each dot independently: hidden at zero, shows the number, shows `99+` past 99. A count is
only added when its hidden carrier span is visible (`style.display!=='none'`) — preserving the
existing guard so admin/contrib counts don't leak when those sections are hidden.

The per-item badges INSIDE the burger list (`burger_<key>_badge`, set by `_setTabBadge`) are
unchanged — they already badge per section correctly.

Keep the function name `recomputeProfileBtnBadge` (still called from `_setTabBadge` at
index.html:6419) to avoid touching call sites; only its body changes. Update the stale comment
above it to describe the two-bubble split.

### New body (index.html:6422-6438)

```js
// Each header bubble badges only its own sources. The profile bubble shows
// unread notifications; the menu (burger) bubble shows the actionable items
// reached through the menu (friends + contributions + admin). A count is only
// added when its carrier span is visible, so hidden sections don't leak.
function recomputeProfileBtnBadge(){
  const sum=ids=>{
    let t=0;
    for(const id of ids){
      const el=$(id);
      if(el && el.style.display!=='none') t+=parseInt(el.textContent,10)||0;
    }
    return t;
  };
  const fmt=n=>n>99?'99+':String(n);
  const profileTotal=sum(['ppNotifCount']);
  const menuTotal=sum(['ppFriendReqCount','ppContribCount','ppAdminCount']);
  document.querySelectorAll('.profile-btn-dot').forEach(d=>{
    d.textContent=fmt(profileTotal);
    d.classList.toggle('visible',profileTotal>0);
  });
  const bd=$('burgerDot');
  if(bd){ bd.textContent=fmt(menuTotal); bd.classList.toggle('visible',menuTotal>0); }
}
```

### Tests (tests/e2e/burger-nav.spec.ts)

- An unread alert badges the PROFILE dot (`#profileDot` → text `1`, class `visible`) but the
  burger dot (`#burgerDot`) stays hidden (not `visible`).
- A pending friend request badges the BURGER dot but NOT the profile dot. Drive this through the
  badge spans: set `ppFriendReqCount` visible with text `2` and call `recomputeProfileBtnBadge()`
  (the friend count comes from a Supabase query that the test harness mocks as empty, so set the
  carrier span directly — mirrors how the existing badge test manipulates `updateTabBadges`).

---

## Part B — Clickable premium features with a detail pop-up

### Data source (single source of truth)

A `PREMIUM_FEATURES` array drives BOTH the premium-active grid and the non-premium upgrade list,
so the two never drift. Each entry: `{ key, emoji, label, blurb }`.

```js
const PREMIUM_FEATURES = [
  { key:'favs',    emoji:'⭐', label:'Unlimited fav spots',
    blurb:'Save as many favourite spots as you like. The free plan caps you at 1 — Premium removes the limit entirely.' },
  { key:'digest',  emoji:'📬', label:'Weekly wind digest',
    blurb:'Every Monday, get an email forecast for the week ahead across all your favourite spots, so you can plan your sessions early.' },
  { key:'tides',   emoji:'🌊', label:'Tide times',
    blurb:'See the full tide schedule — highs, lows and timing — directly on every spot\'s forecast.' },
  { key:'session', emoji:'🏄', label:'Session tracking',
    blurb:'Log your sessions and let friends know when you\'re on the water, building your riding history over time.' },
  { key:'support', emoji:'🤝', label:'Support indie dev',
    blurb:'KiteForecast is built by one person. Your purchase keeps it running and free for everyone else.' },
  { key:'priority',emoji:'🎯', label:'Priority support',
    blurb:'Get direct access to the team — your questions and requests jump to the front of the queue.' },
];
```

### Rendering

Both lists are rendered from `PREMIUM_FEATURES` so each item is an individual clickable element
carrying its feature key. A `renderPremiumFeatureLists()` helper populates two containers:

- **Premium-active grid** (index.html:1510-1517): the existing 6 hardcoded tile `<div>`s are
  replaced by a container `<div id="ppPremiumGrid" ...>` that the helper fills with one button-like
  tile per feature (same tile styling: `background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);border-radius:8px;padding:8px 10px;color:var(--gray)`, plus `cursor:pointer` and a `role`/keyboard affordance). Tile text: `${emoji} ${label}`.
- **Non-premium upgrade list** (index.html:1488-1495): the inline `<br/>`-separated text block is
  replaced by a container `<div id="ppUpgradeFeatures">` that the helper fills with one clickable
  row per feature, text `${emoji} ${label}` — keeping the existing "— free plan = 1" style suffixes
  OUT (the detail now lives in the popup). The `⚡ Lifetime Access` header, price line, and
  `Get Lifetime Access` button are unchanged.

Each item gets `data-feature="<key>"` and an `onclick` (and `Enter`/`Space` keydown) that calls
`openFeatureModal('<key>')`. Tile/row text is built with `textContent` (the label/emoji are static
trusted strings, but we keep the codebase's textContent idiom).

`renderPremiumFeatureLists()` is called once on load (alongside the existing premium UI setup) and
is idempotent (clears each container before filling). It populates BOTH containers regardless of
premium state — visibility of the two parent cards is still governed by `updatePremiumUI()`.

### The pop-up (`#featureModal`)

A new lightweight modal matching the app's existing overlay pattern (overlay `display:flex/none`,
`✕` close top-right). Added near the other overlays in the HTML:

```html
<div id="featureModalOverlay" class="modal-overlay" style="display:none" onclick="handleFeatureOverlayClick(event)">
  <div class="feature-modal" id="featureModal" role="dialog" aria-modal="true" aria-labelledby="featureModalTitle">
    <button class="m-close" onclick="closeFeatureModal()" aria-label="Close" style="position:absolute;top:8px;right:8px">✕</button>
    <div id="featureModalEmoji" style="font-size:2rem"></div>
    <h3 id="featureModalTitle"></h3>
    <p id="featureModalBlurb"></p>
  </div>
</div>
```

Styling reuses `.modal-overlay`; `.feature-modal` is a small centered card (max-width ~340px,
padding, rounded, the app's panel background). Exact CSS values follow the existing modal/card vars.

**JS:**

```js
function openFeatureModal(key){
  const f=PREMIUM_FEATURES.find(x=>x.key===key); if(!f) return;
  $('featureModalEmoji').textContent=f.emoji;
  $('featureModalTitle').textContent=f.label;
  $('featureModalBlurb').textContent=f.blurb;   // textContent = XSS-safe
  $('featureModalOverlay').style.display='flex';
}
function closeFeatureModal(){ $('featureModalOverlay').style.display='none'; }
function handleFeatureOverlayClick(e){ if(e.target===$('featureModalOverlay')) closeFeatureModal(); }
```

### Dismiss methods (all three)

1. **Backdrop tap** — `handleFeatureOverlayClick` (click on overlay, not the card).
2. **✕ button** — top-right, `closeFeatureModal()`.
3. **Escape** — add a branch to the existing keydown handler (index.html:4368), e.g.
   `else if(e.key==='Escape'&&$('featureModalOverlay').style.display==='flex')closeFeatureModal();`
   Place it BEFORE the profile-overlay Escape branch so closing the feature popup doesn't also close
   the profile panel underneath.

### Returns to profile view

Closing only hides `#featureModalOverlay`; the profile overlay beneath stays open — the user is
back where they tapped.

### Tests (tests/e2e/premium.spec.ts)

- **Premium user:** open profile, click a tile in the premium grid → `#featureModalOverlay` visible,
  title + blurb match the chosen feature.
- **Non-premium user:** open profile, click a feature row in the upgrade list → same modal with the
  right content.
- **Dismiss:** for the popup, assert each of ✕ click, backdrop click, and Escape closes the modal
  (`#featureModalOverlay` hidden) AND the profile panel (`#profileOverlay`) is still visible after.

---

## Out of scope (YAGNI)

- No changes to the badge per-item burger list rendering.
- No analytics on feature-tile clicks.
- No changes to checkout / pricing.
- Pop-up does not deep-link to the feature or to checkout — it's informational only.

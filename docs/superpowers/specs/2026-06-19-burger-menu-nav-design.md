# KiteForecast — Navigation Redesign: Profile Bubble + Burger Menu (Design)

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Problem

The profile bubble opens one panel crammed with **7 horizontal tabs** (Profile,
Notifications, Stats, Friends, My Spot, Contributions, Admin). The tab strip
overflows the screen ("Adm…" cut off), and it mixes "my account" with "app
features" — so it's not intuitive where to find things.

## Goal

Two clear, separate entry points with one simple mental model — **bubble = me,
burger = the app**:

- **Profile bubble** (header, right) → opens **Profile only** (account/email,
  premium, sign out, re-auth banner).
- **Burger menu** (header, left) → a vertical list of feature sections.
  Tapping a section opens it **full-screen** with a back arrow.

## Section split (UX decision)

| Entry point   | Sections |
|---------------|----------|
| Profile bubble | **Profile** (account, email, premium status, sign out) |
| Burger menu    | **Notifications, Stats, Friends, My Spot\*, Contributions\*, Admin\*** |

\* My Spot / Contributions / Admin remain conditionally shown (same visibility
rules as today: My Spot when the user has a claim/approved request,
Contributions when they have a suggestion/spot request, Admin when `is_admin`).

Rationale: "Notifications" here is *manage my spot alerts* (a feature), not an
account inbox, so it belongs with the features. The notif/attention **badge**
still appears on the burger icon so the at-a-glance signal isn't lost.

## Architecture

Reuse ALL existing per-section render functions unchanged (`renderNotifList`,
`renderStats`, `renderFriendsPanel`, `renderMySpot`, `renderMyContributions`,
`renderAdminPanel`, `renderProfile`-equivalent). Only the **navigation shell**
changes: from one tabbed panel to (a) a Profile-only sheet + (b) a burger menu
that opens full-screen section views.

```
Header (.hero)
 ├─ burger button  (NEW, left)         → opens #burgerMenu
 ├─ home/logo button (unchanged)
 └─ profile bubble #profileBtn          → opens Profile-only sheet

#burgerMenu (NEW)  — slide-in list panel
 └─ list items: Notifications | Stats | Friends | My Spot | Contributions | Admin
     (icon + label + per-item badge; conditional items hidden as today)
     tap → openSection('<key>')

#sectionView (NEW) — full-screen container
 ├─ header: ← back (→ reopens #burgerMenu) + section title
 └─ body: the existing render target for that section

#profileOverlay (REUSED, simplified)
 └─ now shows ONLY the Profile panel body (tab strip removed)
```

### Components & responsibilities

- **Burger button** — toggles `#burgerMenu`. Shows an aggregate attention badge
  (sum of section badges, reusing the existing badge counts).
- **`#burgerMenu`** — a slide-in panel (left or top sheet) listing sections.
  Built once; item visibility toggled by the existing conditional logic
  (`checkShowMySpotTab`, `is_admin`, etc.). Each item shows its own badge.
- **`#sectionView`** — a single full-screen container reused for every section.
  `openSection(key)`:
  1. sets the title,
  2. shows `#sectionView`, hides the burger,
  3. calls the section's existing render fn into `#sectionViewBody`,
  4. runs the section's "mark seen" side-effect (e.g. Notifications clears its
     badge on open — preserved from today's `switchPpTab` logic).
  Back arrow → hide `#sectionView`, reopen `#burgerMenu`.
- **Profile sheet** — the existing `#ppPanelProfile` body, with the `.pp-tabs`
  strip removed. The bubble opens straight to it.

### Data flow / badges

Badges are unchanged in source: `updateTabBadges()` still computes
`ppNotifCount`, `ppFriendReqCount`, `ppContribCount`, `ppAdminCount`. The burger
**menu items reuse these same span ids** (moved into the list), and
`recomputeProfileBtnBadge()` is generalized to also sum onto the **burger icon**.
So the badge logic keeps working with minimal change — only the DOM location of
the badge spans moves.

### Signed-out behavior

- Burger is still visible; tapping a sign-in-gated section (Stats/Friends/…)
  shows that section's existing "Sign in to …" empty state inside `#sectionView`
  (no behavior change — those guards already exist).
- Notifications works as today (localStorage-backed) signed-out.
- Profile bubble still drives the sign-in flows (`_signinContext`,
  `openProfilePanel`) unchanged.

## Migration of existing nav

- `switchPpTab(tab)` logic that did per-tab show/hide + render + mark-seen is
  **refactored into `openSection(key)`** (for burger sections) and a trimmed
  Profile open (for the bubble). The render calls and mark-seen side-effects are
  copied verbatim so no working behavior is lost.
- The `.pp-tabs` strip and the 6 non-profile tab buttons are removed from
  `#profileOverlay`.
- The per-section panel bodies (`#ppPanelNotifs`, `#ppPanelStats`, …) move into
  `#sectionViewBody` targets (or are re-pointed there) so render fns still find
  their containers.

## Error handling / edge cases

- Opening a section while signed out → the section's own guard renders its
  sign-in prompt (already handled).
- Admin/My Spot/Contributions hidden when not applicable → not listed in the
  burger (same conditions as today).
- Back navigation: hardware/back-gesture closes `#sectionView` to the burger,
  then to the app (wire to the existing overlay-close pattern).
- The mobile swipe-to-dismiss already added for the day modal is independent;
  the new `#sectionView` gets the same ✕/back affordance.

## Testing

Extend the Playwright suite:
- Burger opens and lists the expected sections (signed-in vs signed-out).
- Tapping **Friends** opens `#sectionView` showing the friends list (reuses the
  existing friends fixtures).
- Tapping **Admin** (admin state) opens the admin section; the existing
  Review & add / Reject tests are re-pointed at the new container.
- **Notifications badge clears** on opening the Notifications section (the
  create→badge→open→clear test, re-pointed).
- Profile bubble opens the Profile sheet (and NO longer shows the old tab strip).
- Back arrow returns to the burger menu.

Existing 20 tests are updated to the new navigation where they touched
`openProfilePanel('<tab>')` / `switchPpTab`.

## Non-goals

- No change to the per-section *content* or its render logic.
- No change to auth, premium, RLS, or data flows.
- No desktop-specific redesign beyond making the burger + bubble work responsively
  (desktop can show the burger the same way; a future pass could add a desktop
  sidebar, out of scope here).

## Open visual choices (decide during implementation, low-risk)

- Burger position: top-left of header (conventional). Icon: ☰.
- Burger panel style: left slide-in vs top sheet — pick whichever fits the
  existing bottom-sheet aesthetic; default to a top-anchored sheet matching the
  current panel look.

# KiteForecast — Find Coordinates From Spot Name (Design)

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Problem

When requesting a new spot, the user must enter latitude/longitude. The form
tells them to open Google Maps and copy the coordinates. On **desktop** that's a
right-click. On **mobile Google Maps there is no easy way** to surface/copy the
coordinates — users get stuck and abandon the request.

## Goal

Let the user fill coordinates from the **spot name** — no Google Maps fiddling.
A dedicated **"📍 Find coordinates"** button next to the spot-name field geocodes
the name and fills lat/lon, showing what it matched so the user can confirm.

## Decisions (made during brainstorming)

- **Geocoder:** OpenStreetMap **Nominatim** (free, no API key, no signup).
- **Call site:** **Directly from the browser** (Nominatim allows CORS; spot
  requests are low-volume). No backend function.
- **UX:** A **separate** "📍 Find coordinates" button (the existing website
  "✨ Autofill" stays as-is, since it needs a URL while this needs the name).
- **Ambiguity:** Fill the **best (top) match** and show a **confirmation line**
  with the matched place name + coords, so the user can verify or edit manually.

## User flow

1. User types the spot name (e.g. "Prasonisi Rhodos") into `#suggestName`.
2. Taps **📍 Find coordinates**.
3. Button → `findCoordsFromName()`:
   - Reads `#suggestName` (and, if present, `#suggestLocation` / `#suggestCountry`
     to disambiguate — appended to the query for a better match).
   - Calls Nominatim search, takes the top result.
   - Fills `#suggestLat` / `#suggestLon` (and the combined `#suggestCoords` field).
   - Shows a confirmation line: **"✓ Found: <display_name> (lat, lon) — not the
     right place? edit the fields manually."**
4. On no result: **"⚠️ Couldn't find that spot — try a more specific name (add
   the city/country) or enter coordinates manually."**

## Component

`findCoordsFromName()` — one new async function. What it does / how it's used /
what it depends on:

- **Input:** reads `#suggestName` (required); optionally `#suggestLocation`,
  `#suggestCountry` to refine.
- **Request:** `GET https://nominatim.openstreetmap.org/search` with params:
  `q=<name[, location][, country]>`, `format=json`, `limit=1`,
  `addressdetails=0`. Sends no custom headers (browser sets Referer, which
  satisfies Nominatim's identification policy; a custom `User-Agent` can't be set
  from `fetch` and isn't required when Referer is present).
- **Output:** writes `#suggestLat`, `#suggestLon`, `#suggestCoords`; updates a
  status element (reuse the pattern of the existing `#autofillStatus`, or a new
  `#findCoordsStatus` next to the button).
- **Depends on:** the DOM input ids above; `$()` helper; `showToast` for errors;
  network access to nominatim.openstreetmap.org.

### Markup change
Next to the `#suggestName` input (currently a bare input at ~line 1190), wrap it
in a flex row and add:
```html
<button type="button" id="findCoordsBtn" onclick="findCoordsFromName()"
  style="…match the existing .autofillBtn style…">📍 Find coordinates</button>
<div id="findCoordsStatus" style="display:none;font-size:.72rem;margin-top:4px"></div>
```

### Secondary improvement (in scope, small)
The existing Coordinates help link/label says "(paste from Google Maps)" and
"long-press → tap coordinates → copy", which doesn't work on mobile. Update the
copy to point users at the new button first, and soften the manual instructions:
- Label hint: "(use 📍 Find coordinates above, or paste manually)".
- Keep the Google Maps link as a fallback but reword to not over-promise the
  long-press copy flow.

## Error handling

- **Empty name:** toast "Enter the spot name first", do nothing.
- **No network / Nominatim error / non-OK:** status "⚠️ Couldn't reach the
  geocoder — enter coordinates manually."; never block the form.
- **Zero results:** the "try a more specific name" message above.
- **Button state:** disabled + "⏳ Searching…" while in flight, restored after.
- **Don't overwrite** non-empty lat/lon without consent: if lat/lon already have
  values, still fill (user explicitly tapped the button to (re)find) — but the
  confirmation line lets them see the change. (Simpler than a confirm dialog.)

## Rate limiting / abuse

Nominatim policy: ≤1 request/second, identify via Referer (automatic). Mitigation:
the button is disabled during a request (prevents rapid repeats); usage is
inherently low (one per spot submission). No further limiting needed for this
volume. If abuse ever appears, the fallback is to move the call behind an
auth-gated edge function (explicitly out of scope now).

## Testing

Playwright E2E (mock the Nominatim response via `page.route`):
- Tapping **Find coordinates** with a name → fills `#suggestLat`/`#suggestLon`
  from the mocked result and shows the "✓ Found: …" confirmation.
- Empty name → no request, shows the "enter the spot name first" toast/state.
- Zero results (mock empty array) → shows the "couldn't find" message, fields
  stay empty.
- Network error (mock 500) → shows the "couldn't reach geocoder" message.

## Non-goals

- No multi-result picker (best-match + confirm only).
- No backend geocode function (direct browser call).
- No change to the website "✨ Autofill" flow.
- No reverse-geocoding or map picker.

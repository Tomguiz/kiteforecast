# Live wind: measured readings and per-spot live-wind links

**Date:** 2026-08-16
**Status:** design, awaiting review

Delivered in two phases:

- **Phase 1** — live measured wind from the Rijkswaterstaat mast network, in
  the spot detail view and the 1h reminder, plus an auto-derived "live wind"
  link in *Spot info & bookings*. Touches no database.
- **Phase 2** — a user-submitted `live_wind_url` per spot, so spots outside
  RWS coverage get a live-wind link too. Touches the suggestion pipeline.

Phase 1 stands alone and ships first. Phase 2 supersedes the auto link where a
user has submitted one.

## Problem

Every wind number in the app is a *forecast*. Open-Meteo tells you what the
model thinks the wind will do; nothing tells you what it is actually doing
right now.

That gap matters most at exactly one moment: the hour before you drive to the
beach. A 1h reminder that says "18 kn forecast" is weaker than one that says
"17 kn measured at the Brouwersdam mast four minutes ago".

Rijkswaterstaat runs the measurement masts along the Dutch and Belgian coast
and publishes them through an open API. This design wires that into two
surfaces: the spot detail view and the 1h session reminder.

Separately, *Spot info & bookings* already collects the places a rider goes for
a spot — lessons, gear, webcam, socials. The one obvious omission is "where do
I check the live wind here", which for most spots is a page some local already
knows. Phase 2 lets riders contribute that.

## The data source

`https://rwsos.rws.nl/wb-api/` — the JSON API behind the public RWSOS viewer.

Verified on 2026-08-16:

| Property | Finding |
|---|---|
| Authentication | None |
| CORS | `access-control-allow-origin: *` — callable from the browser |
| Resolution | 1-minute mean wind, ~2 min latency |
| Coverage | 37 live stations, NL + BE coast (incl. Belgian Meetnet Vlaamse Banken masts) |

Three endpoints give the current reading for **all** stations at once. Each
returns a GeoJSON feature per station with coordinates *and* the latest value
inline, so this is 3 requests total, not 3 per spot:

```
GET /wb-api/sp/dd/2.0/locations/geojson
      ?sourceName=datapush-1min&observationTypeId=WS1        → speed m/s  (37)
      ?sourceName=datapush-1min&observationTypeId=WR1        → direction  (37)
      ?sourceName=datapush-10min&observationTypeId=WS10MXS3  → 3s gust    (48)
    &boundingBox=[2,48.56,7.5,57]
```

The 3h sparkline needs one further call, for the matched station only:

```
GET /wb-api/sp/dd/2.0/timeseries
      ?observationTypeId=WS1&sourceName=datapush-1min
      &locationCode=<id>&startTime=<iso>&endTime=<iso>
```

## Coverage reality

The catalogue holds 390 spots worldwide. Matching each against the 37 stations:

| Distance to nearest mast | Spots |
|---|---|
| < 10 km | 19 |
| 10–30 km | 27 |
| > 30 km (no reading) | 344 |

**46 of 390 spots get a live reading.** This feature is regional by nature and
must degrade to invisible everywhere else — no empty panel, no "unavailable"
message, nothing. Cadzand Bad sits 1.0 km from its mast, Neeltje Jans 3.2 km,
Knokke Beach 4.1 km; the spots this serves are the ones actually ridden.

## Decisions taken

| Question | Decision |
|---|---|
| Where it appears | Spot detail view + the 1h reminder only |
| Detail panel content | Current reading + 3h sparkline |
| Other reminders (72/48/24/6h) | Unchanged — "live" wind is meaningless that far out |
| Max station distance | 30 km, with distance always shown |
| Max reading age | 30 minutes, age always shown |
| Storage (phase 1) | None — fetch direct on both surfaces |
| Units | Convert m/s → knots in the module, not the UI |
| Live-wind link | One button in *Spot info & bookings* |
| Link precedence | User-submitted URL wins; RWS station link is the fallback |

### Why 30 km with the distance visible

Some masts are offshore platforms and read systematically differently from a
beach. Measured 2026-08-16 12:10Z: Westhinder (30 km out) 7.4 kn while
Meteopark Zeebrugge read 9.9 kn. Showing the station name and distance lets the reader
discount a far reading; hiding those would make the number look authoritative
when it isn't.

### Why no caching layer

A Supabase-cached variant was considered: cron-poll every 5 min into a table,
read from both surfaces. Rejected for now — it costs a table, RLS, a cron and
another deployed function, and caps freshness at 5 min, discarding the
1-minute resolution that makes this worth building. The source is free, fast
and CORS-open; resilience we do not yet need is not worth that surface area.

If the feature proves itself, the cached variant is a clean follow-up that
reuses the same module unchanged. Accumulating history for per-spot wind
*statistics* is a genuinely separate project and explicitly out of scope here.

## Phase 1 architecture

### 1. `supabase/functions/_shared/rws.ts`

Pure logic, following the `_shared/rideability.ts` and `_shared/nearby.ts`
pattern. Reuses `haversineKm` from `_shared/nearby.ts`.

```ts
interface LiveWind {
  stationId:   string
  stationName: string
  distanceKm:  number
  speedKn:     number
  gustKn:      number | null
  dirDeg:      number
  ageMin:      number
}

// Injected fetch so unit tests never hit the network.
export async function fetchStations(f = fetch): Promise<Station[]>
export function nearestStation(
  stations: Station[], lat: number, lon: number, maxKm: number
): Station | null
export function toLiveWind(station: Station, now: Date): LiveWind | null
```

`toLiveWind` returns `null` when the reading is older than `MAX_AGE_MIN = 30`,
so staleness is enforced in one place rather than at each call site.

Gusts come from a different feed (10-min) than speed and direction (1-min) and
cover a different station set (48 vs 37). `gustKn` is therefore nullable and
the UI must not assume it exists.

### 2. Spot detail panel (`index.html`)

Per the existing convention, `index.html` carries its own copy of the matching
logic — as `speedTier` and `hourQualifies` already do. It needs a `haversineKm`
of its own; the frontend has none today.

Rendered only when `nearestStation` returns non-null and `toLiveWind` returns
non-null:

- Station name, distance ("Cadzand wind · 1.0 km")
- Wind and gust in knots, direction as compass + arrow
- Reading age ("4 min ago")
- 3h sparkline from the `timeseries` call

Fetched once per spot view, cached 60s in memory. Failure or absence hides the
panel entirely.

### 3. 1h reminder (`process-reminders/index.ts`)

`r.spot_lat` / `r.spot_lon` are already available at line 140. At the `rh === 1`
branch, look up the live reading and add a rendered HTML block to the webhook
payload.

The email templates live in `emails/` and are rendered by **Make.com** using
`[[dotted.path]]` placeholders. Following the `[[nearby_html]]` precedent from
commit e466328, the edge function builds the complete HTML block server-side
and passes it as a single placeholder:

```
payload.live_html = ''   // no station, stale reading, or fetch failure
payload.live_html = '<tr>…measured wind block…</tr>'
```

An empty string means the block vanishes with no conditional logic needed in
Make.com.

#### How Make.com renders this (confirmed 2026-08-16)

The scenario routes by reminder hour (`1st → 1`, `2nd → 6`, `3rd → 24`, …).
The 1h route's modules fetch the template **from this repo over HTTP**,
unauthenticated:

```
GET https://raw.githubusercontent.com/Tomguiz/kiteforecast/main/emails/reminderON1.html
GET https://raw.githubusercontent.com/Tomguiz/kiteforecast/main/emails/reminderOFF1.html
```

Each then runs a nested `replace()` chain over that HTML, one call per
placeholder.
`[[calendar_html]]` already works exactly this way, which is why `live_html` is
specced as a prebuilt HTML block rather than separate speed/direction/distance
fields: no conditional logic is possible in that chain, but an empty string
substitutes to nothing and the block simply vanishes.

Adding the placeholder means wrapping one more `replace()` around the existing
expression:

```
{{replace( <existing expression> ; "[[live_html]]"; 1.live_html)}}
```

#### ⚠️ Both 1h modules must be updated — ON *and* OFF

**There are two replace chains on the 1h route, not one.** `reminderON1.html`
and `reminderOFF1.html` carry different placeholder sets — `OFF1` has no
`[[calendar_html]]`, no `[[session.start_time_formatted]]`, no
`[[session.end_time_formatted]]` and no `[[session.duration_hours]]` — so they
are rendered by **separate** modules with separate, differently-sized `replace()`
expressions. Confirmed against the live scenario on 2026-08-16: module `34` is
the ON chain (24 deep, becoming 25) and module `46` is the OFF chain (23 deep,
becoming 24). The OFF chain has no `[[calendar_html]]` replace, which is what
makes the two expressions different lengths.

`process-reminders` has **no ON/OFF branch**: it emits `live_html` on every 1h
reminder and the template is chosen downstream by the session rating. So the
placeholder reaches both templates, and:

> If only the ON module is updated, **every SESSION OFF 1h email ships a
> literal `[[live_html]]` string in its body.**

The manual work is therefore: **wrap the extra `replace()` around the existing
expression on BOTH the ON and the OFF 1h modules.** The 6h and 24h routes are
untouched. Because both modules pull their template from the repo, editing
`emails/reminderON1.html` and `emails/reminderOFF1.html` is enough; no template
copy-paste into Make.

#### Deployment order (matters — getting it wrong emails users raw markup)

The template is fetched from `main` at send time, so **merging is what
activates it** — there is no separate deploy for the email. If the marker
reaches `main` before the formula knows about it, nothing replaces
`[[live_html]]` and users receive a literal `[[live_html]]` in their reminder.
(`raw.githubusercontent.com` caches for a few minutes, so the change lands
shortly after merge, not instantly.)

Ship in this order, each step inert on its own:

1. **Deploy `process-reminders`** — payload gains `live_html`; nothing consumes
   it yet.
2. **Update the Make.com formula on BOTH 1h modules — the ON chain (module
   `34`) and the OFF chain (module `46`).** The `replace()` finds no marker yet in either, so
   both edits are no-ops at this point.
3. **Merge the template change to `main`** — the marker now exists in both
   `reminderON1.html` and `reminderOFF1.html`, and is substituted correctly.

Two ways to get this wrong, both of which email users raw markup:

- **Reversing steps 2 and 3** — the marker reaches `main` before either formula
  knows about it.
- **Updating only the ON module in step 2** — every SESSION OFF 1h email then
  ships a literal `[[live_html]]`. This is the easy mistake, because the ON
  template is the one you are looking at while making the change.

Verify by triggering one reminder of each kind, or by searching a sent OFF
email for `[[live_html]]` before considering the rollout complete.

SMS is deliberately untouched — it is length-constrained and already carries
the peak forecast figure.

### 4. Live-wind link in *Spot info & bookings*

A single CTA button alongside the existing lesson / gear / webcam buttons,
built in the same `spot-cta-btn` style at `index.html:3735`:

```
🌬 Live wind readings
```

Its `href` resolves in this order, and the button is omitted entirely when
nothing resolves:

1. `info.live_wind_url` — user-submitted (phase 2)
2. RWS deep link for the matched station, when one is within 30 km:
   `https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/<stationId>`
   (verified 2026-08-16: renders the correct station, e.g. `BG2` →
   "Wind in Brouwershavensegat 02")
3. Nothing — no button

Because the station is matched by the same `nearestStation` call that feeds the
reading panel, the fallback costs no extra request.

The RWS viewer is **Dutch-only**. Acceptable for the Zeeland and Belgian spots
this covers, but it is a link off the app into another language, so the button
label must make clear it leaves the app rather than promising an in-app view.

Click tracking reuses `trackCtaClick(spotName, 'live_wind')`, extending the
`cta_type` values already listed in `schema.sql:228`.

### 5. Failure handling

Every failure mode resolves to "show nothing", never to a wrong number:

| Condition | Result |
|---|---|
| RWS unreachable / times out | Panel hidden; `live_html` empty |
| No station within 30 km | Panel hidden; `live_html` empty |
| Reading older than 30 min | Panel hidden; `live_html` empty |
| Gust feed missing for station | Reading shown, gust omitted |

The reminder must not be delayed or dropped by a slow RWS response: the call is
wrapped with a short timeout and its rejection swallowed, exactly as the
existing `marine-api` call is at `index.html:3149`.

## Phase 2 — user-submitted live-wind URL

Phase 1 covers 46 spots. Every other spot has a live-wind page somewhere that a
local already knows; this lets them contribute it.

### Data model

`spot_info` is the row the detail view reads (`index.html:3626`) and is where
the displayed value must live. `spot_overrides` holds geo and directions only
and is not involved.

```sql
ALTER TABLE spot_info               ADD COLUMN live_wind_url text;
ALTER TABLE spot_update_suggestions ADD COLUMN live_wind_url text;
ALTER TABLE spot_suggestions        ADD COLUMN live_wind_url text;
```

`spot_update_suggestions` already carries `website`, `livecam_url`, `lesson_url`
and `gear_url` columns that the form never populates, so this follows the shape
already there rather than inventing one.

`spot_claims` is deliberately untouched: a live-wind page is community
knowledge, not a business asset an owner claims.

**Schema is applied by hand in this project** — these statements must be run
against the live database via `supabase db query --linked` and verified, not
assumed from the file.

### Where it is submitted

| Surface | Change |
|---|---|
| Suggest-update form (`index.html:5546`) | New URL input; include in the `spot_update_suggestions` insert at `5600` |
| New-spot form | Same input, into `spot_suggestions` |
| Admin panel (`index.html:7355`) | New input beside lesson/gear/livecam, writing `spot_info` |
| `update-notify` | Include the submitted URL in the admin email body |

### Security — this is the app's first user-submitted URL

Every URL rendered today comes from an admin or from a business owner whose
claim an admin verified. This introduces a path where any signed-in user
proposes a URL that, once approved, is shown to every visitor.

Two controls, both required:

1. **Admin review already gates display.** A row in `spot_update_suggestions`
   is inert; nothing reaches `spot_info` without an admin applying it. This
   feature adds no new auto-publish path.
2. **Scheme validation on render.** `index.html:3720` documents a known open
   gap: hrefs are HTML-escaped, but `javascript:` still executes on click.
   PR #19 introduces `safeHttpUrl()` (http/https only, bare domains prefixed).

**Dependency: phase 2 must not merge before PR #19.** Adding a user-submitted
URL to a renderer that lacks scheme validation would widen the exact hole that
PR is closing. The new button must call `safeHttpUrl()`, not `escFriendName()`
alone.

Validation at submit time is a convenience, not a control — reject anything
`safeHttpUrl()` rejects, cap length, and treat the render-side call as the
real boundary.

### Interaction with phase 1

Precedence is `live_wind_url` → RWS station link → no button, implemented in
the single resolver in section 4. Phase 2 adds a source to that resolver and
changes nothing else about it.

## Testing

`tests/unit/rws.test.ts`, following `tests/unit/nearby.test.ts`:

- `nearestStation` picks the closest and respects the 30 km cap
- returns `null` when everything is beyond the cap
- `toLiveWind` rejects a reading older than 30 min, accepts one at 29 min
- m/s → knots conversion matches the app's `toKnots`
- missing gust yields `gustKn: null` rather than throwing
- malformed / empty `events` arrays yield `null`, not an exception

Fixtures are captured RWS responses, so tests run offline. A separate
throwaway script may verify live response shape, but no test hits the network.

For the link resolver (both phases), extending the existing spot-info render
tests that PR #19 adds:

- user URL present → button uses it, in preference to an available station
- no user URL, station within 30 km → button uses the RWS deep link
- neither → no button rendered at all
- a `javascript:` user URL is neutralised by `safeHttpUrl()` before render

## Risks

**The API is undocumented.** It is the RWSOS viewer's internal API, with no
published terms or rate limits. It can change without notice. Mitigations:
all access confined to one module; every failure degrades to hidden; requests
are cached 60s in the browser and made once per reminder fire, which is
negligible load.

**Deploy rot.** `process-reminders` must actually be redeployed after this
change — a known failure mode in this project. Verify the deployed version
before concluding the reminder change "didn't work".

**Offshore bias.** Addressed by the 30 km cap and always-visible station name
and distance, but a reading from a platform will still run different from the
beach. Accepted knowingly.

**Phase 2 blocks on PR #19.** The scheme-allowlist work must land before any
user-submitted URL is rendered. Phase 1 is unaffected — its only link is a
constant RWS URL built from a station id the app itself matched.

**The RWS viewer is Dutch-only.** A link out of the app into another language,
acceptable for the region this covers but worth revisiting if the feature ever
extends beyond it.

## Out of scope

- Validating that a submitted `live_wind_url` actually shows wind — an admin
  eyeballs it, as with every other URL field today
- Auto-suggesting live-wind URLs, or importing them from any third party
- Spot cards in the list view (considered, deferred)
- RWS forecast data (KNMI-downscaled, ~57h horizon) as an alternative to
  Open-Meteo — a separate "which forecast do I trust" design problem
- Historical accumulation and per-spot wind statistics
- Any use of Windguru: its documented station API is credential-gated per
  station, and its statistics and forecasts are the paid product

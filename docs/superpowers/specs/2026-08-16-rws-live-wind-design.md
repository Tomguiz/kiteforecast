# Live measured wind from Rijkswaterstaat masts

**Date:** 2026-08-16
**Status:** design, awaiting review

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
| Storage | None — fetch direct on both surfaces |
| Units | Convert m/s → knots in the module, not the UI |

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

## Architecture

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
The 1h route's module `34` fetches the template **from this repo over HTTP**,
unauthenticated:

```
GET https://raw.githubusercontent.com/Tomguiz/kiteforecast/main/emails/reminderON1.html
```

It then runs a 24-deep nested `replace()` chain over that HTML, one call per
placeholder.
`[[calendar_html]]` already works exactly this way, which is why `live_html` is
specced as a prebuilt HTML block rather than separate speed/direction/distance
fields: no conditional logic is possible in that chain, but an empty string
substitutes to nothing and the block simply vanishes.

Adding the placeholder means wrapping one more `replace()` around the existing
expression, making it 25 deep:

```
{{replace( <existing 24-deep expression> ; "[[live_html]]"; 1.live_html)}}
```

**This is the only manual step**, and only on the 1h route's module — the 6h
and 24h routes are untouched. Because module `34` pulls the template from the
repo, editing `emails/reminderON1.html` and `emails/reminderOFF1.html` is
enough; no template copy-paste into Make.

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
2. **Update the Make.com formula** — the `replace()` finds no marker yet, so it
   is a no-op.
3. **Merge the template change to `main`** — the marker now exists and is
   substituted correctly.

Reversing steps 2 and 3 is the failure case.

SMS is deliberately untouched — it is length-constrained and already carries
the peak forecast figure.

### 4. Failure handling

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

## Out of scope

- Spot cards in the list view (considered, deferred)
- RWS forecast data (KNMI-downscaled, ~57h horizon) as an alternative to
  Open-Meteo — a separate "which forecast do I trust" design problem
- Historical accumulation and per-spot wind statistics
- Any use of Windguru: its documented station API is credential-gated per
  station, and its statistics and forecasts are the paid product

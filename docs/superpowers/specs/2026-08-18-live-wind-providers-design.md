# Live wind from station providers

## Problem

`live_wind_url` (shipped in #32) gets a rider's live-wind page in front of other
riders, but it is only ever a **link**. The "Measured right now" panel — actual
knots, direction, gusts, the 3h trend — still appears only where an RWS mast is
within 30 km, which is the Dutch/Belgian coast and nowhere else.

The request was to fetch the wind values from whatever page a rider submits and
show them in that panel. **This spec deliberately does not do that**, for
reasons set out under "Why not scraping". It proposes provider adapters
instead: recognise the station platform behind the submitted URL, call that
platform's API, and render the reading through the panel that already exists.

## Decisions taken without asking

Stated so they are easy to overturn:

1. **Phase 1 is the spot page only**; reminders and "firing now" come in phase
   2. Same phasing the RWS spec used, same reason — the display path is
   self-contained and provable, the reminder path needs an edge-function
   redeploy and a second copy of the adapters.
2. **Three providers to start: Pioupiou/OpenWindMap, Holfuy and WeatherLink's
   embeddable-page feed.** All three are open JSON needing no key, and all
   three are common at European kite spots — WeatherLink is what Sycod runs.
   Everything else keeps the link button it has today.
3. **A URL that matches no provider is not an error.** It stays a link. No
   degraded mode, no "we tried and failed" state in the UI.

## Why not scraping

Fetching and parsing an arbitrary rider-submitted page fails on four counts,
each independently sufficient:

- **CORS.** `meteozeebrugge.be` sends no `Access-Control-Allow-Origin`, so the
  browser cannot read it. Every scrape needs a server-side proxy.
- **SSRF.** That proxy fetches URLs supplied by any signed-in user. Making it
  safe means an allowlist plus private-IP and redirect blocking — at which
  point it is an allowlist, i.e. this spec, with a scraper bolted on.
- **Nothing to parse.** The pages riders link are bespoke and client-rendered.
  A server fetch of `meteozeebrugge.be` returns 27 KB of markup with no wind
  values in it; the numbers arrive later via JS. Rendering it would need a
  headless browser, which edge functions do not have.
- **Wrong numbers are worse than none.** This panel answers "is it worth
  driving to the coast". A scraper that silently drifts stale, or misreads a
  gust column after a site redesign, is a worse product than an honest link.

## Providers

| Provider | API | Key | CORS | Route |
|---|---|---|---|---|
| Pioupiou / OpenWindMap | `api.pioupiou.fr/v1/live/<id>` | none | `*` | direct from the browser |
| Holfuy | `api.holfuy.com/live/?s=<id>&m=JSON&su=km/h` | none | absent | via `wind-proxy` |
| WeatherLink (Davis) | `weatherlink.com/embeddablePage/summaryData/<uuid>` | none | absent | via `wind-proxy` |
| RWS (existing) | `rwsos.rws.nl/wb-api` | none | `*` | direct, unchanged |

Verified live while writing this spec: both return JSON, and the CORS column is
the observed `Access-Control-Allow-Origin` header, not an assumption.

Windguru station pages are HTML with no open station API and are explicitly out
of scope — they remain links.

### Worked example: Sycod

`www.sycod.be/nl/meteo` is the case that prompted this spec, and it is why
WeatherLink is in the table above rather than in "out of scope". The page
embeds a WeatherLink widget, and that widget's `summaryData` endpoint returns
clean JSON with no key:

```
owner: Sycod   reading age: 0.8 min
Wind Speed              value=25    convertedValue=22   unitLabel=knots
Wind Direction          value=251   convertedValue=5648 unitLabel=
10 Min High Wind Speed  value=28    convertedValue=24   unitLabel=knots
```

Two traps that adapter must encode, both visible above:

- **`value` is the station's native unit, `convertedValue` is the display
  unit.** 25 mph is 22 knots; the wind-chill row is 62.1 °F against 17 °C. An
  adapter that grabs `value` because it looks like the real number publishes a
  reading ~14% too high — the failure mode that makes a scraper worse than a
  link.
- **`convertedValue` is meaningless for direction** (`5648` against a real
  bearing of 251°). Direction comes from `value`, speed from `convertedValue`.

Sycod's webcam on the same page is `g0.ipcamlive.com/player/…`, which the
allowlist in #35 already embeds.

**Attribution is a licence condition, not a nicety.** OpenWindMap data is
published under a licence requiring attribution to "contributors of the
OpenWindMap wind network". The panel must name the source for every non-RWS
reading, which it already has room for (it prints the station name and distance
today).

## Identifying the provider

A rider pastes a URL. The provider and station id are resolved from it **once,
when an admin applies the suggestion** — not on every render:

```
https://www.openwindmap.org/PP-1234        → pioupiou, 1234
https://api.pioupiou.fr/v1/live/1234       → pioupiou, 1234
https://holfuy.com/en/weather/101          → holfuy, 101
https://api.holfuy.com/live/?s=101         → holfuy, 101
https://www.weatherlink.com/embeddablePage/show/<uuid>/…  → weatherlink, <uuid>
anything else                              → null (stays a link)
```

Two new columns on `spot_info`, alongside the URL that stays exactly as it is:

```sql
ALTER TABLE spot_info ADD COLUMN live_wind_provider   text;   -- 'pioupiou' | 'holfuy'
ALTER TABLE spot_info ADD COLUMN live_wind_station_id text;
```

Resolving at apply time rather than render time means: the admin sees whether a
submitted link will produce readings before approving it, a provider whose URL
format changes cannot silently break rendering for spots already approved, and
the render path stays a column read rather than a string parse.

Schema is applied by hand in this project — these run via
`supabase db query --linked` and are verified against
`information_schema`, not assumed from this file.

## The adapter shape

Every adapter is a pure function from a provider payload to the `LiveWind`
shape that `_shared/rws.ts` already defines and the panel already renders:

```ts
interface LiveWind {
  stationId: string; stationName: string; distanceKm: number
  speedKn: number; gustKn: number | null; dirDeg: number | null
  ageMin: number; viewerUrl: string
}
```

RWS becomes one adapter among several rather than the special case it is now.
The panel, the trend sparkline and the CTA button are unchanged — they consume
`LiveWind` and do not learn where it came from.

Three rules every adapter inherits from the RWS one, because they are the
difference between a reading and a lie:

- **Unit conversion is the adapter's job.** Holfuy returns km/h, Pioupiou m/s,
  RWS m/s. The panel only ever sees knots.
- **Staleness is enforced, both ways.** A reading older than 30 minutes yields
  `null`, and so does one timestamped in the future — the existing
  `RWS_MAX_FUTURE_MIN` guard, which exists because a feed that drops its
  timezone designator otherwise reads as permanently "just now".
- **Every failure degrades to hidden.** No error state reaches the panel; a
  provider that is down looks exactly like a spot with no provider.

## Where the code lives

The app has no build step — `index.html` is served raw by Pages — so code
cannot be shared between the Deno edge functions and the browser. The RWS
logic is already duplicated between `_shared/rws.ts` and `index.html` for
exactly this reason.

This spec does not fix that, and does not pretend the duplication is free:

- Phase 1 adds the adapters to `index.html` only.
- Phase 2 mirrors them into `_shared/` for `process-reminders`.
- Adapters stay small and pure, and **both copies are tested against the same
  captured fixtures**, so a divergence fails a test rather than shipping.

## `wind-proxy`

Holfuy has no CORS header, so it needs a server hop. This is the same shape as
the existing `tide-proxy`: an edge function with CORS enabled for the browser
and a cache in front of a third-party API.

Two things it must not be:

- **Not a URL fetcher.** It takes `provider` and `station_id`, never a URL. The
  provider is one of a hard-coded set and the request URL is built server-side
  from a template. There is no input that makes it fetch an arbitrary host, so
  the SSRF surface that a scraper would open never exists.
- **Not uncached.** Readings update every 1-2 minutes; the client already
  caches RWS for 60s. The proxy caches per station for the same 60s, so a spot
  page opened by fifty riders is one upstream call.

## Precedence

One resolver, extended by one source rather than restructured:

```
provider reading (live_wind_provider set, adapter returned a LiveWind)
  → nearest RWS station within 30 km
  → live_wind_url as a plain link
  → no button at all
```

A provider that is configured but currently failing falls through to the RWS
station, and then to its own link — never to an empty panel.

## Testing

Unit tests with captured fixtures, following `tests/unit/rws.test.ts`:

- each adapter maps a real captured payload to the right knots, direction, gust
- km/h and m/s both convert to knots correctly
- a reading older than 30 min yields `null`; one at 29 min does not
- a future-timestamped reading yields `null`
- a malformed or empty payload yields `null` rather than throwing
- URL → provider/station resolution, including URLs that must NOT match
- the same fixtures run against the `_shared/` copies in phase 2

E2E, following `tests/e2e/live-wind-trend.spec.ts`:

- a spot with a working provider renders the panel with the source named
- a spot whose provider fails falls back to the RWS station
- a spot with neither renders the link button only
- attribution is present for a Pioupiou reading

No test hits the network.

## Risks

**Third-party APIs, undocumented terms.** Both are public and unauthenticated,
which is also to say neither owes us availability. Mitigated the same way RWS
is: caching, one module per provider, every failure hidden.

**A station moves or dies.** A provider id is attached to a spot by an admin
and nothing revisits it. A station that goes permanently offline degrades to
the RWS fallback and then to a link, silently. Detecting dead stations is out
of scope; the panel simply shows nothing.

**Adapter drift between the two copies.** Named above; shared fixtures are the
control. It is a real cost of having no build step, not a solved problem.

**Coverage is still partial.** Two providers do not cover every spot, and
riders will keep submitting URLs that stay links. That is the honest outcome —
the alternative is guessing at numbers.

## Out of scope

- Scraping arbitrary pages (see above)
- Providers requiring per-user API keys (WeatherLink API v2, Ecowitt,
  Weathercloud). Note the WeatherLink *embeddable page* endpoint used here is
  the public widget feed, not the keyed v2 API.
- Resolving a provider from a club's own page (e.g. `sycod.be/nl/meteo`)
  automatically. An admin pastes the widget URL the page embeds; teaching the
  app to discover it would be scraping by another name.
- Windguru station pages
- Riders submitting a provider id directly rather than a URL
- Any change to the reminder path in phase 1

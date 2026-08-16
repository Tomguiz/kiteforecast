# RWS Live Wind — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live measured wind from Rijkswaterstaat masts in the spot detail view and the 1h session reminder, plus a live-wind link in *Spot info & bookings*.

**Architecture:** One pure module `supabase/functions/_shared/rws.ts` fetches three GeoJSON feeds (speed, direction, gust) that each return every station with its latest value inline, merges them by station id, and matches the nearest station to a lat/lon within 30 km. `process-reminders` calls it server-side; `index.html` carries a hand-mirrored copy of the same logic, following the existing `rideability` precedent. No database changes.

**Tech Stack:** Deno (edge functions, TypeScript), vanilla JS in a single `index.html`, vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-08-16-rws-live-wind-design.md](../specs/2026-08-16-rws-live-wind-design.md)

## Global Constraints

- **Phase 1 only.** No database columns, no migrations. `live_wind_url` and the suggestion pipeline are Phase 2 and are gated on PR #19.
- **Max station distance:** 30 km. Beyond that, no reading and no link.
- **Max reading age:** 30 minutes. Older readings are treated as absent.
- **Units:** RWS returns m/s. Convert to knots inside the module. Server-side reuse `toKnots` from `_shared/rideability.ts` (`Math.round(ms * 1.94384)`); client-side reuse the existing `toKnotsR` (`index.html:1830`).
- **Bounding box:** `[2,48.56,7.5,57]` for every locations call.
- **Every failure degrades to hidden.** No error text, no empty panel, no "unavailable" message — on any failure the panel, link, and email block are simply absent.
- **No test may hit the network.** All unit tests use injected fake fetch functions.
- **Unit tests run from `tests/`:** `npm run unit`.
- **Task 6 must not merge to `main` until the Make.com formula is updated** — see the ordering warning in that task.

---

### Task 1: Pure RWS logic (parse, merge, match, convert)

**Files:**
- Create: `supabase/functions/_shared/rws.ts`
- Test: `tests/unit/rws.test.ts`

**Interfaces:**
- Consumes: `haversineKm` from `_shared/nearby.ts`, `toKnots` from `_shared/rideability.ts`
- Produces:
  - `interface RwsStation { id: string; name: string; lat: number; lon: number; speedMs: number|null; dirDeg: number|null; gustMs: number|null; ts: string|null }`
  - `interface LiveWind { stationId: string; stationName: string; distanceKm: number; speedKn: number; dirDeg: number|null; gustKn: number|null; ageMin: number; viewerUrl: string }`
  - `parseFeed(json: unknown): Map<string, {id,name,lat,lon,value,ts}>`
  - `mergeFeeds(speed, dir, gust): RwsStation[]`
  - `nearestStation(stations: RwsStation[], lat: number, lon: number, maxKm?: number): {station: RwsStation; distanceKm: number} | null`
  - `toLiveWind(station: RwsStation, distanceKm: number, now: Date): LiveWind | null`
  - `viewerUrl(stationId: string): string`
  - Constants `RWS_MAX_KM = 30`, `RWS_MAX_AGE_MIN = 30`, `RWS_BBOX = '[2,48.56,7.5,57]'`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rws.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseFeed, mergeFeeds, nearestStation, toLiveWind, viewerUrl,
  RWS_MAX_KM, RWS_MAX_AGE_MIN, type RwsStation,
} from '../../supabase/functions/_shared/rws.ts'

// Captured from the live API on 2026-08-16. locationName carries the raw
// tab-separated source row for some stations and a plain name for others —
// both shapes appear in production, so both are covered here.
const speedFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2 \t,3.621747\t,51.766527\t,Brouwershavense Gat 2',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 4.78 }] } },
    { geometry: { coordinates: [3.37906, 51.37989] },
      properties: { id: 'CAWI', locationName: 'CAWI \t,3.37906\t,51.37989\t,Cadzand wind',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.01 }] } },
    { geometry: { coordinates: [3.8593, 51.544] },
      properties: { id: 'KATS', locationName: 'Kats wind (Zandkreeksluis VM zijde)',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 4.2 }] } },
  ],
}
const dirFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 350.8 }] } },
    { geometry: { coordinates: [3.37906, 51.37989] },
      properties: { id: 'CAWI', locationName: 'CAWI', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 339.4 }] } },
  ],
}
// The gust feed covers a different station set (48 vs 37 live) — BG2 only.
const gustFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.77 }] } },
  ],
}

const NOW = new Date('2026-08-16T12:34:00Z')
const stations = () => mergeFeeds(parseFeed(speedFeed), parseFeed(dirFeed), parseFeed(gustFeed))

// Brouwersdam, the spot BG2 serves
const BROUWERSDAM = { lat: 51.7629, lon: 3.8512 }
// Cadzand Bad, ~1km from the CAWI mast
const CADZAND = { lat: 51.3722, lon: 3.3706 }

describe('parseFeed', () => {
  it('extracts the human-readable name from the tab-separated locationName', () => {
    const m = parseFeed(speedFeed)
    expect(m.get('BG2')!.name).toBe('Brouwershavense Gat 2')
  })

  it('keeps a plain locationName unchanged', () => {
    const m = parseFeed(speedFeed)
    expect(m.get('KATS')!.name).toBe('Kats wind (Zandkreeksluis VM zijde)')
  })

  it('reads coordinates as [lon, lat] GeoJSON order', () => {
    const s = parseFeed(speedFeed).get('CAWI')!
    expect(s.lat).toBeCloseTo(51.37989, 4)
    expect(s.lon).toBeCloseTo(3.37906, 4)
  })

  it('returns an empty map for a malformed payload', () => {
    expect(parseFeed({}).size).toBe(0)
    expect(parseFeed(null).size).toBe(0)
    expect(parseFeed({ features: [{ properties: {} }] }).size).toBe(0)
  })

  it('yields a null value when events is empty', () => {
    const f = { features: [{ geometry: { coordinates: [3, 51] },
      properties: { id: 'X', locationName: 'X', events: [] } }] }
    expect(parseFeed(f).get('X')!.value).toBeNull()
  })
})

describe('mergeFeeds', () => {
  it('joins speed, direction and gust by station id', () => {
    const bg2 = stations().find(s => s.id === 'BG2')!
    expect(bg2.speedMs).toBe(4.78)
    expect(bg2.dirDeg).toBe(350.8)
    expect(bg2.gustMs).toBe(5.77)
  })

  it('leaves gust null for a station missing from the gust feed', () => {
    const cawi = stations().find(s => s.id === 'CAWI')!
    expect(cawi.gustMs).toBeNull()
  })

  it('leaves direction null for a station missing from the direction feed', () => {
    const kats = stations().find(s => s.id === 'KATS')!
    expect(kats.dirDeg).toBeNull()
  })

  it('is driven by the speed feed — no speed means no station', () => {
    expect(stations().map(s => s.id).sort()).toEqual(['BG2', 'CAWI', 'KATS'])
  })
})

describe('nearestStation', () => {
  it('picks the closest station', () => {
    const hit = nearestStation(stations(), BROUWERSDAM.lat, BROUWERSDAM.lon)!
    expect(hit.station.id).toBe('BG2')
    expect(hit.distanceKm).toBeLessThan(2)
  })

  it('matches Cadzand Bad to its mast about 1km away', () => {
    const hit = nearestStation(stations(), CADZAND.lat, CADZAND.lon)!
    expect(hit.station.id).toBe('CAWI')
    expect(hit.distanceKm).toBeLessThan(2)
  })

  it('returns null when everything is beyond the cap', () => {
    // Kite Beach Maui — nothing within 30km, or 10000km
    expect(nearestStation(stations(), 20.9, -156.4)).toBeNull()
  })

  it('respects an explicit maxKm', () => {
    expect(nearestStation(stations(), BROUWERSDAM.lat, BROUWERSDAM.lon, 0.1)).toBeNull()
  })

  it('returns null for an empty station list', () => {
    expect(nearestStation([], BROUWERSDAM.lat, BROUWERSDAM.lon)).toBeNull()
  })
})

describe('toLiveWind', () => {
  const withTs = (ts: string | null, speedMs: number | null = 5.0): RwsStation =>
    ({ id: 'BG2', name: 'Brouwershavense Gat 2', lat: 51.766527, lon: 3.621747,
       speedMs, dirDeg: 350.8, gustMs: 5.77, ts })

  it('converts m/s to knots', () => {
    const lw = toLiveWind(withTs('2026-08-16T12:30:00Z', 5.0), 1.2, NOW)!
    expect(lw.speedKn).toBe(10)   // 5.0 * 1.94384 = 9.72 -> 10
    expect(lw.gustKn).toBe(11)    // 5.77 * 1.94384 = 11.2 -> 11
  })

  it('reports the reading age in minutes', () => {
    expect(toLiveWind(withTs('2026-08-16T12:30:00Z'), 1.2, NOW)!.ageMin).toBe(4)
  })

  it('accepts a reading 29 minutes old', () => {
    expect(toLiveWind(withTs('2026-08-16T12:05:00Z'), 1.2, NOW)).not.toBeNull()
  })

  it('rejects a reading older than the age cap', () => {
    expect(toLiveWind(withTs('2026-08-16T11:00:00Z'), 1.2, NOW)).toBeNull()
  })

  it('rejects a station with no speed reading', () => {
    expect(toLiveWind(withTs('2026-08-16T12:30:00Z', null), 1.2, NOW)).toBeNull()
  })

  it('rejects a station with no timestamp', () => {
    expect(toLiveWind(withTs(null), 1.2, NOW)).toBeNull()
  })

  it('rejects an unparseable timestamp rather than throwing', () => {
    expect(toLiveWind(withTs('not-a-date'), 1.2, NOW)).toBeNull()
  })

  it('keeps gust null rather than throwing when absent', () => {
    const st = { ...withTs('2026-08-16T12:30:00Z'), gustMs: null }
    expect(toLiveWind(st, 1.2, NOW)!.gustKn).toBeNull()
  })

  it('carries the station identity, distance and viewer url through', () => {
    const lw = toLiveWind(withTs('2026-08-16T12:30:00Z'), 1.23, NOW)!
    expect(lw.stationId).toBe('BG2')
    expect(lw.stationName).toBe('Brouwershavense Gat 2')
    expect(lw.distanceKm).toBeCloseTo(1.23, 2)
    expect(lw.viewerUrl).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/BG2')
  })
})

describe('viewerUrl', () => {
  it('builds the per-station RWSOS deep link', () => {
    expect(viewerUrl('CAWI')).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/CAWI')
  })

  it('encodes an id with unexpected characters', () => {
    expect(viewerUrl('A B')).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/A%20B')
  })
})

describe('constants', () => {
  it('matches the spec thresholds', () => {
    expect(RWS_MAX_KM).toBe(30)
    expect(RWS_MAX_AGE_MIN).toBe(30)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tests && npm run unit -- rws
```

Expected: FAIL — cannot resolve `../../supabase/functions/_shared/rws.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/_shared/rws.ts`:

```ts
// Live measured wind from the Rijkswaterstaat mast network (rwsos.rws.nl).
// Pure: no network in this file except fetchStations, which takes its fetch
// injected — so everything here is unit-testable without deploying.
//
// index.html carries a hand-mirrored copy of nearestStation/toLiveWind, the
// same way it mirrors rideability. Change both together.

import { haversineKm } from './nearby.ts'
import { toKnots } from './rideability.ts'

export const RWS_BASE = 'https://rwsos.rws.nl/wb-api'
export const RWS_VIEWER = 'https://rwsos.rws.nl/viewer/map/noordzee/meteo/location'
export const RWS_BBOX = '[2,48.56,7.5,57]'

// Beyond this a mast stops representing the spot — some are offshore platforms
// that read systematically differently from a beach.
export const RWS_MAX_KM = 30
// The 1-minute feed updates every 1-2 min; anything this old means the station
// or the feed has stopped, and a stale number is worse than none.
export const RWS_MAX_AGE_MIN = 30

export interface RwsStation {
  id: string
  name: string
  lat: number
  lon: number
  speedMs: number | null
  dirDeg: number | null
  gustMs: number | null
  ts: string | null
}

export interface LiveWind {
  stationId: string
  stationName: string
  distanceKm: number
  speedKn: number
  dirDeg: number | null
  gustKn: number | null
  ageMin: number
  viewerUrl: string
}

interface FeedEntry {
  id: string; name: string; lat: number; lon: number
  value: number | null; ts: string | null
}

// Some stations report locationName as the raw source row,
// "BG2 \t,3.621747\t,51.766527\t,Brouwershavense Gat 2"; others report a plain
// name. The human-readable part is always the last comma-separated field.
function cleanName(raw: string): string {
  return String(raw).split(',').pop()!.trim()
}

export function parseFeed(json: unknown): Map<string, FeedEntry> {
  const out = new Map<string, FeedEntry>()
  const feats = (json as { features?: unknown[] })?.features
  if (!Array.isArray(feats)) return out
  for (const f of feats) {
    const ft = f as { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }
    const p = ft?.properties
    const c = ft?.geometry?.coordinates
    if (!p || typeof p.id !== 'string' || !Array.isArray(c) || c.length < 2) continue
    const events = Array.isArray(p.events) ? p.events as { timeStamp?: string; value?: number }[] : []
    const last = events.length ? events[events.length - 1] : null
    out.set(p.id, {
      id:   p.id,
      name: cleanName(typeof p.locationName === 'string' ? p.locationName : p.id),
      lon:  Number(c[0]),
      lat:  Number(c[1]),
      value: last && typeof last.value === 'number' ? last.value : null,
      ts:    last && typeof last.timeStamp === 'string' ? last.timeStamp : null,
    })
  }
  return out
}

// The speed feed defines the station set: no speed means nothing worth showing.
// Direction and gust come from different feeds covering different stations, so
// both are optional.
export function mergeFeeds(
  speed: Map<string, FeedEntry>,
  dir: Map<string, FeedEntry>,
  gust: Map<string, FeedEntry>,
): RwsStation[] {
  const out: RwsStation[] = []
  for (const [id, s] of speed) {
    out.push({
      id, name: s.name, lat: s.lat, lon: s.lon,
      speedMs: s.value,
      dirDeg:  dir.get(id)?.value ?? null,
      gustMs:  gust.get(id)?.value ?? null,
      ts:      s.ts,
    })
  }
  return out
}

export function nearestStation(
  stations: RwsStation[], lat: number, lon: number, maxKm: number = RWS_MAX_KM,
): { station: RwsStation; distanceKm: number } | null {
  let best: { station: RwsStation; distanceKm: number } | null = null
  for (const st of stations) {
    const d = haversineKm(lat, lon, st.lat, st.lon)
    if (d > maxKm) continue
    if (!best || d < best.distanceKm) best = { station: st, distanceKm: d }
  }
  return best
}

export function viewerUrl(stationId: string): string {
  return `${RWS_VIEWER}/${encodeURIComponent(stationId)}`
}

export function toLiveWind(station: RwsStation, distanceKm: number, now: Date): LiveWind | null {
  if (station.speedMs === null || !station.ts) return null
  const t = Date.parse(station.ts)
  if (Number.isNaN(t)) return null
  const ageMin = Math.round((now.getTime() - t) / 60000)
  if (ageMin > RWS_MAX_AGE_MIN) return null
  return {
    stationId:   station.id,
    stationName: station.name,
    distanceKm,
    speedKn:     toKnots(station.speedMs),
    dirDeg:      station.dirDeg,
    gustKn:      station.gustMs === null ? null : toKnots(station.gustMs),
    ageMin,
    viewerUrl:   viewerUrl(station.id),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tests && npm run unit -- rws
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/rws.ts tests/unit/rws.test.ts
git commit -m "feat(rws): pure station parsing, merging and nearest-match logic"
```

---

### Task 2: `fetchStations` and `liveWindFor` (network layer, injected fetch)

**Files:**
- Modify: `supabase/functions/_shared/rws.ts` (append)
- Test: `tests/unit/rws.test.ts` (append)

**Interfaces:**
- Consumes: `parseFeed`, `mergeFeeds`, `nearestStation`, `toLiveWind` from Task 1
- Produces:
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>`
  - `fetchStations(f?: FetchLike): Promise<RwsStation[]>`
  - `liveWindFor(lat: number, lon: number, opts?: { fetchFn?: FetchLike; now?: Date; maxKm?: number }): Promise<LiveWind | null>`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/rws.test.ts`:

```ts
import { fetchStations, liveWindFor, type FetchLike } from '../../supabase/functions/_shared/rws.ts'

const feedFor = (url: string) =>
  url.includes('WS10MXS3') ? gustFeed : url.includes('WR1') ? dirFeed : speedFeed

const okFetch: FetchLike = async (url) => ({ ok: true, json: async () => feedFor(url) })

describe('fetchStations', () => {
  it('requests all three feeds and merges them', async () => {
    const seen: string[] = []
    const spy: FetchLike = async (url) => { seen.push(url); return { ok: true, json: async () => feedFor(url) } }
    const sts = await fetchStations(spy)
    expect(seen.length).toBe(3)
    expect(seen.some(u => u.includes('observationTypeId=WS1'))).toBe(true)
    expect(seen.some(u => u.includes('observationTypeId=WR1'))).toBe(true)
    expect(seen.some(u => u.includes('observationTypeId=WS10MXS3'))).toBe(true)
    expect(sts.map(s => s.id).sort()).toEqual(['BG2', 'CAWI', 'KATS'])
  })

  it('sends the bounding box on every request', async () => {
    const seen: string[] = []
    await fetchStations(async (url) => { seen.push(url); return { ok: true, json: async () => feedFor(url) } })
    expect(seen.every(u => u.includes('boundingBox='))).toBe(true)
  })

  it('returns an empty list when the speed feed fails', async () => {
    // 'observationTypeId=WS1&' matches WS1 only — WS10MXS3 has no '&' there.
    const failing: FetchLike = async (url) =>
      url.includes('observationTypeId=WS1&')
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => feedFor(url) }
    expect(await fetchStations(failing)).toEqual([])
  })

  it('still returns stations when only the optional gust feed fails', async () => {
    const partial: FetchLike = async (url) =>
      url.includes('WS10MXS3')
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => feedFor(url) }
    const sts = await fetchStations(partial)
    expect(sts.length).toBe(3)
    expect(sts.find(s => s.id === 'BG2')!.gustMs).toBeNull()
  })

  it('returns an empty list rather than throwing when fetch rejects', async () => {
    expect(await fetchStations(async () => { throw new Error('network down') })).toEqual([])
  })
})

describe('liveWindFor', () => {
  it('returns the reading for a covered spot', async () => {
    const lw = await liveWindFor(BROUWERSDAM.lat, BROUWERSDAM.lon, { fetchFn: okFetch, now: NOW })
    expect(lw!.stationId).toBe('BG2')
    expect(lw!.speedKn).toBe(9)   // 4.78 * 1.94384 = 9.29 -> 9
  })

  it('returns null for a spot with no station in range', async () => {
    expect(await liveWindFor(20.9, -156.4, { fetchFn: okFetch, now: NOW })).toBeNull()
  })

  it('returns null rather than throwing when the network fails', async () => {
    const boom: FetchLike = async () => { throw new Error('down') }
    expect(await liveWindFor(BROUWERSDAM.lat, BROUWERSDAM.lon, { fetchFn: boom, now: NOW })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tests && npm run unit -- rws
```

Expected: FAIL — `fetchStations` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `supabase/functions/_shared/rws.ts`:

```ts
export type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

// Each locations/geojson call returns EVERY station with its latest value
// inline, so three requests cover all spots — not three per spot.
const FEEDS = [
  { key: 'speed', path: '/sp/dd/2.0/locations/geojson', src: 'datapush-1min',  obs: 'WS1' },
  { key: 'dir',   path: '/sp/dd/2.0/locations/geojson', src: 'datapush-1min',  obs: 'WR1' },
  { key: 'gust',  path: '/sp/dd/2.0/locations/geojson', src: 'datapush-10min', obs: 'WS10MXS3' },
] as const

function feedUrl(f: typeof FEEDS[number]): string {
  const q = new URLSearchParams({
    sourceName: f.src, observationTypeId: f.obs, boundingBox: RWS_BBOX,
  })
  return `${RWS_BASE}${f.path}?${q}`
}

async function getFeed(f: typeof FEEDS[number], fetchFn: FetchLike): Promise<Map<string, FeedEntry>> {
  try {
    const res = await fetchFn(feedUrl(f))
    if (!res.ok) return new Map()
    return parseFeed(await res.json())
  } catch {
    return new Map()
  }
}

// Direction and gust are best-effort: a station with speed but no gust is still
// worth showing. Losing speed means there is nothing to show at all.
export async function fetchStations(f: FetchLike = fetch as unknown as FetchLike): Promise<RwsStation[]> {
  const [speed, dir, gust] = await Promise.all(FEEDS.map(feed => getFeed(feed, f)))
  if (!speed.size) return []
  return mergeFeeds(speed, dir, gust)
}

export async function liveWindFor(
  lat: number, lon: number,
  opts: { fetchFn?: FetchLike; now?: Date; maxKm?: number } = {},
): Promise<LiveWind | null> {
  const stations = await fetchStations(opts.fetchFn ?? (fetch as unknown as FetchLike))
  const hit = nearestStation(stations, lat, lon, opts.maxKm ?? RWS_MAX_KM)
  if (!hit) return null
  return toLiveWind(hit.station, hit.distanceKm, opts.now ?? new Date())
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tests && npm run unit -- rws
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/rws.ts tests/unit/rws.test.ts
git commit -m "feat(rws): fetch and merge the three station feeds with graceful failure"
```

---

### Task 3: Live wind line in the 1h reminder

**Files:**
- Modify: `supabase/functions/process-reminders/index.ts` (import block; payload build at `261`)

**Interfaces:**
- Consumes: `liveWindFor`, `type LiveWind` from Task 2
- Produces: `payload.live_html` — a string, always present, empty when there is nothing to show

**Note:** this task is safe to merge alone. Nothing renders `live_html` until Task 6, and an unused payload field changes no email.

- [ ] **Step 1: Add the import**

In `supabase/functions/process-reminders/index.ts`, alongside the existing `_shared` imports:

```ts
import { liveWindFor, type LiveWind } from '../_shared/rws.ts'
```

- [ ] **Step 2: Add the HTML block builder**

Add near the other module-level helpers (above `Deno.serve`). The markup mirrors the existing `calendar_html` block so it inherits the email's dark styling:

```ts
const COMPASS_8 = ['N','NE','E','SE','S','SW','W','NW']
const dirLabel = (deg: number | null) =>
  deg === null ? '' : COMPASS_8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]

// Rendered server-side and injected whole, because the Make.com template is a
// flat replace() chain with no conditional logic — an empty string here makes
// the block vanish. See docs/superpowers/specs/2026-08-16-rws-live-wind-design.md
function renderLiveHtml(live: LiveWind): string {
  const gust = live.gustKn === null ? '' : ` &middot; gusts ${live.gustKn} kn`
  const dir  = live.dirDeg === null ? '' : ` ${dirLabel(live.dirDeg)}`
  const age  = live.ageMin <= 1 ? 'just now' : `${live.ageMin} min ago`
  return `<tr>
          <td style="background-color:#0f1520;border:1px solid #1e2535;border-top:none;padding:16px 32px;">
            <p style="margin:0 0 10px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">&#127788; Measured right now</p>
            <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;font-size:22px;font-weight:700;color:#5dd4f0;">${live.speedKn} kn${dir}${gust}</p>
            <p style="margin:6px 0 0 0;font-size:11px;color:#4a5568;">${live.stationName} &middot; ${live.distanceKm.toFixed(1)} km away &middot; ${age}</p>
          </td>
        </tr>`
}
```

- [ ] **Step 3: Build `live_html` before the payload**

Immediately before `const payload = {` (currently line 261), insert:

```ts
      // 1h reminder only — a measured reading is meaningless 24h out. Never let
      // a slow or broken RWS response delay or drop the reminder itself.
      let live_html = ''
      if (rh === 1) {
        try {
          const live = await liveWindFor(Number(r.spot_lat), Number(r.spot_lon))
          if (live) live_html = renderLiveHtml(live)
        } catch (e) {
          console.error('rws live wind failed', e)
        }
      }
```

- [ ] **Step 4: Add the field to the payload**

In the `payload` object literal, directly after the `calendar_html,` line:

```ts
        live_html,
```

- [ ] **Step 5: Verify the function type-checks**

```bash
cd supabase/functions && deno check process-reminders/index.ts
```

Expected: no errors. If `deno` is unavailable locally, confirm the import path `../_shared/rws.ts` matches the sibling imports in the same file and move on.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/process-reminders/index.ts
git commit -m "feat(reminders): add measured live wind to the 1h reminder payload"
```

---

### Task 4: Live wind panel in the spot detail view

**Files:**
- Modify: `index.html` — add container after `1316`; add logic near `1830`; call from `4353`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime — this is the hand-mirrored client copy of Task 1's logic, per the `rideability` precedent
- Produces: `window._liveWind` cache; `renderLiveWindPanel(spot)`; `_rwsNearest(lat, lon)` reused by Task 5

- [ ] **Step 1: Add the panel container**

In `index.html`, immediately after `<div id="spotInfoCard"></div>` (line 1316):

```html
    <!-- Live measured wind from the nearest RWS mast. Stable standalone element
         (NOT inside spotInfoCard's async innerHTML) for the same reason as
         locWindDirs below: it must survive every spot-info re-render. -->
    <div id="liveWindPanel"></div>
```

- [ ] **Step 2: Add the client-side RWS logic**

Add after `const toKnotsR = ms => Math.round(ms * 1.944);` (line 1830):

```js
// ── RWS live wind ──────────────────────────────────────────────────────────
// Hand-mirrored from supabase/functions/_shared/rws.ts, the same way the
// rideability rule is mirrored. Change both together.
const RWS_BASE='https://rwsos.rws.nl/wb-api';
const RWS_BBOX='[2,48.56,7.5,57]';
const RWS_MAX_KM=30, RWS_MAX_AGE_MIN=30;
const RWS_FEEDS=[
  {path:'/sp/dd/2.0/locations/geojson',src:'datapush-1min', obs:'WS1'},
  {path:'/sp/dd/2.0/locations/geojson',src:'datapush-1min', obs:'WR1'},
  {path:'/sp/dd/2.0/locations/geojson',src:'datapush-10min',obs:'WS10MXS3'},
];
function _rwsHaversineKm(aLat,aLon,bLat,bLon){
  const R=6371,rad=d=>d*Math.PI/180;
  const dLat=rad(bLat-aLat),dLon=rad(bLon-aLon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function _rwsParseFeed(json){
  const out=new Map();
  const feats=json&&json.features;
  if(!Array.isArray(feats)) return out;
  for(const f of feats){
    const p=f&&f.properties, c=f&&f.geometry&&f.geometry.coordinates;
    if(!p||typeof p.id!=='string'||!Array.isArray(c)||c.length<2) continue;
    const ev=Array.isArray(p.events)?p.events:[];
    const last=ev.length?ev[ev.length-1]:null;
    out.set(p.id,{
      id:p.id,
      name:String(p.locationName||p.id).split(',').pop().trim(),
      lon:Number(c[0]), lat:Number(c[1]),
      value:last&&typeof last.value==='number'?last.value:null,
      ts:last&&typeof last.timeStamp==='string'?last.timeStamp:null,
    });
  }
  return out;
}
let _rwsStations=null, _rwsStationsTs=0;
async function _rwsFetchStations(){
  // 60s cache: the underlying feed only updates every 1-2 minutes.
  if(_rwsStations&&Date.now()-_rwsStationsTs<60000) return _rwsStations;
  try{
    const maps=await Promise.all(RWS_FEEDS.map(async f=>{
      const q=new URLSearchParams({sourceName:f.src,observationTypeId:f.obs,boundingBox:RWS_BBOX});
      const j=await safeFetch(`${RWS_BASE}${f.path}?${q}`,8000);
      return _rwsParseFeed(j);
    }));
    const [speed,dir,gust]=maps;
    if(!speed.size) return [];
    const out=[];
    for(const [id,s] of speed) out.push({
      id,name:s.name,lat:s.lat,lon:s.lon,speedMs:s.value,ts:s.ts,
      dirDeg:(dir.get(id)||{}).value??null, gustMs:(gust.get(id)||{}).value??null,
    });
    _rwsStations=out; _rwsStationsTs=Date.now();
    return out;
  }catch{ return []; }
}
async function _rwsNearest(lat,lon){
  const sts=await _rwsFetchStations();
  let best=null;
  for(const st of sts){
    const d=_rwsHaversineKm(lat,lon,st.lat,st.lon);
    if(d>RWS_MAX_KM) continue;
    if(!best||d<best.distanceKm) best={station:st,distanceKm:d};
  }
  if(!best) return null;
  const st=best.station;
  if(st.speedMs===null||!st.ts) return null;
  const t=Date.parse(st.ts);
  if(isNaN(t)) return null;
  const ageMin=Math.round((Date.now()-t)/60000);
  if(ageMin>RWS_MAX_AGE_MIN) return null;
  return {
    stationId:st.id, stationName:st.name, distanceKm:best.distanceKm,
    speedKn:toKnotsR(st.speedMs), dirDeg:st.dirDeg,
    gustKn:st.gustMs===null?null:toKnotsR(st.gustMs), ageMin,
    viewerUrl:`https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/${encodeURIComponent(st.id)}`,
  };
}
// 3h trend for the matched station, for the sparkline. Failure yields [].
async function _rwsTrend(stationId){
  try{
    const end=new Date(), start=new Date(Date.now()-3*3600*1000);
    const q=new URLSearchParams({
      observationTypeId:'WS1', sourceName:'datapush-1min', locationCode:stationId,
      startTime:start.toISOString().slice(0,19)+'Z', endTime:end.toISOString().slice(0,19)+'Z',
    });
    const j=await safeFetch(`${RWS_BASE}/sp/dd/2.0/timeseries?${q}`,8000);
    const ev=j&&j.results&&j.results[0]&&j.results[0].events;
    if(!Array.isArray(ev)) return [];
    return ev.filter(e=>e&&typeof e.value==='number').map(e=>toKnotsR(e.value));
  }catch{ return []; }
}
```

- [ ] **Step 3: Add the panel renderer**

Add immediately after the block from Step 2:

```js
async function renderLiveWindPanel(spot){
  const el=$('liveWindPanel'); if(!el) return;
  el.innerHTML='';
  if(!spot||typeof spot.lat!=='number'||typeof spot.lon!=='number') return;
  const live=await _rwsNearest(spot.lat,spot.lon);
  if(!live) return;                       // no station, stale, or fetch failed
  // Guard against a slow response landing after the user moved to another spot.
  if(!cachedLoc||cachedLoc.lat!==spot.lat||cachedLoc.lon!==spot.lon) return;
  const trend=await _rwsTrend(live.stationId);
  const spark=trend.length>1?tdsSparkSVG(trend,'#5dd4f0',null):'';
  const dir=live.dirDeg===null?'':` ${['N','NE','E','SE','S','SW','W','NW'][Math.round(((live.dirDeg%360)+360)%360/45)%8]}`;
  const gust=live.gustKn===null?'':` · gusts ${live.gustKn} kn`;
  const age=live.ageMin<=1?'just now':`${live.ageMin} min ago`;
  el.innerHTML=`<div class="spot-info-card" style="padding:14px 16px">
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;margin-bottom:6px">🌬 Measured right now</div>
    <div style="font-size:22px;font-weight:700;color:#5dd4f0">${live.speedKn} kn${escFriendName(dir)}${escFriendName(gust)}</div>
    ${spark?`<div style="margin:8px 0">${spark}</div>`:''}
    <div style="font-size:11px;color:#4a5568">${escFriendName(live.stationName)} · ${live.distanceKm.toFixed(1)} km away · ${escFriendName(age)}</div>
  </div>`;
}
```

- [ ] **Step 4: Call it when a spot is opened**

At line 4353, directly after `renderSpotInfoCard(loc.name);`:

```js
  renderLiveWindPanel(loc);
```

- [ ] **Step 5: Verify in the browser**

```bash
cd tests && npx serve -l 5055 ..
```

Open `http://localhost:5055/index.html`, search **Cadzand Bad**, and confirm: the panel appears above the wind-direction selector, shows a knots figure with a station name ending in "Cadzand wind", a distance near 1.0 km, and an age under 30 minutes. Then search **Kite Beach Maui** and confirm no panel renders and no console error appears.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(spot): live measured wind panel with 3h trend on the spot view"
```

---

### Task 5: Live wind link in *Spot info & bookings*

**Files:**
- Modify: `index.html` — `renderSpotInfoCard` at `3677`; CTA block near `3738`

**Interfaces:**
- Consumes: `_rwsNearest(lat, lon)` from Task 4 (returns `{viewerUrl, stationName, …}` or `null`)
- Produces: nothing consumed later in Phase 1. Phase 2 changes only the first branch of the href resolver added here.

- [ ] **Step 1: Add the resolver**

Add immediately above `async function renderSpotInfoCard(spotName) {` (line 3677):

```js
// Live-wind link precedence: a user-submitted URL wins (phase 2, not yet
// stored), then the RWS station page, then no button at all. The RWS lookup
// reuses the cache the panel already populated, so this costs no extra request.
async function _liveWindHref(info,spot){
  if(info&&info.live_wind_url) return {url:info.live_wind_url,label:'Live wind readings'};
  if(!spot||typeof spot.lat!=='number'||typeof spot.lon!=='number') return null;
  const live=await _rwsNearest(spot.lat,spot.lon);
  return live?{url:live.viewerUrl,label:`Live wind — ${live.stationName}`}:null;
}
```

- [ ] **Step 2: Build the button inside `renderSpotInfoCard`**

Directly after the `gearBtn` assignment (line 3738-3740), add:

```js
  const liveWind = await _liveWindHref(info, cachedLoc);
  const liveWindBtn = liveWind
    ? `<a href="${escFriendName(liveWind.url)}" target="_blank" rel="noopener" class="spot-cta-btn" onclick="trackCtaClick('${spotName}','live_wind')">🌬 ${escFriendName(liveWind.label)} ↗</a>`
    : '';
```

- [ ] **Step 3: Render it alongside the other CTAs**

Find the template literal that renders `${webcamBtn}`, `${lessonBtn}` and `${gearBtn}` into the card body, and add `${liveWindBtn}` immediately after `${gearBtn}`.

- [ ] **Step 4: Verify in the browser**

```bash
cd tests && npx serve -l 5055 ..
```

Open **Brouwersdam**: the *Spot info & bookings* section shows a `🌬 Live wind — Brouwershavense Gat 2 ↗` button that opens `rwsos.rws.nl/viewer/map/noordzee/meteo/location/BG2` in a new tab, showing that station. Open **Kite Beach Maui**: no live-wind button, no console error.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(spot-info): live-wind link auto-derived from the nearest RWS mast"
```

---

### Task 6: Email template placeholder — MERGE LAST

**Files:**
- Modify: `emails/reminderON1.html`, `emails/reminderOFF1.html`

> **⚠️ Ordering — this task must not reach `main` until the Make.com formula is updated.**
> Module `34` fetches these templates from
> `raw.githubusercontent.com/Tomguiz/kiteforecast/main/emails/reminderON1.html`
> **at send time**, so merging *is* the deploy. If `[[live_html]]` reaches `main`
> before the formula replaces it, users receive a literal `[[live_html]]` in
> their reminder.
>
> Correct order: **(1)** deploy `process-reminders` (Task 3), **(2)** update the
> Make.com formula, **(3)** merge this task.

- [ ] **Step 1: Add the placeholder to both 1h templates**

In `emails/reminderON1.html` and `emails/reminderOFF1.html`, add a line containing exactly `[[live_html]]` immediately after the `[[calendar_html]]` line. It sits between table rows and needs no wrapper — `renderLiveHtml` emits a complete `<tr>`.

- [ ] **Step 2: Verify the placeholder resolves to nothing when empty**

Confirm that with `live_html` empty the surrounding table still renders — i.e. `[[live_html]]` is on its own line between `</tr>` and `<tr`, not inside a tag or attribute.

- [ ] **Step 3: Deploy the edge function (must precede the merge)**

```bash
supabase functions deploy process-reminders
```

Then confirm the deployed version is newer than the Task 3 commit — a stale deploy is a known failure mode in this project.

- [ ] **Step 4: Update the Make.com formula (manual, outside the repo)**

In the 1h route's mapping, wrap the existing 24-deep expression in one more `replace()`:

```
{{replace( <existing expression> ; "[[live_html]]"; 1.live_html)}}
```

- [ ] **Step 5: Commit**

```bash
git add emails/reminderON1.html emails/reminderOFF1.html
git commit -m "feat(email): add [[live_html]] placeholder to the 1h reminder templates"
```

- [ ] **Step 6: Verify end to end**

After merging, wait for a real 1h reminder at a covered spot (or trigger one) and confirm the measured-wind block appears with a plausible reading, and that a reminder for an uncovered spot arrives with no gap or stray markup.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `_shared/rws.ts` module, injected fetch | 1, 2 |
| 30 km cap, 30 min staleness, m/s → knots | 1 |
| Spot detail panel + 3h sparkline | 4 |
| Live-wind link, precedence, `trackCtaClick` | 5 |
| 1h reminder `live_html` | 3 |
| Make.com formula + deploy ordering | 6 |
| Failure handling — every mode hides | 1 (`toLiveWind`), 2 (`fetchStations`), 4, 5 |
| Unit tests incl. malformed payloads | 1, 2 |

Phase 2 items (`live_wind_url` column, forms, admin panel, PR #19 dependency) are deliberately absent — they are gated on PR #19 and specced separately.

**Known gap:** the spec lists a render test asserting `javascript:` URLs are neutralised. That belongs to Phase 2, when a user-submitted URL first exists; Phase 1's only link is a constant built from a station id the app matched itself.

**Type consistency:** `LiveWind` field names (`stationId`, `stationName`, `distanceKm`, `speedKn`, `dirDeg`, `gustKn`, `ageMin`, `viewerUrl`) are identical across the TypeScript module (Tasks 1-2), the mirrored client object (Task 4), and the consumers in Tasks 3 and 5.

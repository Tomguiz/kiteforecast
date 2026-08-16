// Live measured wind from the Rijkswaterstaat mast network (rwsos.rws.nl).
// Pure: no network in this file except fetchStations, which takes its fetch
// injected — so everything here is unit-testable without deploying.
//
// index.html carries a hand-mirrored copy of nearestStation/toLiveWind, the
// same way it mirrors rideability (see `_rwsFetchStations` / `_rwsNearest`).
//
// MIRROR PARITY — a whole-branch review found three divergences that a
// per-task review had already looked for and missed, so the list is explicit.
// Change both copies together, and check each of these when you do:
//
//   1. Per-feed failure isolation. Each of the three feeds is wrapped in its
//      OWN try/catch (getFeed below) and degrades to an empty Map. A failing
//      gust feed must never cost speed + direction — the spec's failure table
//      requires "Reading shown, gust omitted".
//   2. BOTH bounds of the age gate. `ageMin < -2 || ageMin > RWS_MAX_AGE_MIN`.
//      The lower bound is not decorative: if the feed ever emits a timeStamp
//      with no timezone designator, the browser parses it as local time and a
//      CEST user sees every reading 2h in the future — which, with an upper
//      bound only, renders as the freshest reading possible ("just now").
//   3. The station-name fallback: last comma-separated field of locationName,
//      falling back to the station id.
//   4. The knots constant is a DELIBERATE exception. This module uses
//      `toKnots` (1.94384); index.html uses its pre-existing `toKnotsR`
//      (1.944). Readings on a .5 boundary can differ by 1 kn between the app
//      and the email. Kept as-is so each surface stays self-consistent.

import { haversineKm } from './nearby.ts'
import { toKnots, speedTier, isWindDirOK } from './rideability.ts'

export const RWS_BASE = 'https://rwsos.rws.nl/wb-api'
export const RWS_VIEWER = 'https://rwsos.rws.nl/viewer/map/noordzee/meteo/location'
export const RWS_BBOX = '[2,48.56,7.5,57]'

// Beyond this a mast stops representing the spot — some are offshore platforms
// that read systematically differently from a beach.
export const RWS_MAX_KM = 30
// The 1-minute feed updates every 1-2 min; anything this old means the station
// or the feed has stopped, and a stale number is worse than none.
export const RWS_MAX_AGE_MIN = 30
// Clock skew tolerance. A reading timestamped further ahead than this is not a
// fresh reading, it is a broken one — most likely a timeStamp that lost its
// timezone designator and got parsed as local time.
export const RWS_MAX_FUTURE_MIN = 2

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
    // Validate coordinates are actually numbers, then check they are finite.
    // Rejects null (Number(null)=0 is wrong), non-numeric strings, objects, etc.
    if (typeof c[0] !== 'number' || typeof c[1] !== 'number') continue
    const lon = Number(c[0])
    const lat = Number(c[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const events = Array.isArray(p.events) ? p.events as { timeStamp?: string; value?: number }[] : []
    const last = events.length ? events[events.length - 1] : null
    out.set(p.id, {
      id:   p.id,
      name: cleanName(typeof p.locationName === 'string' ? p.locationName : p.id),
      lon,
      lat,
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
    // Skip malformed stations with NaN coordinates to avoid poison-pill scenario.
    if (!Number.isFinite(st.lat) || !Number.isFinite(st.lon)) continue
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
  // Two-sided. A future timestamp is as broken as a stale one — and with an
  // upper bound only it would sail through and render as "just now", the
  // freshest possible reading. RWS_MAX_FUTURE_MIN of slack absorbs ordinary
  // clock skew between the mast and this host; anything beyond is a parse or
  // a feed fault, and a wrong number is worse than none.
  if (ageMin < -RWS_MAX_FUTURE_MIN || ageMin > RWS_MAX_AGE_MIN) return null
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

export type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

// Each locations/geojson call returns EVERY station with its latest value
// inline, so three requests cover all spots — not three per spot.
const FEEDS = [
  { path: '/sp/dd/2.0/locations/geojson', src: 'datapush-1min',  obs: 'WS1' },
  { path: '/sp/dd/2.0/locations/geojson', src: 'datapush-1min',  obs: 'WR1' },
  { path: '/sp/dd/2.0/locations/geojson', src: 'datapush-10min', obs: 'WS10MXS3' },
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

// Is this spot firing RIGHT NOW, by the app's own rideability rule?
//
// Deliberately reuses speedTier and isWindDirOK rather than inventing a
// threshold: speedTier(kn) > 0 IS 15 knots, and it is already what the
// "good days" badge counts. A fresh `kn >= 15` here would be a second
// definition of rideable, free to drift from the first.
//
// Direction is part of the rule because a spot blowing 25 kn from the wrong
// quarter is not firing, and a false "firing" badge is the one that costs
// someone a drive to the beach. `dirDeg` is nullable (the direction feed
// covers a different station set than speed), and an unknown direction
// cannot be confirmed as onshore — so it reads as not firing.
export function isFiringNow(
  speedKn: number, dirDeg: number | null, spotDirs: number[],
): boolean {
  if (dirDeg === null) return false
  return speedTier(speedKn) > 0 && isWindDirOK(dirDeg, spotDirs)
}

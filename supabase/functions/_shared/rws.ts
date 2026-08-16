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

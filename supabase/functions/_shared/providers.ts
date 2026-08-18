// Resolves a rider-submitted webcam/live-wind URL to a weather-station
// provider + station id. Pure: no network, no DOM — just URL parsing, so the
// later edge function and any UI can share this without re-deriving the rules.

export type ProviderId = 'pioupiou' | 'holfuy' | 'weatherlink'
export interface ProviderRef { provider: ProviderId; stationId: string }

// Host match is exact-or-subdomain, never a suffix test: `endsWith('holfuy.com')`
// would accept `notholfuy.com`, and a raw regex over the URL string would accept
// `weatherlink.com.attacker.example/embeddablePage/...`.
function hostIs(host: string, base: string): boolean {
  return host === base || host.endsWith('.' + base)
}

export function providerFromUrl(url: string): ProviderRef | null {
  let u: URL
  try { u = new URL(String(url || '').trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()

  if (hostIs(host, 'weatherlink.com')) {
    const m = u.pathname.match(/\/embeddablePage\/(?:show|summaryData)\/([0-9a-f]{16,64})/i)
    return m ? { provider: 'weatherlink', stationId: m[1] } : null
  }
  if (hostIs(host, 'holfuy.com')) {
    const s = u.searchParams.get('s')
    if (s && /^\d+$/.test(s)) return { provider: 'holfuy', stationId: s }
    const m = u.pathname.match(/\/weather\/(\d+)/)
    return m ? { provider: 'holfuy', stationId: m[1] } : null
  }
  if (hostIs(host, 'pioupiou.fr')) {
    const m = u.pathname.match(/\/live\/(\d+)/)
    return m ? { provider: 'pioupiou', stationId: m[1] } : null
  }
  if (hostIs(host, 'openwindmap.org')) {
    const m = u.pathname.match(/\/PP-?(\d+)/i)
    return m ? { provider: 'pioupiou', stationId: m[1] } : null
  }
  return null
}

import { RWS_MAX_AGE_MIN, RWS_MAX_FUTURE_MIN, type LiveWind } from './rws.ts'

const KN_PER_MS   = 1.943844
const KN_PER_KMH  = 0.539957
const round = (n: number) => Math.round(n)

// Shared gate: a reading is only usable if we know when it was taken, it is not
// older than the RWS window, and it is not in the future. The future check is not
// paranoia — a feed that drops its timezone designator reads as permanently "now".
function ageMinOrNull(ts: number | null, now: Date): number | null {
  if (ts === null || !Number.isFinite(ts)) return null
  const ageMin = Math.round((now.getTime() - ts) / 60000)
  if (ageMin > RWS_MAX_AGE_MIN) return null
  if (ageMin < -RWS_MAX_FUTURE_MIN) return null
  return Math.max(0, ageMin)
}

function wlRow(payload: any, name: string): any {
  const rows = payload?.currConditionValues
  return Array.isArray(rows) ? rows.find((r: any) => r?.displayName === name) : undefined
}

export function toLiveWindFrom(
  provider: ProviderId, stationId: string, payload: unknown, now: Date,
): LiveWind | null {
  const p = payload as any
  if (!p || typeof p !== 'object') return null
  try {
    if (provider === 'weatherlink') {
      const speed = wlRow(p, 'Wind Speed')
      if (!speed) return null
      // convertedValue is the display unit (knots); value is the station's
      // native imperial unit. Direction is the exception — its convertedValue
      // is not a bearing, so it comes from value.
      const speedKn = round(Number(speed.convertedValue))
      const gust = wlRow(p, '10 Min High Wind Speed')
      const dir = wlRow(p, 'Wind Direction')
      const ageMin = ageMinOrNull(Number(p.lastReceived), now)
      if (ageMin === null || !Number.isFinite(speedKn)) return null
      return {
        stationId, stationName: String(p.ownerName || 'Station'), distanceKm: 0,
        speedKn, gustKn: gust ? round(Number(gust.convertedValue)) : null,
        dirDeg: dir && Number.isFinite(Number(dir.value)) ? Number(dir.value) : null,
        ageMin, viewerUrl: `https://www.weatherlink.com/embeddablePage/show/${stationId}/signature`,
      }
    }
    if (provider === 'holfuy') {
      const w = p.wind
      if (!w || !Number.isFinite(Number(w.speed))) return null
      const f = w.unit === 'km/h' ? KN_PER_KMH : w.unit === 'm/s' ? KN_PER_MS : null
      if (f === null) return null
      const ageMin = ageMinOrNull(Date.parse(String(p.dateTime || '').replace(' ', 'T') + 'Z'), now)
      if (ageMin === null) return null
      return {
        stationId, stationName: String(p.stationName || 'Station'), distanceKm: 0,
        speedKn: round(Number(w.speed) * f),
        gustKn: Number.isFinite(Number(w.gust)) ? round(Number(w.gust) * f) : null,
        dirDeg: Number.isFinite(Number(w.direction)) ? Number(w.direction) : null,
        ageMin, viewerUrl: `https://holfuy.com/en/weather/${stationId}`,
      }
    }
    // pioupiou
    const d = p.data
    const m = d?.measurements
    if (!m || !Number.isFinite(Number(m.wind_speed_avg))) return null
    const ageMin = ageMinOrNull(Date.parse(String(m.date)), now)
    if (ageMin === null) return null
    return {
      stationId, stationName: String(d?.meta?.name || 'Station'), distanceKm: 0,
      speedKn: round(Number(m.wind_speed_avg) * KN_PER_MS),
      gustKn: Number.isFinite(Number(m.wind_speed_max)) ? round(Number(m.wind_speed_max) * KN_PER_MS) : null,
      dirDeg: Number.isFinite(Number(m.wind_heading)) ? Number(m.wind_heading) : null,
      ageMin, viewerUrl: `https://www.openwindmap.org/PP-${stationId}`,
    }
  } catch { return null }
}

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

// Pull every absolute http(s) URL out of the markup and keep the first that
// resolves to a provider. Deliberately NOT an HTML parse: we are looking for an
// identifier, not reading content, so a regex over hrefs and srcs is enough and
// cannot be confused by malformed markup.
export function discoverInHtml(html: string): ProviderRef | null {
  const text = String(html || '')
  const urls = text.match(/https?:\/\/[^\s"'<>\\]+/g) || []
  for (const raw of urls) {
    const ref = providerFromUrl(raw.replace(/&amp;/g, '&'))
    if (ref) return ref
  }
  return null
}

// Expands a bracket-free IPv6 literal to its 8 numeric 16-bit groups, or null if
// it isn't a syntactically valid literal. Used instead of prefix-matching the raw
// string so that expanded/non-compressed forms of a dangerous address (e.g. the
// loopback written out as `0:0:0:0:0:0:0:1` instead of `::1`) can't slip past a
// check that only recognises the compressed spelling.
function expandIPv6(h: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(h)) return null
  const halves = h.split('::')
  if (halves.length > 2) return null                // more than one '::' is not valid IPv6
  let groups: string[]
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves[1] ? halves[1].split(':') : []
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    groups = [...head, ...Array(fill).fill('0'), ...tail]
  } else {
    groups = h.split(':')
  }
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map(g => parseInt(g, 16))
}

// Anything that could reach infrastructure rather than the public internet.
// Allowlist semantics, deliberately: enumerating hostile encodings (octal/hex/
// decimal IPv4 shorthand, IPv4-mapped IPv6, expanded IPv6, trailing-dot names...)
// is a losing game, since Deno's resolver accepts forms this function would never
// think to check. Instead, block by default and return false ONLY for a host
// positively classified as one of: a real DNS name, a canonical dotted-quad
// IPv4 that clears the range checks, or a canonical IPv6 literal that clears
// them. The caller must re-run this after EVERY redirect, not just on the
// submitted URL — a safe host can redirect to an unsafe one.
export function isBlockedHost(hostname: string): boolean {
  let h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  h = h.replace(/\.$/, '')                           // a root dot ('localhost.') is the same host, not a different one
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true

  if (h.includes(':')) {
    // A dotted quad embedded in an IPv6 literal (::ffff:127.0.0.1) is always an
    // IPv4-mapped/compatible address reaching into the same private space — no
    // legitimate club page is addressed this way, so refuse the shape outright
    // rather than trying to parse and range-check the embedded IPv4.
    if (h.includes('.')) return true
    const g = expandIPv6(h)
    if (!g) return true                              // not parseable as IPv6 — default-deny, don't guess
    const allZero = g.every(x => x === 0)
    const loopback = g.slice(0, 7).every(x => x === 0) && g[7] === 1
    if (allZero || loopback) return true             // :: (unspecified) and ::1, in any expansion
    // IPv4-mapped (::ffff:a:b) / IPv4-compatible (::a:b) written as pure hex,
    // not a dotted quad — same address space as the dot-embedded form above.
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) return true
    if ((g[0] & 0xff00) === 0xfc00 || (g[0] & 0xff00) === 0xfd00) return true  // unique-local fc00::/7
    if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true                          // link-local fe80::/10
    return false
  }

  // Canonical dotted-quad only: four decimal octets, no leading zeros, each
  // 0-255. Legacy inet_aton forms (127.1, 0177.0.0.1, 2130706433, 0x7f.1,
  // octal-encoded octets) fail this and fall through to the hostname check
  // below, which also rejects them — so they're blocked by not being
  // recognised as anything safe, not by a rule written to catch each one.
  const octets = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  const octetOk = (o: string) => /^(0|[1-9]\d{0,2})$/.test(o) && Number(o) <= 255
  if (octets && octets.slice(1).every(octetOk)) {
    const [a, b] = [Number(octets[1]), Number(octets[2])]
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true          // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT, reachable infra on some hosts
    if (a >= 224) return true                         // multicast / reserved
    return false
  }

  // Otherwise allow only a genuine DNS hostname — dot-separated labels of
  // letters/digits/hyphens, ending in an alphabetic TLD. A name that later
  // RESOLVES to a private address is out of scope here; the caller re-checks
  // post-resolution. This is the fallback that keeps bare integers, hex/octal
  // octets, and other numeric disguises from being treated as safe.
  return !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(h)
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
        speedKn, gustKn: gust && Number.isFinite(Number(gust.convertedValue)) ? round(Number(gust.convertedValue)) : null,
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

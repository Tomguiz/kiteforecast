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

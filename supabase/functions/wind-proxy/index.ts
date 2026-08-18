import { providerFromUrl, toLiveWindFrom, type ProviderId } from '../_shared/providers.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

// The endpoint takes a provider slug and a station id — never a URL. The upstream
// address is built here from a fixed template, so there is no input that makes
// this fetch an arbitrary host.
const ENDPOINT: Record<ProviderId, (id: string) => string> = {
  pioupiou:    id => `https://api.pioupiou.fr/v1/live/${encodeURIComponent(id)}`,
  holfuy:      id => `https://api.holfuy.com/live/?s=${encodeURIComponent(id)}&m=JSON&su=km/h`,
  weatherlink: id => `https://www.weatherlink.com/embeddablePage/summaryData/${encodeURIComponent(id)}`,
}
const ID_OK: Record<ProviderId, RegExp> = {
  pioupiou: /^\d{1,10}$/, holfuy: /^\d{1,10}$/, weatherlink: /^[0-9a-f]{16,64}$/i,
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; body: unknown }>()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const { searchParams } = new URL(req.url)
  const provider = String(searchParams.get('provider') || '') as ProviderId
  const stationId = String(searchParams.get('station_id') || '')

  if (!ENDPOINT[provider] || !ID_OK[provider]?.test(stationId)) {
    return json({ error: 'unknown provider or station_id' }, 400)
  }

  const key = `${provider}:${stationId}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body)

  let live = null
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    const res = await fetch(ENDPOINT[provider](stationId), { signal: ac.signal })
    clearTimeout(t)
    if (res.ok) live = toLiveWindFrom(provider, stationId, await res.json(), new Date())
  } catch { live = null }        // every failure degrades to "no reading"

  const body = { live }
  cache.set(key, { at: Date.now(), body })
  return json(body)
})

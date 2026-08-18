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
//
// Object.create(null): a plain `{}` literal inherits from Object.prototype, so a
// caller-supplied provider of "constructor", "toString", "__proto__", etc. would
// look up a real (non-function/non-RegExp) value via the prototype chain instead
// of coming back undefined. `ID_OK[provider]?.test(...)` would then throw outside
// the try/catch below and the handler would 500 — an error surfaced to the
// caller, which the spec forbids. A null-prototype object has no chain to fall
// through, so those keys resolve to undefined exactly like any other unknown slug.
const ENDPOINT: Record<ProviderId, (id: string) => string> = Object.assign(Object.create(null), {
  pioupiou:    (id: string) => `https://api.pioupiou.fr/v1/live/${encodeURIComponent(id)}`,
  holfuy:      (id: string) => `https://api.holfuy.com/live/?s=${encodeURIComponent(id)}&m=JSON&su=km/h`,
  weatherlink: (id: string) => `https://www.weatherlink.com/embeddablePage/summaryData/${encodeURIComponent(id)}`,
})
const ID_OK: Record<ProviderId, RegExp> = Object.assign(Object.create(null), {
  pioupiou: /^\d{1,10}$/, holfuy: /^\d{1,10}$/, weatherlink: /^[0-9a-f]{16,64}$/i,
})

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

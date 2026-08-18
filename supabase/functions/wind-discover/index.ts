import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { providerFromUrl, discoverInHtml, isBlockedHost } from '../_shared/providers.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MAX_BYTES = 512 * 1024
const MAX_HOPS = 3

// Discovery is a once-per-suggestion action, so a handful per minute per user is
// generous. Without this, one signed-in account can use the function to probe the
// public internet at our expense and from our address.
const RATE_MAX = 5, RATE_WINDOW_MS = 60_000
const seen = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const hits = (seen.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS)
  hits.push(now)
  seen.set(userId, hits)
  return hits.length > RATE_MAX
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Signed-in callers only: this reaches out to a URL the caller chose.
  const authHeader = req.headers.get('Authorization') || ''
  const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)
  if (rateLimited(user.id)) return json({ error: 'slow down' }, 429)

  const { url } = await req.json().catch(() => ({ url: '' }))

  // Already a provider URL? Then no fetch happens at all.
  const direct = providerFromUrl(String(url || ''))
  if (direct) return json({ provider: direct.provider, station_id: direct.stationId })

  let target: URL
  try { target = new URL(String(url || '')) } catch { return json({ error: 'bad url' }, 400) }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return json({ error: 'bad scheme' }, 400)

  // Follow redirects by hand so every hop is re-checked, not just the first.
  let html = ''
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (isBlockedHost(target.hostname)) return json({ error: 'blocked host' }, 400)
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    let res: Response
    try {
      res = await fetch(target.href, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'kiteforecast-discover' } })
    } catch { clearTimeout(t); return json({ provider: null }) }
    clearTimeout(t)

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return json({ provider: null })
      try { target = new URL(loc, target) } catch { return json({ provider: null }) }
      continue
    }
    if (!res.ok) return json({ provider: null })
    const buf = new Uint8Array(await res.arrayBuffer())
    html = new TextDecoder().decode(buf.slice(0, MAX_BYTES))
    break
  }

  // Only the identifier leaves this function — never the page body.
  const found = discoverInHtml(html)
  return json(found ? { provider: found.provider, station_id: found.stationId } : { provider: null })
})

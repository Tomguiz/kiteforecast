// Fetches a kitespot website URL, extracts text, sends to Claude Haiku
// to extract structured spot data, returns JSON for form pre-fill.
//
// HARDENED:
//  - Requires an authenticated Supabase user (JWT in Authorization header).
//  - Blocks SSRF: only http(s), no private/loopback/link-local/metadata hosts,
//    redirects disabled.
//  - Basic per-user rate limit to protect the Anthropic API key from abuse.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON     = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

// Restrict to the real app origin(s). Add your custom domain here if you add one.
const ALLOWED_ORIGINS = new Set([
  'https://tomguiz.github.io',
])
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin':  origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tomguiz.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
})

const SYSTEM_PROMPT = `You are a data extraction assistant. The user will give you HTML or text from a kitesurf spot or kite school website.
Extract the following fields and return ONLY valid JSON — no explanation, no markdown, just the JSON object:
{
  "name":    "Spot or school name (string or null)",
  "city":    "City or region (string or null)",
  "country": "Country (string or null)",
  "lat":     "Latitude as number or null",
  "lon":     "Longitude as number or null",
  "dirs":    "Good wind directions as comma-separated string e.g. SW, W, NW (string or null)",
  "business":"Business or school name if different from spot name (string or null)",
  "webcam":  "Webcam URL if found (string or null)"
}
If you cannot find a field, use null. For coordinates, look in Google Maps embeds, schema.org, meta tags, or address text. Do not invent data.`

// ── SSRF guard ───────────────────────────────────────────────────────────────
// Reject anything that isn't a plain public http(s) host.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  // Cloud metadata endpoints
  if (h === 'metadata.google.internal' || h === '169.254.169.254' || h === 'metadata') return true

  // IPv6 literal
  if (h.includes(':')) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::') return true
    // IPv4-mapped IPv6 (::ffff:a.b.c.d)
    const m = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (m) return isPrivateV4(m[1])
    return true // be conservative with other IPv6 literals
  }

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateV4(h)
  return false
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true // malformed → block
  const [a, b] = p
  if (a === 10) return true                                   // 10.0.0.0/8
  if (a === 127) return true                                  // loopback
  if (a === 0) return true                                    // 0.0.0.0/8
  if (a === 169 && b === 254) return true                     // link-local
  if (a === 172 && b >= 16 && b <= 31) return true            // 172.16.0.0/12
  if (a === 192 && b === 168) return true                     // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true           // CGNAT 100.64.0.0/10
  if (a >= 224) return true                                   // multicast / reserved
  return false
}

function validateUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname || isBlockedHost(u.hostname)) return null
  return u
}

// ── Tiny in-memory rate limit (best-effort; resets on cold start) ────────────
const RATE: Map<string, number[]> = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
function rateLimited(key: string): boolean {
  const now = Date.now()
  const hits = (RATE.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  if (hits.length >= MAX_PER_WINDOW) { RATE.set(key, hits); return true }
  hits.push(now); RATE.set(key, hits); return false
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = corsFor(origin)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // ── Require an authenticated user ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  let userEmail = ''
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error } = await sb.auth.getUser(token)
    if (error || !user) throw new Error('unauthorized')
    userEmail = user.email ?? user.id
  } catch {
    return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  if (rateLimited(userEmail)) {
    return new Response(JSON.stringify({ error: 'Too many requests — try again in a minute' }), { status: 429, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  let url: URL | null
  try {
    const body = await req.json()
    url = validateUrl((body.url ?? '').trim())
    if (!url) throw new Error('bad url')
  } catch {
    return new Response(JSON.stringify({ error: 'Provide a valid public http(s) URL' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  // 1. Fetch the website HTML (no redirects → blocks redirect-to-internal SSRF)
  let html: string
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KiteForecastBot/1.0)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) throw new Error('redirects not allowed')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') ?? ''
    if (ctype && !/text|html|xml|json/i.test(ctype)) throw new Error('unsupported content type')
    html = await res.text()
  } catch (e) {
    return new Response(JSON.stringify({ error: `Could not fetch URL: ${e.message}` }), { status: 422, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  // 2. Strip HTML to reduce token count — keep text, meta, structured data
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000) // keep under ~3k tokens

  // 3. Call Claude Haiku
  let extracted: Record<string, string | number | null>
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `URL: ${url.toString()}\n\nPage content:\n${stripped}` }],
      }),
    })
    const aiJson = await aiRes.json()
    const text = aiJson.content?.[0]?.text ?? ''
    // Extract JSON from response (sometimes wrapped in ```json)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in response')
    extracted = JSON.parse(match[0])
  } catch (e) {
    return new Response(JSON.stringify({ error: `AI extraction failed: ${e.message}` }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  return new Response(JSON.stringify({ ok: true, data: extracted }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

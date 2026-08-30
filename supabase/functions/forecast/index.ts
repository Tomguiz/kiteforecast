import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

// A forecast fetched by one rider answers for every rider looking at the same
// spot. Two hours matches how often the rider's app re-checks on open, so a
// row never goes stale while still being served.
export const FORECAST_TTL_MS = 2 * 60 * 60 * 1000

// ── Which grid cell the wind is read from ───────────────────────────────────
// Open-Meteo defaults to cell_selection=land: given a coordinate it walks AWAY
// from the water to a land cell of similar elevation. For a weather app that is
// sensible. For a kitesurfing app it is backwards — every spot in this
// catalogue is, by definition, a place you put a kite on water, and the wind
// that matters is the wind over that water.
//
// Measured at Riverwoods (Knokke-Heist) against Windfinder for 31 Aug, 14
// daylight hours:
//
//                     wind bias   gust bias   gust factor
//   this app            -4.6 kn     +2.9 kn      1.93x
//   Windfinder             --          --        1.30x
//
// The app read low on 13 of 14 hours and gusty on 10 of 14. A gust factor of
// 1.93 is rough-surface turbulence — dunes, a sea wall, apartment blocks. Over
// open water it sits at 1.1-1.3, which is what Windfinder shows. Wind down and
// gusts up together is the signature of a land cell, not of a different model:
// surface roughness slows the mean flow and stirs the gusts.
//
// `sea` prefers a cell with little land in it; where none is near enough (an
// inland lake in a coarse model) Open-Meteo falls back to the nearest cell,
// which is what this app already got. So the worst case is today's behaviour.
const CELL_SELECTION = 'sea'

// Rows are keyed by coordinate, so a change to what we ASK Open-Meteo for has
// to change the key too — otherwise every spot keeps serving land-cell numbers
// out of the cache for two hours after deploy, and the stale fallback for a
// week. Bump this whenever the request shape changes; old rows age out on the
// sweep below.
const REQUEST_VERSION = 'v2sea'

// 3 decimals ≈ 110 m — the same key tide-proxy uses, and far finer than the
// weather model's own grid, so two riders on one spot always share a row.
const keyOf = (lat: number, lon: number) =>
  `${REQUEST_VERSION}:${lat.toFixed(3)},${lon.toFixed(3)}`

// The home screen asks for every card it is about to draw in ONE request. It
// used to make one per card, serialised behind a 400 ms throttle, so a rider
// with a favourite and six suggestions waited out seven round trips before the
// first badge settled. The cap is what the home screen can show at once; more
// than that is a bug in the caller, not a request worth serving.
export const MAX_BATCH_SPOTS = 16
// A miss still has to go upstream, and a cold batch would otherwise open one
// connection per spot at once. Open-Meteo answers a handful happily and starts
// returning 429 well before sixteen.
const UPSTREAM_CONCURRENCY = 4

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

function forecastUrl(lat: number, lon: number) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'temperature_2m,weather_code,windspeed_10m,winddirection_10m,windgusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,windgusts_10m_max,sunrise,sunset',
    forecast_days: '16', timezone: 'auto', windspeed_unit: 'ms',
    cell_selection: CELL_SELECTION,
  })
  return `https://api.open-meteo.com/v1/forecast?${p}`
}
function marineUrl(lat: number, lon: number) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'wave_height,wave_period,wave_direction',
    forecast_days: '16', timezone: 'auto',
    cell_selection: CELL_SELECTION,
  })
  return `https://marine-api.open-meteo.com/v1/marine?${p}`
}

// ── Slim projection ─────────────────────────────────────────────────────────
// The home-screen badge counts rideable days. It reads wind, gusts, the weather
// code and the daylight window — and nothing else. Temperature, the daily
// min/max/gust series and the whole marine block are ~60% of the payload and
// are never looked at, so a caller that only draws badges can ask not to be
// sent them. Rows are always STORED in full: the spot page reads the same row.
const SLIM_HOURLY = ['time', 'weather_code', 'windspeed_10m', 'winddirection_10m', 'windgusts_10m']
const SLIM_DAILY  = ['time', 'sunrise', 'sunset']
function pick(src: any, keys: string[]) {
  if (!src) return src
  const out: Record<string, unknown> = {}
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k]
  return out
}
function slimWx(wx: any) {
  if (!wx || wx.error) return wx
  return { ...wx, hourly: pick(wx.hourly, SLIM_HOURLY), daily: pick(wx.daily, SLIM_DAILY) }
}

type Row = { wx: any; marine: any; fetched_at: string }

async function fetchUpstream(lat: number, lon: number): Promise<Row> {
  const [wxRes, mRes] = await Promise.all([
    fetch(forecastUrl(lat, lon)),
    fetch(marineUrl(lat, lon)).catch(() => null),
  ])
  const wx = await wxRes.json()
  if (wx?.error) throw new Error(wx.reason || 'forecast API error')
  // Marine has no data inland, and that is not a failure worth reporting.
  let marine: any = null
  if (mRes && mRes.ok) {
    const m = await mRes.json()
    if (!m?.error) marine = m
  }
  return { wx, marine, fetched_at: new Date().toISOString() }
}

// Rows are also created for one-off geocoded searches, which nobody looks at
// twice. Sweep occasionally rather than on a cron: it costs one statement on
// a small fraction of the misses, and there is no schedule to keep alive.
async function maybeSweep() {
  if (Math.random() >= 0.02) return
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('forecast_cache').delete().lt('fetched_at', cutoff)
  if (error) console.error('forecast_cache sweep failed', error.message)
}

async function storeRows(rows: { spot_key: string; lat: number; lon: number; wx: any; marine: any; fetched_at: string }[]) {
  if (!rows.length) return
  // A failed write must not fail the request: the rider already has the data.
  const { error } = await supabase.from('forecast_cache').upsert(rows, { onConflict: 'spot_key' })
  if (error) console.error('forecast_cache upsert failed', rows.map(r => r.spot_key).join(' '), error.message)
}

// Run `fn` over `items` with at most `limit` in flight. Results keep input order.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const validCoord = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180

// ── One spot ────────────────────────────────────────────────────────────────
async function serveSingle(lat: number, lon: number, force: boolean, slim: boolean) {
  const spotKey = keyOf(lat, lon)

  if (!force) {
    const { data } = await supabase
      .from('forecast_cache')
      .select('wx,marine,fetched_at')
      .eq('spot_key', spotKey)
      .maybeSingle()

    if (data && Date.now() - new Date(data.fetched_at).getTime() < FORECAST_TTL_MS) {
      return json({ wx: slim ? slimWx(data.wx) : data.wx, marine: slim ? null : data.marine,
                    fetched_at: data.fetched_at, source: 'cache' })
    }
  }

  let row: Row
  try {
    row = await fetchUpstream(lat, lon)
  } catch (err) {
    // Rather than fail the rider, hand back whatever is stored even if it is
    // past the window — an old forecast beats no forecast.
    const { data: stale } = await supabase
      .from('forecast_cache')
      .select('wx,marine,fetched_at')
      .eq('spot_key', spotKey)
      .maybeSingle()
    if (stale) return json({ wx: slim ? slimWx(stale.wx) : stale.wx, marine: slim ? null : stale.marine,
                             fetched_at: stale.fetched_at, source: 'stale' })
    return json({ error: String(err) }, 502)
  }

  await maybeSweep()
  await storeRows([{ spot_key: spotKey, lat, lon, ...row }])

  return json({ wx: slim ? slimWx(row.wx) : row.wx, marine: slim ? null : row.marine,
                fetched_at: row.fetched_at, source: 'live' })
}

// ── Many spots, one round trip ──────────────────────────────────────────────
// Every entry echoes back the `q` token the caller sent, so the caller matches
// answers to cards by string identity rather than by re-deriving a key from
// floats it has already formatted once.
async function serveBatch(tokens: string[], force: boolean, slim: boolean) {
  const wanted: { q: string; lat: number; lon: number; spotKey: string }[] = []
  const bad: { q: string; error: string }[] = []
  const seen = new Set<string>()

  for (const q of tokens) {
    const [a, b] = q.split(',')
    const lat = Number(a), lon = Number(b)
    if (!validCoord(lat, lon)) { bad.push({ q, error: 'lat and lon required' }); continue }
    const spotKey = keyOf(lat, lon)
    if (seen.has(q)) continue
    seen.add(q)
    wanted.push({ q, lat, lon, spotKey })
  }
  if (!wanted.length) return json({ results: bad })

  const stored = new Map<string, Row>()
  {
    const { data } = await supabase
      .from('forecast_cache')
      .select('spot_key,wx,marine,fetched_at')
      .in('spot_key', [...new Set(wanted.map(w => w.spotKey))])
    for (const r of data || []) stored.set(r.spot_key, r as Row)
  }

  const misses = force
    ? wanted
    : wanted.filter(w => {
        const hit = stored.get(w.spotKey)
        return !(hit && Date.now() - new Date(hit.fetched_at).getTime() < FORECAST_TTL_MS)
      })

  const fetched = new Map<string, Row>()
  const failed = new Map<string, string>()
  if (misses.length) {
    // Two spots can share a spot_key (3 decimals ≈ 110 m), so fetch per key.
    const byKey = [...new Map(misses.map(m => [m.spotKey, m])).values()]
    const rows = await mapLimit(byKey, UPSTREAM_CONCURRENCY, async (m) => {
      try { return { m, row: await fetchUpstream(m.lat, m.lon) } }
      catch (err) { return { m, err: String(err) } as any }
    })
    const toStore: any[] = []
    for (const r of rows) {
      if (r.row) { fetched.set(r.m.spotKey, r.row); toStore.push({ spot_key: r.m.spotKey, lat: r.m.lat, lon: r.m.lon, ...r.row }) }
      else failed.set(r.m.spotKey, r.err)
    }
    await maybeSweep()
    await storeRows(toStore)
  }

  const results = wanted.map(w => {
    // Fresh beats stored; stored beats nothing. A spot whose upstream fetch
    // failed still answers from an expired row — an old forecast beats none.
    const fresh = fetched.get(w.spotKey)
    const hit = stored.get(w.spotKey)
    const row = fresh || hit
    if (!row) return { q: w.q, lat: w.lat, lon: w.lon, error: failed.get(w.spotKey) || 'no forecast' }
    const source = fresh ? 'live'
      : (Date.now() - new Date(hit!.fetched_at).getTime() < FORECAST_TTL_MS ? 'cache' : 'stale')
    return {
      q: w.q, lat: w.lat, lon: w.lon,
      wx: slim ? slimWx(row.wx) : row.wx,
      marine: slim ? null : row.marine,
      fetched_at: row.fetched_at, source,
    }
  })

  return json({ results: [...results, ...bad] })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { searchParams } = new URL(req.url)
  const force = searchParams.get('force') === '1'
  const slim  = searchParams.get('slim') === '1'
  const spots = searchParams.get('spots')

  if (spots) {
    const tokens = spots.split(';').map(s => s.trim()).filter(Boolean)
    if (!tokens.length) return json({ error: 'spots must hold at least one lat,lon pair' }, 400)
    if (tokens.length > MAX_BATCH_SPOTS) return json({ error: `at most ${MAX_BATCH_SPOTS} spots per request` }, 400)
    return await serveBatch(tokens, force, slim)
  }

  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  if (!validCoord(lat, lon)) return json({ error: 'lat and lon required' }, 400)

  return await serveSingle(lat, lon, force, slim)
})

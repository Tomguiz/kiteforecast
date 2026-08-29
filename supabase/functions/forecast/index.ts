import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

// A forecast fetched by one rider answers for every rider looking at the same
// spot. Two hours matches how often the rider's app re-checks on open, so a
// row never goes stale while still being served.
export const FORECAST_TTL_MS = 2 * 60 * 60 * 1000

// 3 decimals ≈ 110 m — the same key tide-proxy uses, and far finer than the
// weather model's own grid, so two riders on one spot always share a row.
const keyOf = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`

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
  })
  return `https://api.open-meteo.com/v1/forecast?${p}`
}
function marineUrl(lat: number, lon: number) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'wave_height,wave_period,wave_direction',
    forecast_days: '16', timezone: 'auto',
  })
  return `https://marine-api.open-meteo.com/v1/marine?${p}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { searchParams } = new URL(req.url)
  const lat = Number(searchParams.get('lat'))
  const lon = Number(searchParams.get('lon'))
  const force = searchParams.get('force') === '1'

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'lat and lon required' }, 400)
  }

  const spotKey = keyOf(lat, lon)

  // ── Serve the shared row while it is inside the window ────────────────────
  if (!force) {
    const { data } = await supabase
      .from('forecast_cache')
      .select('wx,marine,fetched_at')
      .eq('spot_key', spotKey)
      .maybeSingle()

    if (data && Date.now() - new Date(data.fetched_at).getTime() < FORECAST_TTL_MS) {
      return json({ wx: data.wx, marine: data.marine, fetched_at: data.fetched_at, source: 'cache' })
    }
  }

  // ── Miss, or a rider asked for fresh ──────────────────────────────────────
  let wx: any, marine: any = null
  try {
    const [wxRes, mRes] = await Promise.all([
      fetch(forecastUrl(lat, lon)),
      fetch(marineUrl(lat, lon)).catch(() => null),
    ])
    wx = await wxRes.json()
    if (wx?.error) throw new Error(wx.reason || 'forecast API error')
    // Marine has no data inland, and that is not a failure worth reporting.
    if (mRes && mRes.ok) {
      const m = await mRes.json()
      if (!m?.error) marine = m
    }
  } catch (err) {
    // Rather than fail the rider, hand back whatever is stored even if it is
    // past the window — an old forecast beats no forecast.
    const { data: stale } = await supabase
      .from('forecast_cache')
      .select('wx,marine,fetched_at')
      .eq('spot_key', spotKey)
      .maybeSingle()
    if (stale) return json({ ...stale, source: 'stale' })
    return json({ error: String(err) }, 502)
  }

  // Rows are also created for one-off geocoded searches, which nobody looks at
  // twice. Sweep occasionally rather than on a cron: it costs one statement on
  // a small fraction of the misses, and there is no schedule to keep alive.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase.from('forecast_cache').delete().lt('fetched_at', cutoff)
    if (error) console.error('forecast_cache sweep failed', error.message)
  }

  const fetched_at = new Date().toISOString()
  // A failed write must not fail the request: the rider already has the data.
  const { error: upErr } = await supabase
    .from('forecast_cache')
    .upsert({ spot_key: spotKey, lat, lon, wx, marine, fetched_at }, { onConflict: 'spot_key' })
  if (upErr) console.error('forecast_cache upsert failed', spotKey, upErr.message)

  return json({ wx, marine, fetched_at, source: 'live' })
})

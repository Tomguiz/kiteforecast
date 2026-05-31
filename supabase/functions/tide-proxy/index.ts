import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STORMGLASS_KEY   = Deno.env.get('STORMGLASS_KEY')!
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { searchParams } = new URL(req.url)
  const lat   = searchParams.get('lat')
  const lng   = searchParams.get('lng')
  const start = searchParams.get('start')

  if (!lat || !lng || !start) {
    return new Response(JSON.stringify({ error: 'lat, lng, start required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  const spotKey  = `${parseFloat(lat).toFixed(3)},${parseFloat(lng).toFixed(3)}`
  const dateFrom = start.slice(0, 10)

  // ── 1. Check Supabase cache ────────────────────────────────────────────────
  // Fetch all cached rows for this spot from today onwards (covers 10-day window)
  const { data: cached } = await supabase
    .from('tide_cache')
    .select('date,extremes')
    .eq('spot_key', spotKey)
    .gte('date', dateFrom)
    .order('date', { ascending: true })

  if (cached && cached.length >= 10) {
    // Full 10-day window already cached — return from DB, no API call
    const allExtremes = cached.flatMap((r: any) => r.extremes)
    return new Response(JSON.stringify({ data: allExtremes, source: 'cache' }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  // ── 2. Fetch from Stormglass ───────────────────────────────────────────────
  const startDt = new Date(start)
  startDt.setHours(0, 0, 0, 0)
  const endDt   = new Date(startDt)
  endDt.setDate(endDt.getDate() + 10)
  endDt.setHours(23, 59, 59, 0)

  const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${startDt.toISOString()}&end=${endDt.toISOString()}`
  const resp = await fetch(url, { headers: { Authorization: STORMGLASS_KEY } })
  if (!resp.ok) {
    // Stormglass failed — return whatever we have cached
    const allExtremes = (cached || []).flatMap((r: any) => r.extremes)
    return new Response(JSON.stringify({ data: allExtremes, source: 'partial_cache' }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
  const data = await resp.json()

  // ── 3. Group extremes by date and upsert into tide_cache ──────────────────
  const byDate: Record<string, any[]> = {}
  for (const e of data.data || []) {
    const d = e.time.slice(0, 10)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(e)
  }

  const rows = Object.entries(byDate).map(([date, extremes]) => ({
    spot_key: spotKey,
    date,
    extremes,
    fetched_at: new Date().toISOString(),
  }))

  if (rows.length) {
    await supabase.from('tide_cache').upsert(rows, { onConflict: 'spot_key,date' })
  }

  return new Response(JSON.stringify({ data: data.data, source: 'stormglass' }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

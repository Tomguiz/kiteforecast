const STORMGLASS_KEY = Deno.env.get('STORMGLASS_KEY')!

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
  const end   = searchParams.get('end')

  if (!lat || !lng || !start || !end) {
    return new Response(JSON.stringify({ error: 'lat, lng, start, end required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })
  }

  const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${start}&end=${end}`
  const resp = await fetch(url, { headers: { Authorization: STORMGLASS_KEY } })
  const data = await resp.json()

  return new Response(JSON.stringify(data), {
    status: resp.status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

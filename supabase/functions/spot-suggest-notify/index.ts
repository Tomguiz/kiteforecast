// Notifies admin when a user submits a new spot request
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL      = Deno.env.get('ADMIN_EMAIL') ?? 'tom.guisgand@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { name, location, lat, lon, dirs, business, website, note, contact_email, contact_name } = await req.json()

  const payload = {
    notification_type: 'spot_suggestion',
    admin_email:       ADMIN_EMAIL,
    spot_name:         name          || '—',
    location:          location      || '—',
    lat:               lat           || '—',
    lon:               lon           || '—',
    good_wind_dirs:    dirs          || '—',
    business_name:     business      || '—',
    website:           website       || '—',
    note:              note          || '—',
    contact_email:     contact_email || '—',
    contact_name:      contact_name  || '—',
    submitted_at:      new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
    maps_link:         lat && lon ? `https://maps.google.com/?q=${lat},${lon}` : '—',
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

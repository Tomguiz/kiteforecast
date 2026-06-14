// Notifies admin when a user submits a new spot request

const MAKE_WEBHOOK_URL  = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL       = Deno.env.get('ADMIN_EMAIL')        ?? 'tom.guisgand@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { name, location, lat, lon, dirs, business, website, note, contact_email, contact_name } = await req.json()

  // Encode spot data for the review deep-link
  const reviewData  = { name, location, lat, lon, business, website, note, contact_name, contact_email }
  const reviewToken = btoa(JSON.stringify(reviewData))
  const reviewUrl   = `https://tomguiz.github.io/kiteforecast/?review=${reviewToken}`

  // Plain app URL (not a single-use magic link): magic links get pre-consumed by
  // email link-scanners and expire, breaking the CTA. The admin's saved session
  // is restored on load, so they land signed-in on the review page.
  const review_link = reviewUrl

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
    review_link,
    review_instruction: 'Click the link below — you will be auto-logged in and the form will be pre-filled with all details. Review, adjust if needed, then click Save.',
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

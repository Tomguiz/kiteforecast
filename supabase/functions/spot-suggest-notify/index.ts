// Notifies admin when a user submits a new spot request
// Generates a magic link so admin is auto-authenticated on click
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAKE_WEBHOOK_URL  = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL       = Deno.env.get('ADMIN_EMAIL')        ?? 'tom.guisgand@gmail.com'
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')       ?? 'https://kpwmajtxmcfpakvonimf.supabase.co'
const SUPABASE_SERVICE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

  // Generate a magic link that auto-logs in the admin and redirects to the review URL
  let review_link = reviewUrl // fallback if magic link generation fails
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE)
    const { data, error } = await admin.auth.admin.generateLink({
      type:       'magiclink',
      email:      ADMIN_EMAIL,
      options:    { redirectTo: reviewUrl },
    })
    if (!error && data?.properties?.action_link) {
      review_link = data.properties.action_link
    }
  } catch (e) {
    console.error('Magic link generation failed:', e)
  }

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

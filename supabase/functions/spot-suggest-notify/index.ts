// Notifies admin when a user submits a new spot request AND persists the
// suggestion to the DB. The DB write lives here (service role) rather than in
// the client because spot_suggestions has RLS that only allows authenticated
// inserts where submitted_by matches the caller's own email — so anonymous or
// mismatched-email client inserts were being silently rejected, leaving the
// admin with an email but no row to review. Writing here bypasses RLS and
// keeps the notification and the row on a single, reliable path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAKE_WEBHOOK_URL  = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL       = Deno.env.get('ADMIN_EMAIL')        ?? 'tom.guisgand@gmail.com'
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { name, location, country, lat, lon, dirs, business, website, webcam, note, contact_email, contact_name } = await req.json()

  // Persist the suggestion first (service role → bypasses RLS). Mirrors the
  // note assembly the client used so the admin panel shows full context.
  const noteCombined = [
    dirs     && `Dirs: ${Array.isArray(dirs) ? dirs.join(', ') : dirs}`,
    business && `Business: ${business}`,
    website  && `Website: ${website}`,
    webcam   && `Webcam: ${webcam}`,
    note,
  ].filter(Boolean).join(' | ') || null

  const { error: insertErr } = await supabase.from('spot_suggestions').insert({
    suggested_name: name,
    location:       location || null,
    country:        country  || null,
    lat:            typeof lat === 'number' ? lat : (lat ? parseFloat(lat) : null),
    lon:            typeof lon === 'number' ? lon : (lon ? parseFloat(lon) : null),
    note:           noteCombined,
    submitted_by:   contact_email || null,
    contact_name:   (contact_name && contact_name !== '—') ? contact_name : null,
  })
  if (insertErr) console.error('spot_suggestions insert failed:', insertErr.message)

  // Encode spot data for the review deep-link. Use a UTF-8-safe base64 so
  // accented names, em-dashes, emoji etc. don't crash btoa (which only accepts
  // Latin1). The frontend mirrors this with decodeURIComponent(escape(atob(x))).
  const reviewData  = { name, location, lat, lon, business, website, note, contact_name, contact_email }
  const reviewToken = btoa(unescape(encodeURIComponent(JSON.stringify(reviewData))))
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

  // Never let a webhook hiccup fail the request — the row is already saved and
  // that's the part the admin panel depends on.
  let notified = true
  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
  } catch (e) {
    notified = false
    console.error('Make webhook failed:', (e as Error).message)
  }

  return new Response(JSON.stringify({ ok: true, saved: !insertErr, notified }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

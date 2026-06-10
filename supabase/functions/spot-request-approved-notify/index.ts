// Notifies a user when their spot request has been approved and added to KiteForecast

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, spot_name, contact_name, app_link } = await req.json()

  const payload = {
    notification_type: 'spot_request_approved',
    requester_email:   email,
    spot_name,
    contact_name:      contact_name || '',
    app_link:          app_link || `https://tomguiz.github.io/kiteforecast/?tab=contrib`,
    approved_at:       new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
    reward_points:     5,
    reward_premium:    '1 free month of Premium',
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

// Sends a confirmation email to the spot claimer when admin verifies their claim

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, spot_name, business_name, contact_name } = await req.json()

  const payload = {
    notification_type: 'claim_accepted',
    claimant_email:    email,
    spot_name,
    business_name:     business_name  || spot_name,
    contact_name:      contact_name   || '',
    app_link:          `https://tomguiz.github.io/kiteforecast/?spot=${encodeURIComponent(spot_name)}&tab=myspot`,
    accepted_at:       new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

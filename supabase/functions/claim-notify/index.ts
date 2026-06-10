// Sends an admin email when a spot owner submits a claim
// Uses the same Make.com webhook with notif_type: 'claim'

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL      = Deno.env.get('ADMIN_EMAIL') ?? 'tom.guisgand@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, spot_name, claim_id, business_name, website, contact_name, contact_phone, phone_public, contact_email, email_public, livecam_url, description } = await req.json()

  // Deep-link: opens app as admin, scrolls to the pending claim card
  const claimDeepLink = claim_id
    ? `https://tomguiz.github.io/kiteforecast/?claim=${btoa(JSON.stringify({ id: claim_id, spot_name, email }))}`
    : `https://tomguiz.github.io/kiteforecast/`

  const payload = {
    notification_type: 'claim',
    admin_email:    ADMIN_EMAIL,
    claimant_email: email,
    spot_name,
    business_name:  business_name  || '—',
    website:        website        || '—',
    contact_name:   contact_name   || '—',
    contact_phone:  contact_phone  || '—',
    phone_public:   phone_public   ? 'Yes' : 'No',
    contact_email:  contact_email  || '—',
    email_public:   email_public   ? 'Yes' : 'No',
    livecam_url:    livecam_url    || '—',
    description:    description    || '—',
    submitted_at:   new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
    verify_url:     claimDeepLink,
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

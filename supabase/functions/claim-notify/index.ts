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

  const { email, spot_name, business_name, website, contact_name, contact_phone, phone_public, contact_email, email_public, livecam_url, description } = await req.json()

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
    verify_url:     `https://supabase.com/dashboard/project/kpwmajtxmcfpakvonimf/editor?query=UPDATE+spot_claims+SET+verified%3Dtrue+WHERE+email%3D%27${encodeURIComponent(email)}%27+AND+spot_name%3D%27${encodeURIComponent(spot_name)}%27`,
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

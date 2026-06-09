// Sends an admin email when a user submits a spot update suggestion
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const ADMIN_EMAIL      = Deno.env.get('ADMIN_EMAIL') ?? 'tom.guisgand@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const DIR_LABELS: Record<number, string> = {0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, spot_name, website, livecam_url, lesson_url, gear_url,
          instagram_url, facebook_url, address, suggested_dirs, tip } = await req.json()

  const dirsLabel = suggested_dirs?.length
    ? suggested_dirs.map((d: number) => DIR_LABELS[d] ?? d).join(', ')
    : '—'

  const reviewUrl = `https://supabase.com/dashboard/project/kpwmajtxmcfpakvonimf/editor?query=SELECT+*+FROM+spot_update_suggestions+WHERE+spot_name%3D%27${encodeURIComponent(spot_name)}%27+AND+reviewed%3Dfalse`

  const payload = {
    notification_type: 'spot_update',
    admin_email:    ADMIN_EMAIL,
    submitter_email: email,
    spot_name,
    website:        website        || '—',
    livecam_url:    livecam_url    || '—',
    lesson_url:     lesson_url     || '—',
    gear_url:       gear_url       || '—',
    instagram_url:  instagram_url  || '—',
    facebook_url:   facebook_url   || '—',
    address:        address        || '—',
    suggested_dirs: dirsLabel,
    tip:            tip            || '—',
    submitted_at:   new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
    review_url:     reviewUrl,
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

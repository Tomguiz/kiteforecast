// Request handling for the unsubscribe endpoint, with the database behind a
// two-method port so the behaviour that matters can be tested without a network
// or a Deno runtime.
//
// The invariant worth protecting: GET must never mutate. Mail providers pre-fetch
// every link in an incoming message to scan it, so a GET that opted people out
// would unsubscribe them before they ever opened the email. This project already
// hit that once — weekly-digest's magicLink() was reduced to an identity function
// because scanners were consuming its single-use login links.

export interface UnsubscribeProfile {
  email: string
  notifs_enabled: boolean
}

export interface UnsubscribeDb {
  findByToken(token: string): Promise<UnsubscribeProfile | null>
  disable(token: string): Promise<void>
}

export const APP_BASE = 'https://tomguiz.github.io/kiteforecast/'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Keep the token out of referrers and out of search indexes.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  })

const page = (inner: string) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>KiteForecast &mdash; Email preferences</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#111318;color:#e8eef5;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;padding:24px;}
  .card{max-width:460px;width:100%;background:#141b27;border:1px solid #1e2535;border-radius:14px;padding:32px;}
  h1{margin:0 0 12px;font-size:21px;line-height:1.3;color:#fff;}
  p{margin:0 0 16px;font-size:14px;line-height:1.65;color:#aab7c6;}
  .sub{font-size:12.5px;color:#8494a6;}
  button{appearance:none;border:0;cursor:pointer;background:#0a7ac4;color:#fff;font:inherit;font-size:14.5px;
         font-weight:600;padding:13px 26px;border-radius:9px;}
  button:hover{background:#0968a8;}
  a{color:#5dd4f0;text-decoration:none;font-size:13px;}
  .brand{font-size:11px;font-weight:700;letter-spacing:2.5px;color:#2a3347;margin:0 0 20px;}
</style>
</head><body><div class="card"><p class="brand">KITEFORECAST</p>${inner}</div></body></html>`

// One response for both "malformed token" and "no such token", so the endpoint
// can't be used to probe whether a token is real.
const invalidLink = () => html(page(`
  <h1>This link isn't valid</h1>
  <p>It may have already been used, or the address was cut short by your email client &mdash; long links sometimes get wrapped onto two lines.</p>
  <p class="sub">You can change every email setting from your profile in the app.</p>
  <p><a href="${APP_BASE}?tab=notifs">Open notification settings &rarr;</a></p>`), 400)

export async function handleUnsubscribe(req: Request, db: UnsubscribeDb): Promise<Response> {
  const url = new URL(req.url)
  let token = url.searchParams.get('t') ?? ''

  if (req.method === 'POST') {
    // The confirmation form posts back to the same URL, so fall back to the
    // query string if the body is missing or unparseable.
    try {
      const fromForm = (await req.formData()).get('t')
      if (typeof fromForm === 'string' && fromForm) token = fromForm
    } catch { /* keep the query-string token */ }
  } else if (req.method !== 'GET') {
    return html(page('<h1>Method not allowed</h1>'), 405)
  }

  if (!UUID_RE.test(token)) return invalidLink()

  let profile: UnsubscribeProfile | null
  try {
    profile = await db.findByToken(token)
  } catch {
    return html(page('<h1>Something went wrong</h1><p>Try again in a moment.</p>'), 500)
  }
  if (!profile) return invalidLink()

  if (req.method === 'GET') {
    if (profile.notifs_enabled === false) {
      return html(page(`
        <h1>You're already unsubscribed</h1>
        <p>KiteForecast isn't sending emails to <strong>${escapeHtml(profile.email)}</strong>.</p>
        <p class="sub">Changed your mind? Turn them back on from your profile.</p>
        <p><a href="${APP_BASE}?tab=notifs">Open notification settings &rarr;</a></p>`))
    }
    return html(page(`
      <h1>Unsubscribe from KiteForecast emails?</h1>
      <p>This stops every wind alert, reminder and weekly digest sent to <strong>${escapeHtml(profile.email)}</strong>.</p>
      <form method="POST">
        <input type="hidden" name="t" value="${escapeHtml(token)}"/>
        <button type="submit">Yes, unsubscribe me</button>
      </form>
      <p class="sub" style="margin-top:18px;">Would you rather keep the good bits? You can switch off individual alerts and keep the rest.</p>
      <p><a href="${APP_BASE}?tab=notifs">Choose which emails to keep &rarr;</a></p>`))
  }

  try {
    await db.disable(token)
  } catch {
    return html(page('<h1>Something went wrong</h1><p>Try again in a moment.</p>'), 500)
  }

  return html(page(`
    <h1>Done &mdash; you're unsubscribed</h1>
    <p>No more emails to <strong>${escapeHtml(profile.email)}</strong>. Sorry to see you go.</p>
    <p class="sub">Your account and saved spots are untouched, and you can turn emails back on any time.</p>
    <p><a href="${APP_BASE}?tab=notifs">Open notification settings &rarr;</a></p>`))
}

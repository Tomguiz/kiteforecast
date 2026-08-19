// JSON API behind the unsubscribe page, with the database behind a two-method
// port so the behaviour that matters can be tested without a network.
//
// Why this returns JSON rather than a page: Supabase Edge Functions rewrite a
// text/html response to text/plain on non-custom domains, and the gateway adds
// x-content-type-options: nosniff, so the browser shows the markup as source.
// HTML cannot be served from here at all. The page therefore lives on GitHub
// Pages (unsubscribe.html, alongside index.html) and calls this for its data.
//
// The invariant worth protecting is unchanged: GET must never mutate. Mail
// providers pre-fetch every link in a message to scan it, so a GET that opted
// people out would unsubscribe riders who never opened the email. This project
// already hit that once — weekly-digest's magicLink() was reduced to an identity
// function because scanners were consuming its single-use login links.

export interface UnsubscribeProfile {
  email: string
  notifs_enabled: boolean
}

export interface UnsubscribeDb {
  findByToken(token: string): Promise<UnsubscribeProfile | null>
  disable(token: string): Promise<void>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The page is served from GitHub Pages, so this is a genuine cross-origin call.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Keep the token out of referrers and out of search indexes.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  })

// One response for both "malformed token" and "no such token", so this endpoint
// can't be used to probe whether a token is real.
const invalidLink = () => json({ error: 'invalid_link' }, 400)

export async function handleUnsubscribe(req: Request, db: UnsubscribeDb): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(req.url)
  let token = url.searchParams.get('t') ?? ''

  if (req.method === 'POST') {
    // The page posts JSON, but fall back to the query string so a hand-made
    // request with no body still works.
    try {
      const body = await req.json()
      if (typeof body?.t === 'string' && body.t) token = body.t
    } catch { /* keep the query-string token */ }
  } else if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  if (!UUID_RE.test(token)) return invalidLink()

  let profile: UnsubscribeProfile | null
  try {
    profile = await db.findByToken(token)
  } catch {
    return json({ error: 'server_error' }, 500)
  }
  if (!profile) return invalidLink()

  // GET is a read: it tells the page whose address this is and whether they are
  // already unsubscribed. It never writes.
  if (req.method === 'GET') {
    return json({ email: profile.email, already_unsubscribed: profile.notifs_enabled === false })
  }

  try {
    await db.disable(token)
  } catch {
    return json({ error: 'server_error' }, 500)
  }

  return json({ ok: true, email: profile.email })
}

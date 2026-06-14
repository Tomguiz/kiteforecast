import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, Deno.env.get('SB_SERVICE_ROLE_KEY')!)
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_PRICE_ID   = Deno.env.get('STRIPE_PRICE_ID')!

const ALLOWED_ORIGINS = new Set(['https://tomguiz.github.io'])
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tomguiz.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
})

// Verify the caller's JWT and return their verified email (or null).
async function callerEmail(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error } = await sb.auth.getUser(token)
    if (error || !user?.email) return null
    return user.email.toLowerCase()
  } catch { return null }
}

const stripePost = (path: string, body: Record<string, string>) =>
  fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  }).then(r => r.json())

const stripeGet = (path: string) =>
  fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  }).then(r => r.json())

Deno.serve(async (req) => {
  const CORS = corsFor(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    const verifiedEmail = await callerEmail(req)
    if (!verifiedEmail) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } })

    const { email: bodyEmail, success_url, cancel_url } = await req.json()
    // Always bill the authenticated user — ignore any email in the body that
    // doesn't match, so nobody can start checkout against someone else's account.
    const email = verifiedEmail
    if (bodyEmail && bodyEmail.toLowerCase() !== verifiedEmail) {
      return new Response(JSON.stringify({ error: 'email mismatch' }), { status: 403, headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('email', email).single()
    let customerId = profile?.stripe_customer_id

    if (!customerId) {
      const customer = await stripePost('customers', { email })
      if (customer.error) throw new Error(customer.error.message)
      customerId = customer.id
      await supabase.from('profiles').upsert({ email, stripe_customer_id: customerId }, { onConflict: 'email' })
    }

    const session = await stripePost('checkout/sessions', {
      customer:              customerId,
      mode:                  'payment',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      success_url:           success_url || 'https://tomguiz.github.io/kiteforecast/?premium=success',
      cancel_url:            cancel_url  || 'https://tomguiz.github.io/kiteforecast/?premium=cancelled',
      allow_promotion_codes: 'true',
    })

    if (session.error) throw new Error(session.error.message)

    return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('stripe-checkout error:', e)
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } })
  }
})

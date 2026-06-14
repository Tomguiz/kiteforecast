import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, Deno.env.get('SB_SERVICE_ROLE_KEY')!)
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!

const ALLOWED_ORIGINS = new Set(['https://tomguiz.github.io'])
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tomguiz.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
})

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

Deno.serve(async (req) => {
  const CORS = corsFor(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    const verifiedEmail = await callerEmail(req)
    if (!verifiedEmail) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } })

    const { email: bodyEmail, return_url } = await req.json()
    const email = verifiedEmail
    if (bodyEmail && bodyEmail.toLowerCase() !== verifiedEmail) {
      return new Response(JSON.stringify({ error: 'email mismatch' }), { status: 403, headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('email', email).single()
    if (!profile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No Stripe customer found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    const resp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   profile.stripe_customer_id,
        return_url: return_url || 'https://tomguiz.github.io/kiteforecast/',
      }).toString(),
    })
    const session = await resp.json()
    if (session.error) throw new Error(session.error.message)

    return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('stripe-portal error:', e)
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } })
  }
})

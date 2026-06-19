// Self-heal premium: for the AUTHENTICATED caller, checks Stripe for a paid
// payment and sets is_premium=true if found. A safety net so a webhook miss
// (mis-set events, downtime, customer-id mismatch) never leaves a paid user
// without premium — the client calls this after checkout if the webhook hasn't
// flipped is_premium in time.
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

const stripeGet = (path: string) =>
  fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  }).then(r => r.json())

Deno.serve(async (req) => {
  const CORS = corsFor(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

  const email = await callerEmail(req)
  if (!email) return reply({ error: 'Sign in required' }, 401)

  // Already premium? nothing to do.
  const { data: profile } = await supabase.from('profiles')
    .select('is_premium, stripe_customer_id').eq('email', email).single()
  if (profile?.is_premium) return reply({ premium: true, source: 'already' })

  const customerId = profile?.stripe_customer_id
  if (!customerId) return reply({ premium: false, reason: 'no_stripe_customer' })

  // Did this customer actually pay? Check succeeded PaymentIntents + paid sessions.
  try {
    const pis = await stripeGet(`payment_intents?customer=${customerId}&limit=10`)
    const paidPI = (pis.data || []).some((p: { status: string }) => p.status === 'succeeded')
    let paid = paidPI
    if (!paid) {
      const sessions = await stripeGet(`checkout/sessions?customer=${customerId}&limit=10`)
      paid = (sessions.data || []).some((s: { payment_status: string }) => s.payment_status === 'paid')
    }
    if (!paid) return reply({ premium: false, reason: 'no_paid_record' })

    // Self-heal: grant premium (service role write).
    const { error } = await supabase.from('profiles').update({ is_premium: true }).eq('email', email)
    if (error) {
      console.error('[verify-premium] failed to set premium for', email, error.message)
      return reply({ premium: false, error: error.message }, 500)
    }
    console.log('[verify-premium] SELF-HEALED premium for', email)
    return reply({ premium: true, source: 'self_heal' })
  } catch (e) {
    console.error('[verify-premium] error', (e as Error).message)
    return reply({ premium: false, error: (e as Error).message }, 500)
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SERVICE_ROLE_KEY')!)
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    const { email, return_url } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })

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

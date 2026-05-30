import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SERVICE_ROLE_KEY')!)
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_PRICE_ID   = Deno.env.get('STRIPE_PRICE_ID')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {
    const { email, success_url, cancel_url } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })

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
      mode:                  'subscription',
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

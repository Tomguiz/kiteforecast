import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SERVICE_ROLE_KEY')!)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, success_url, cancel_url } = await req.json()
  if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: CORS })

  // Get or create Stripe customer
  const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('email', email).single()
  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({ email })
    customerId = customer.id
    await supabase.from('profiles').upsert({ email, stripe_customer_id: customerId }, { onConflict: 'email' })
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
    success_url: success_url || 'https://tomguiz.github.io/kiteforecast/?premium=success',
    cancel_url:  cancel_url  || 'https://tomguiz.github.io/kiteforecast/?premium=cancelled',
    allow_promotion_codes: true,
  })

  return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json', ...CORS } })
})

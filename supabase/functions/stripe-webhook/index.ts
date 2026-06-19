// ⚠️ STRIPE DASHBOARD REQUIREMENT:
// The app uses ONE-TIME payments (mode:'payment'), so premium is granted in the
// `checkout.session.completed` case below. The Stripe webhook endpoint MUST have
// `checkout.session.completed` in its enabled events — otherwise paid users
// never get is_premium=true (the bug that left every payer needing a manual fix
// until 2026-06-19). Enabled events should include at least:
//   checkout.session.completed   ← REQUIRED for premium grant
//   customer.subscription.{created,updated,deleted}, invoice.payment_failed
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SERVICE_ROLE_KEY')!)
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (e) {
    return new Response(`Webhook error: ${e.message}`, { status: 400 })
  }

  const setPremium = async (customerId: string, isPremium: boolean) => {
    // .select() returns the affected rows so we can detect a no-op (e.g. a
    // customer id with no matching profile) instead of failing silently.
    const { data, error } = await supabase.from('profiles')
      .update({ is_premium: isPremium }).eq('stripe_customer_id', customerId).select('email')
    if (error) console.error(`[webhook] setPremium error for ${customerId}:`, error.message)
    else if (!data || data.length === 0) console.error(`[webhook] setPremium matched 0 profiles for customer ${customerId} (premium=${isPremium}) — possible customer-id mismatch`)
    else console.log(`[webhook] setPremium ${isPremium} for ${data.map((r) => r.email).join(',')}`)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.payment_status === 'paid' && session.mode === 'payment') {
        await setPremium(session.customer as string, true)
      }
      break
    }
    // Keep subscription events for legacy/future use
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const active = sub.status === 'active' || sub.status === 'trialing'
      await setPremium(sub.customer as string, active)
      break
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      await setPremium(sub.customer as string, false)
      break
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      await setPremium(inv.customer as string, false)
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})

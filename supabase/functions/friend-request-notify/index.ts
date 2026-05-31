// Notifies a user by email when someone sends them a friend request
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/YOUR_FRIEND_REQUEST_WEBHOOK'
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')     ?? 'https://kpwmajtxmcfpakvonimf.supabase.co'
const SUPABASE_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { requester_email, requester_nickname, recipient_email } = await req.json()
  if (!requester_email || !recipient_email) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: CORS })
  }

  // Fetch recipient nickname from DB
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE)
  const { data: recipient } = await admin.from('profiles')
    .select('nickname')
    .eq('email', recipient_email)
    .maybeSingle()

  const recipient_nickname = recipient?.nickname || recipient_email.split('@')[0]

  // Generate magic link so recipient is auto-logged in when clicking
  let app_link = 'https://tomguiz.github.io/kiteforecast/'
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type:    'magiclink',
      email:   recipient_email,
      options: { redirectTo: 'https://tomguiz.github.io/kiteforecast/?tab=friends' },
    })
    if (!error && data?.properties?.action_link) {
      app_link = data.properties.action_link
    }
  } catch (e) {
    console.error('Magic link error:', e)
  }

  const rNick = requester_nickname || requester_email.split('@')[0]
  const payload = {
    notification_type:    'friend_request',
    recipient_email,
    recipient_nickname,
    requester_nickname:   rNick,
    requester_initial:    rNick[0].toUpperCase(),
    app_link,
    sent_at:              new Date().toLocaleString('en', { dateStyle: 'full', timeStyle: 'short' }),
  }

  await fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

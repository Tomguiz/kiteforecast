// Notifies friends when a user confirms they're going kiting
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')     ?? 'https://kpwmajtxmcfpakvonimf.supabase.co'
const SUPABASE_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const { email, nickname, spot_name, session_date, start_time, duration_h, note } = await req.json()
  if (!email || !spot_name || !session_date) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: CORS })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE)

  // Get accepted friends
  const { data: friendships } = await admin.from('friendships')
    .select('requester,recipient')
    .or(`requester.eq.${email},recipient.eq.${email}`)
    .eq('status', 'accepted')

  if (!friendships?.length) {
    return new Response(JSON.stringify({ ok: true, notified: 0 }), { headers: CORS })
  }

  const friendEmails = friendships.map((f: any) => f.requester === email ? f.recipient : f.requester)

  // Get friend profiles — only those who want these notifications
  const { data: friends } = await admin.from('profiles')
    .select('email,nickname,friend_session_notifs')
    .in('email', friendEmails)
    .or('friend_session_notifs.is.null,friend_session_notifs.eq.true')

  // Format date nicely
  const dateLabel = new Date(session_date + 'T12:00:00').toLocaleDateString('en', {
    weekday: 'long', month: 'long', day: 'numeric'
  })

  // Compute end time
  const [h, m] = start_time.split(':').map(Number)
  const endH = (h + duration_h) % 24
  const endTime = `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`

  // Join deep link — opens app, searches spot, auto-opens attend sheet for same date
  const joinData = btoa(JSON.stringify({ spot: spot_name, date: session_date, start_time }))
  const joinUrl  = `https://tomguiz.github.io/kiteforecast/?join=${joinData}`
  const appLink  = `https://tomguiz.github.io/kiteforecast/?spot=${encodeURIComponent(spot_name)}`

  // Send one webhook per friend
  const sends = (friends || []).map(async (friend: any) => {
    // Plain app URL (not a single-use magic link): magic links get pre-consumed by
    // email link-scanners and expire, breaking the CTA. The app restores the user's
    // saved session on load, so returning users land signed-in.
    const join_link = joinUrl

    return fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_type:  'session_attendance',
        recipient_email:    friend.email,
        recipient_nickname: friend.nickname || friend.email.split('@')[0],
        attendee_nickname:  nickname,
        spot_name,
        session_date:       dateLabel,
        start_time,
        end_time:           endTime,
        duration_h,
        note:               note || '',
        maps_link:          `https://maps.google.com/?q=${encodeURIComponent(spot_name)}`,
        app_link:           appLink,
        join_link,
      }),
    })
  })

  await Promise.all(sends)

  return new Response(JSON.stringify({ ok: true, notified: sends.length }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
})

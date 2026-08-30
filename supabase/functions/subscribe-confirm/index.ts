import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { deliver } from '../_shared/mailer.ts'
import { recordEmail } from '../_shared/email-log-client.ts'

// The "your sessions are confirmed" email, moved off the browser.
//
// It used to be POSTed straight from index.html to the Make webhook, which is
// why it stopped arriving: that path still went through the consumer Outlook
// mailbox, and the migration to Resend only covered the server functions.
//
// The reason it could not simply be forwarded is that a function which mails
// whatever address the browser names is an open relay — the anon key is public,
// it ships in index.html. So the recipient is taken from the caller's verified
// access token and nothing else. The worst a crafted request can do is mail its
// own author.

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON    = Deno.env.get('SUPABASE_ANON_KEY')!
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

type Day = {
  date?: string
  date_label?: string
  app_link?: string
  next_reminders?: string[]
  session?: Record<string, unknown>
}

// Make rendered this block from the `days` array. Everything interpolated is
// escaped: it is the caller's own inbox, but a template that concatenates
// unescaped input is a habit worth not having.
function daysHtml(days: Day[]): string {
  if (!days.length) {
    return `<div style="font-size:14px;color:#8b98ad;">No sessions in the forecast window yet — we will email you as soon as one appears.</div>`
  }
  return days.map(d => {
    const s = d.session ?? {}
    const start = esc(s.start_time_formatted)
    const end = esc(s.end_time_formatted)
    const window = start && end ? `${start}–${end}` : start || '—'
    const reminders = (d.next_reminders ?? []).map(esc).join(' · ')
    return `
    <div style="border:1px solid #1e2535;border-radius:10px;padding:16px 18px;margin-bottom:12px;background-color:#11151f;">
      <div style="font-size:15px;font-weight:700;color:#e8edf5;margin-bottom:6px;">${esc(d.date_label)}</div>
      <div style="font-size:13px;color:#8b98ad;line-height:1.7;">
        🪁 ${window} · ${esc(s.duration_hours)}h<br>
        💨 ${esc(s.wind_speed_peak_kn)} kn peak · gusts ${esc(s.wind_gusts_kn)} kn · ${esc(s.wind_direction)}<br>
        ${s.rating ? `<span style="color:#4ade80;">${esc(s.rating)}</span><br>` : ''}
        ${reminders ? `<span style="color:#4a5568;">Reminders: ${reminders}</span>` : ''}
      </div>
      ${d.app_link ? `<a href="${esc(d.app_link)}" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600;color:#38bdf8;text-decoration:none;">See the day →</a>` : ''}
    </div>`
  }).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Whose inbox this lands in is decided here, and only here.
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.match(/^\s*Bearer\s+(\S+)\s*$/i)?.[1]
  if (!token) return json({ error: 'sign in required' }, 401)

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON)
  const { data: { user }, error: authErr } = await sb.auth.getUser(token)
  if (authErr || !user?.email) return json({ error: 'sign in required' }, 401)

  let body: Record<string, any> = {}
  try { body = await req.json() } catch { /* an empty body is still a valid ask */ }

  const days: Day[] = Array.isArray(body.days) ? body.days.slice(0, 16) : []

  const payload = {
    notification_type: 'confirmation',
    // Deliberately the token's email, not body.email.
    email:         user.email,
    spot:          esc(body.spot),
    spot_city:     esc(body.spot_city),
    spot_country:  esc(body.spot_country),
    spot_map_link: esc(body.spot_map_link),
    app_link:      esc(body.app_link),
    manage_link:   esc(body.manage_link),
    days_html:     daysHtml(days),
  }

  const sent = await deliver(payload, {
    to: user.email,
    delivery: { template: 'confirmation', subject: '🔔 [[spot]] — your sessions are confirmed, we\'re watching for you' },
    makeWebhookUrl: MAKE_WEBHOOK_URL,
  })
  if (!sent.ok) return json({ error: sent.error ?? 'send failed' }, 502)

  await recordEmail({
    email: user.email, kind: 'confirmation',
    meta: { spot_name: payload.spot, days: days.length, via: sent.via },
  })
  return json({ ok: true, via: sent.via, days: days.length })
})

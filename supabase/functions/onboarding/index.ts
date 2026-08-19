// Sends the onboarding email roughly 24 hours after signup.
//
// Driven by an hourly pg_cron job. Three things keep it from misfiring:
//
//   1. A go-live cutoff. Signup dates go back to April, and none of those
//      riders should suddenly be welcomed months later. Only accounts created
//      after ONBOARDING_START are ever eligible.
//   2. email_log is the dedupe. One row per rider with kind 'onboarding' means
//      it has gone; the query skips anyone who already has one. That is why
//      this is keyed on the log rather than a bespoke table.
//   3. A lower age bound as well as an upper one. "Older than 24h" alone would
//      sweep up an account created weeks ago that somehow never got the email;
//      capping the window keeps a missed run from mailing someone a stale
//      welcome, while still being wide enough to absorb a few failed runs.
//
// Signup time lives in auth.users, not profiles — profiles has no created_at —
// so this reads the auth schema with the service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildNextStepHtml, resolveStage, type OnboardingStage } from './content.ts'
import { recordEmail } from '../_shared/email-log-client.ts'
import { isServiceRoleCaller } from '../_shared/service-role-auth.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const APP_BASE    = 'https://tomguiz.github.io/kiteforecast/'
const PROFILE_URL = `${APP_BASE}?tab=profile`
const NOTIFS_URL  = `${APP_BASE}?tab=notifs`

const KIND = 'onboarding'

// Nobody who signed up before this gets an onboarding email. Set to the moment
// this shipped, so the 26 existing riders are never welcomed retroactively.
const ONBOARDING_START = new Date(
  Deno.env.get('ONBOARDING_START') ?? '2026-08-19T22:00:00Z',
)

// Send once the account is at least this old, and give up past the upper bound.
const MIN_AGE_HOURS = 24
const MAX_AGE_HOURS = 72

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Same gate as the broadcast: the anon key is public, and this mails people.
  if (!isServiceRoleCaller(req.headers, SUPABASE_SERVICE_KEY)) {
    return json({ error: 'Service-role key required' }, 401)
  }

  let dryRun = false
  let emailFilter: string | null = null
  try {
    const body = await req.json()
    dryRun      = body?.dry_run === true
    emailFilter = body?.email_filter ?? null
  } catch { /* cron sends {} */ }

  const now   = Date.now()
  const upper = new Date(now - MIN_AGE_HOURS * 3_600_000)  // created before this
  const lower = new Date(now - MAX_AGE_HOURS * 3_600_000)  // but not before this
  const floor = lower > ONBOARDING_START ? lower : ONBOARDING_START

  // auth.users is not exposed through PostgREST, so go through the admin API.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return json({ error: listErr.message }, 500)

  const candidates = (list?.users ?? []).filter(u => {
    if (!u.email) return false
    if (emailFilter) return u.email.toLowerCase() === emailFilter.toLowerCase()
    const created = new Date(u.created_at)
    return created > floor && created <= upper
  })

  if (candidates.length === 0) {
    return json({ eligible: 0, sent: 0, skipped: 0, failed: 0, window: { from: floor, to: upper } })
  }

  const emails = candidates.map(u => u.email!.toLowerCase())

  // Everyone who already had it. This is the dedupe.
  const { data: already, error: logErr } = await supabase
    .from('email_log').select('email').eq('kind', KIND).in('email', emails)
  if (logErr) return json({ error: logErr.message }, 500)
  const done = new Set((already ?? []).map((r: { email: string }) => r.email))

  // One query each rather than per rider.
  const [{ data: profiles }, { data: favs }, { data: rems }] = await Promise.all([
    supabase.from('profiles').select('email,nickname,unsubscribe_token').in('email', emails),
    supabase.from('favourites').select('email,spot_name,spot_label').in('email', emails),
    supabase.from('reminders').select('email').in('email', emails),
  ])

  const profByEmail = new Map((profiles ?? []).map((p: any) => [p.email.toLowerCase(), p]))
  const favsByEmail = new Map<string, any[]>()
  for (const f of favs ?? []) {
    const k = f.email.toLowerCase()
    favsByEmail.set(k, [...(favsByEmail.get(k) ?? []), f])
  }
  const remCount = new Map<string, number>()
  for (const r of rems ?? []) {
    const k = r.email.toLowerCase()
    remCount.set(k, (remCount.get(k) ?? 0) + 1)
  }

  const stages: Record<OnboardingStage, number> = { no_spot: 0, no_reminders: 0, ready: 0 }
  const failures: { email: string; reason: string }[] = []
  let sent = 0
  let skipped = 0

  for (const email of emails) {
    if (done.has(email)) { skipped++; continue }

    const prof = profByEmail.get(email)
    // A rider with no profile row has never opened the app past sign-in. They
    // still get the email — that is exactly who onboarding is for — but there
    // is no nickname or unsubscribe token, and mailing without a working
    // opt-out is not acceptable, so skip rather than send a broken footer.
    if (!prof?.unsubscribe_token) {
      failures.push({ email, reason: 'no profile row / no unsubscribe token' })
      continue
    }

    const userFavs = favsByEmail.get(email) ?? []
    const state = {
      favCount: userFavs.length,
      reminderCount: remCount.get(email) ?? 0,
      favNames: userFavs.map((f: any) => f.spot_label || f.spot_name).filter(Boolean),
    }
    const nickname = prof.nickname || email.split('@')[0]
    stages[resolveStage(state)]++

    const payload = {
      notification_type: KIND,
      email,
      nickname: escapeHtml(nickname),
      stage: resolveStage(state),
      app_link:         APP_BASE,
      // Profile panel is where the upgrade card lives.
      upgrade_link:     PROFILE_URL,
      next_step_html:   buildNextStepHtml(state, { app: APP_BASE, profile: PROFILE_URL, notifs: NOTIFS_URL }, nickname),
      unsubscribe_link: `${APP_BASE}unsubscribe.html?t=${prof.unsubscribe_token}`,
    }

    if (dryRun) { sent++; continue }

    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { failures.push({ email, reason: `webhook ${res.status}` }); continue }
    } catch (e) {
      failures.push({ email, reason: String(e) })
      continue
    }

    // The log is the dedupe, so a failure to record means this rider would be
    // mailed again next hour. Surface it rather than reporting a clean run.
    if (!await recordEmail({ email, kind: KIND, meta: { stage: resolveStage(state) } })) {
      failures.push({ email, reason: 'sent but not recorded — may repeat next run' })
    }
    sent++
  }

  return json({
    dry_run: dryRun,
    window: { from: floor, to: upper },
    eligible: emails.length,
    sent, skipped,
    failed: failures.length,
    failures: failures.slice(0, 20),
    stages,
  })
})

function escapeHtml(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

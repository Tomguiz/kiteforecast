// The two lifecycle emails a new rider gets, both driven by one hourly pg_cron
// job because they share every piece of machinery: read auth.users, work out
// who is inside an age window, skip anyone already mailed, send, log.
//
//   onboarding     — 24h after signup. What the app does, all of it free.
//   premium_pitch  — 14 days after signup. The paid half, and the only email
//                    that sells anything.
//
// Four things keep either pass from misfiring:
//
//   1. A go-live cutoff per pass. Signup dates go back to April, and none of
//      those riders should suddenly be welcomed — or sold to — months later.
//      Only accounts created after the pass's START are ever eligible.
//   2. email_log is the dedupe. One row per rider per kind means it has gone;
//      the query skips anyone who already has one. That is why this is keyed on
//      the log rather than a bespoke table.
//   3. A lower age bound as well as an upper one. "Older than 24h" alone would
//      sweep up an account created weeks ago that somehow never got the email;
//      capping the window keeps a missed run from mailing someone a stale
//      welcome, while still being wide enough to absorb a few failed runs.
//   4. notifs_enabled. A rider who unsubscribed inside the first fortnight has
//      said what they want, and a scheduled email is exactly the kind this
//      applies to.
//
// Signup time lives in auth.users, not profiles — profiles has no created_at —
// so this reads the auth schema with the service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildNextStepHtml, resolveStage } from './content.ts'
import { buildPremiumHookHtml, resolvePremiumStage } from './premium-content.ts'
import { recordEmail } from '../_shared/email-log-client.ts'
import { isServiceRoleCaller } from '../_shared/service-role-auth.ts'
import { deliver } from '../_shared/mailer.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const APP_BASE    = 'https://tomguiz.github.io/kiteforecast/'
const PROFILE_URL = `${APP_BASE}?tab=profile`
const NOTIFS_URL  = `${APP_BASE}?tab=notifs`

const HOUR = 3_600_000

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

const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// ── The two passes ────────────────────────────────────────────────────────
//
// Everything that differs between the welcome and the premium pitch lives
// here; everything they share lives in runPass() below.

type Profile = {
  email: string
  nickname?: string | null
  unsubscribe_token?: string | null
  notifs_enabled?: boolean | null
  is_premium?: boolean | null
  premium_until?: string | null
}

type PassContext = { email: string; nickname: string; profile: Profile }

type Pass = {
  kind: string
  minAgeHours: number
  maxAgeHours: number
  /** Nobody who signed up before this is ever eligible for this pass. */
  start: Date
  /** Everything the pass needs beyond profiles, loaded once for all riders. */
  load: (emails: string[]) => Promise<unknown>
  /** null means "skip this rider", with the reason for the report. */
  build: (ctx: PassContext, extra: any) => { payload: Record<string, unknown>; stage: string } | { skip: string }
}

const ONBOARDING: Pass = {
  kind: 'onboarding',
  minAgeHours: 24,
  maxAgeHours: 72,
  // Set to the moment this shipped, so the riders who signed up before it are
  // never welcomed retroactively.
  start: new Date(Deno.env.get('ONBOARDING_START') ?? '2026-08-19T22:00:00Z'),

  load: async (emails) => {
    const [{ data: favs }, { data: rems }] = await Promise.all([
      supabase.from('favourites').select('email,spot_name,spot_label').in('email', emails),
      supabase.from('reminders').select('email').in('email', emails),
    ])
    return { favs: groupBy(favs ?? []), rems: countBy(rems ?? []) }
  },

  build: ({ email, nickname }, { favs, rems }) => {
    const userFavs: any[] = favs.get(email) ?? []
    const state = {
      favCount: userFavs.length,
      reminderCount: rems.get(email) ?? 0,
      favNames: userFavs.map(f => f.spot_label || f.spot_name).filter(Boolean),
    }
    const stage = resolveStage(state)
    return {
      stage,
      payload: {
        notification_type: 'onboarding',
        email,
        nickname: escapeHtml(nickname),
        stage,
        app_link:       APP_BASE,
        next_step_html: buildNextStepHtml(
          state, { app: APP_BASE, profile: PROFILE_URL, notifs: NOTIFS_URL }, nickname),
      },
    }
  },
}

const PREMIUM_PITCH: Pass = {
  kind: 'premium_pitch',
  minAgeHours: 14 * 24,        // two weeks
  maxAgeHours: 17 * 24,        // three days of slack for failed runs
  // Defaults to when this shipped, which is deliberately *after* the onboarding
  // cutoff: a rider whose first contact would be a sales email should not get
  // one. Everybody eligible here has already had the welcome.
  start: new Date(Deno.env.get('PREMIUM_PITCH_START') ?? '2026-08-30T22:00:00Z'),

  load: async (emails) => {
    // Friendships are stored one row per pair, and the rider can be on either
    // side of it, so both columns are queried and merged.
    const [{ data: rems }, { data: asRequester }, { data: asRecipient }] = await Promise.all([
      supabase.from('reminders').select('email').in('email', emails),
      supabase.from('friendships').select('requester,recipient')
        .eq('status', 'accepted').in('requester', emails),
      supabase.from('friendships').select('requester,recipient')
        .eq('status', 'accepted').in('recipient', emails),
    ])
    const friends = new Map<string, number>()
    const bump = (e: unknown) => {
      const k = String(e ?? '').toLowerCase()
      if (k) friends.set(k, (friends.get(k) ?? 0) + 1)
    }
    for (const f of asRequester ?? []) bump((f as any).requester)
    for (const f of asRecipient ?? []) bump((f as any).recipient)
    return { rems: countBy(rems ?? []), friends }
  },

  build: ({ email, nickname, profile }, { rems, friends }) => {
    // No point selling premium to somebody who already bought it.
    if (isPremium(profile)) return { skip: 'already premium' }

    const state = {
      reminderCount: rems.get(email) ?? 0,
      friendCount: friends.get(email) ?? 0,
    }
    const stage = resolvePremiumStage(state)
    return {
      stage,
      payload: {
        notification_type: 'premium_pitch',
        email,
        nickname: escapeHtml(nickname),
        stage,
        app_link:     APP_BASE,
        // Profile panel is where the checkout button lives.
        upgrade_link: PROFILE_URL,
        hook_html:    buildPremiumHookHtml(state, { app: APP_BASE, upgrade: PROFILE_URL }, nickname),
      },
    }
  },
}

const PASSES: Record<string, Pass> = {
  onboarding:    ONBOARDING,
  premium_pitch: PREMIUM_PITCH,
}

function isPremium(p: Profile): boolean {
  if (p.is_premium) return true
  if (p.premium_until && new Date(p.premium_until) > new Date()) return true
  return false
}

function groupBy(rows: { email: string }[]) {
  const m = new Map<string, any[]>()
  for (const r of rows) {
    const k = r.email.toLowerCase()
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return m
}

function countBy(rows: { email: string }[]) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r.email.toLowerCase()
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

// ── The shared machinery ──────────────────────────────────────────────────

type PassResult = {
  window: { from: string; to: string }
  eligible: number
  sent: number
  skipped: number
  failed: number
  failures: { email: string; reason: string }[]
  stages: Record<string, number>
}

async function runPass(
  pass: Pass,
  users: { email?: string; created_at: string }[],
  opts: { dryRun: boolean; emailFilter: string | null },
): Promise<PassResult | { error: string }> {
  const now   = Date.now()
  const upper = new Date(now - pass.minAgeHours * HOUR)  // created before this
  const lower = new Date(now - pass.maxAgeHours * HOUR)  // but not before this
  const floor = lower > pass.start ? lower : pass.start
  const window = { from: floor.toISOString(), to: upper.toISOString() }

  const emails = users
    .filter(u => {
      if (!u.email) return false
      if (opts.emailFilter) return u.email.toLowerCase() === opts.emailFilter.toLowerCase()
      const created = new Date(u.created_at)
      return created > floor && created <= upper
    })
    .map(u => u.email!.toLowerCase())

  const empty: PassResult = {
    window, eligible: 0, sent: 0, skipped: 0, failed: 0, failures: [], stages: {},
  }
  if (emails.length === 0) return empty

  // Everyone who already had this one. This is the dedupe.
  const { data: already, error: logErr } = await supabase
    .from('email_log').select('email').eq('kind', pass.kind).in('email', emails)
  if (logErr) return { error: logErr.message }
  const done = new Set((already ?? []).map((r: { email: string }) => r.email))

  const { data: profiles } = await supabase
    .from('profiles')
    .select('email,nickname,unsubscribe_token,notifs_enabled,is_premium,premium_until')
    .in('email', emails)
  const profByEmail = new Map<string, Profile>(
    (profiles ?? []).map((p: Profile) => [p.email.toLowerCase(), p]))

  const extra = await pass.load(emails)

  const stages: Record<string, number> = {}
  const failures: { email: string; reason: string }[] = []
  let sent = 0
  let skipped = 0

  for (const email of emails) {
    if (done.has(email)) { skipped++; continue }

    const prof = profByEmail.get(email)
    // A rider with no profile row has never opened the app past sign-in. They
    // still get the welcome — that is exactly who onboarding is for — but there
    // is no nickname or unsubscribe token, and mailing without a working
    // opt-out is not acceptable, so skip rather than send a broken footer.
    if (!prof?.unsubscribe_token) {
      failures.push({ email, reason: 'no profile row / no unsubscribe token' })
      continue
    }
    // Unsubscribed riders have said what they want. Both of these are scheduled
    // marketing, not a notification they asked for, so both respect it.
    if (prof.notifs_enabled === false) { skipped++; continue }

    const nickname = prof.nickname || email.split('@')[0]
    const built = pass.build({ email, nickname, profile: prof }, extra)
    if ('skip' in built) { skipped++; continue }

    stages[built.stage] = (stages[built.stage] ?? 0) + 1

    if (opts.dryRun) { sent++; continue }

    const payload = {
      ...built.payload,
      unsubscribe_link: `${APP_BASE}unsubscribe.html?t=${prof.unsubscribe_token}`,
    }

    try {
      const res = await deliver(payload, { to: email, makeWebhookUrl: MAKE_WEBHOOK_URL })
      if (!res.ok) { failures.push({ email, reason: res.error ?? 'send failed' }); continue }
    } catch (e) {
      failures.push({ email, reason: String(e) })
      continue
    }

    // The log is the dedupe, so a failure to record means this rider would be
    // mailed again next hour. Surface it rather than reporting a clean run.
    if (!await recordEmail({ email, kind: pass.kind, meta: { stage: built.stage } })) {
      failures.push({ email, reason: 'sent but not recorded — may repeat next run' })
    }
    sent++
  }

  return {
    window,
    eligible: emails.length,
    sent, skipped,
    failed: failures.length,
    failures: failures.slice(0, 20),
    stages,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // Same gate as the broadcast: the anon key is public, and this mails people.
  if (!isServiceRoleCaller(req.headers, SUPABASE_SERVICE_KEY)) {
    return json({ error: 'Service-role key required' }, 401)
  }

  let dryRun = false
  let emailFilter: string | null = null
  let only: string | null = null
  try {
    const body = await req.json()
    dryRun      = body?.dry_run === true
    emailFilter = body?.email_filter ?? null
    // `{"only":"premium_pitch"}` runs a single pass — how a template change gets
    // checked against one address without also triggering the other email.
    only        = body?.only ?? null
  } catch { /* cron sends {} */ }

  if (only && !PASSES[only]) {
    return json({ error: `unknown pass "${only}" — expected ${Object.keys(PASSES).join(' | ')}` }, 400)
  }

  // auth.users is not exposed through PostgREST, so go through the admin API.
  // Read once and share it: both passes filter the same list by age.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return json({ error: listErr.message }, 500)
  const users = (list?.users ?? []) as { email?: string; created_at: string }[]

  const out: Record<string, unknown> = { dry_run: dryRun }
  for (const [name, pass] of Object.entries(PASSES)) {
    if (only && only !== name) continue
    const r = await runPass(pass, users, { dryRun, emailFilter })
    if ('error' in r) return json({ error: `${name}: ${r.error}` }, 500)
    out[name] = r
  }
  return json(out)
})

// One-shot "What's new" announcement broadcast.
//
// Unlike the recurring notifiers this is fired by hand, once, at everybody. Two
// consequences shape the whole function:
//
//   1. A half-finished run must be safe to re-run. Every delivery is recorded in
//      broadcast_sends and already-recorded recipients are skipped, so a retry
//      resumes instead of mailing the first N people a second time.
//   2. There is no second chance to get the copy right, so dry_run builds every
//      payload and returns a tier census without touching the webhook.
//
// Rendering happens in Make.com, which GETs emails/whats-new.html from main and
// runs a replace() chain over it. Anything conditional therefore has to arrive
// as prebuilt HTML that renders to nothing when it does not apply.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolveTier, buildPersonalHtml, buildYourSpotsHtml,
  type ProfileLike, type Tier,
} from './content.ts'
import { recordEmail } from '../_shared/email-log-client.ts'
import {
  clampDelay, clampBudget, budgetExhausted, estimateRuntimeMs, sleep,
} from '../_shared/pacing.ts'
import { isServiceRoleCaller } from '../_shared/service-role-auth.ts'
import { deliver } from '../_shared/mailer.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!
const MAKE_WEBHOOK_URL     = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const APP_BASE    = 'https://kiteforecast.app/'
// ?tab=profile is on the app's allowlist and opens the profile panel, which is
// where both the home-location field and the lifetime upgrade card live.
const PROFILE_URL = `${APP_BASE}?tab=profile`
const REPLY_TO    = 'hello@kiteforecast.app'

// Namespacing the campaign means a future announcement gets its own broadcast_sends
// rows rather than being suppressed by this one.
const DEFAULT_CAMPAIGN = 'whats-new-2026-08'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// content.ts deliberately knows nothing about unsubscribe tokens — it decides
// what a rider is told, not how they opt out — so the delivery column is added
// here rather than widening ProfileLike.
type Recipient = ProfileLike & { unsubscribe_token: string }

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

  // verify_jwt is not a gate here: the anon key is public and satisfies it, so
  // without this check anyone could mail all 25 riders — and pass a fresh
  // `campaign` each time to slip past the broadcast_sends de-duplication.
  // This function is operator-triggered, so it requires the service-role key.
  if (!isServiceRoleCaller(req.headers, SUPABASE_SERVICE_KEY)) {
    return json({ error: 'Service-role key required' }, 401)
  }

  let emailFilter: string | null = null
  let campaign = DEFAULT_CAMPAIGN
  let dryRun = false
  let delayMs = clampDelay(undefined)
  let budgetMs = clampBudget(undefined)
  try {
    const body = await req.json()
    emailFilter = body?.email_filter ?? null
    campaign    = body?.campaign ?? DEFAULT_CAMPAIGN
    dryRun      = body?.dry_run === true
    delayMs     = clampDelay(body?.delay_ms)
    budgetMs    = clampBudget(body?.budget_ms)
  } catch { /* no body — full live run */ }

  // Deliberately not filtered by notifs_enabled: this is a one-off announcement
  // to every registered rider, which is why it carries a working unsubscribe.
  let query = supabase.from('profiles')
    .select('email,nickname,is_premium,premium_until,contribution_points,unsubscribe_token')
  if (emailFilter) query = query.eq('email', emailFilter)
  const { data: profiles, error: profErr } = await query
  if (profErr) return json({ error: profErr.message }, 500)

  const recipients = profiles ?? []
  if (recipients.length === 0) return json({ sent: 0, skipped: 0, failed: 0, total: 0 })

  const emails = recipients.map((p: Recipient) => p.email)

  // Favourites power the "spots you watch" recap. One query for the whole run
  // rather than one per rider.
  const { data: favs, error: favErr } = await supabase
    .from('favourites').select('email,spot_name,spot_label').in('email', emails)
  if (favErr) return json({ error: favErr.message }, 500)

  const favsByEmail = new Map<string, { email: string; spot_name: string; spot_label?: string | null }[]>()
  for (const f of favs ?? []) {
    const list = favsByEmail.get(f.email) ?? []
    list.push(f)
    favsByEmail.set(f.email, list)
  }

  // Who already got this campaign. A re-run after a partial failure resumes here.
  const { data: already, error: sentErr } = await supabase
    .from('broadcast_sends').select('email').eq('campaign', campaign).in('email', emails)
  if (sentErr) return json({ error: sentErr.message }, 500)
  const alreadySent = new Set((already ?? []).map((r: { email: string }) => r.email))

  const now = new Date()
  const tiers: Record<Tier, number> = { lifetime: 0, earned_active: 0, earned_expired: 0, free: 0 }
  const failures: { email: string; reason: string }[] = []
  const startedAt = Date.now()
  let sent = 0
  let skipped = 0
  let deferred = 0

  for (const prof of recipients as Recipient[]) {
    const email = prof.email
    if (alreadySent.has(email)) { skipped++; continue }

    // Stop before starting work this run cannot finish and record. Anyone left
    // is picked up by the next invocation — broadcast_sends makes that a resume,
    // not a repeat.
    if (!dryRun && budgetExhausted(startedAt, Date.now(), budgetMs, delayMs)) {
      deferred++
      continue
    }

    const tier = resolveTier(prof, now)
    tiers[tier]++

    const payload = {
      notification_type: 'whats_new',
      campaign,
      email,
      // Make replaces [[nickname]] with this verbatim; the builders escape their
      // own copies, but this one is interpolated by Make, so escape it here.
      nickname: escapeHtml(prof.nickname || email.split('@')[0]),
      tier,
      app_link:         APP_BASE,
      home_setup_link:  PROFILE_URL,
      personal_html:    buildPersonalHtml(prof, { replyTo: REPLY_TO, upgradeUrl: PROFILE_URL, now }),
      your_spots_html:  buildYourSpotsHtml(favsByEmail.get(email) ?? [], APP_BASE),
      // Points at the static page, not the function: Supabase Edge Functions
      // rewrite text/html to text/plain, so the function can only serve JSON.
      unsubscribe_link: `${APP_BASE}unsubscribe.html?t=${prof.unsubscribe_token}`,
    }

    if (dryRun) { sent++; continue }

    // The gap is the whole point: without it Make starts every scenario run at
    // once and the mail module is throttled. Before the first send only, skip it.
    if (sent > 0) await sleep(delayMs)

    try {
      const res = await deliver(payload, { to: email, makeWebhookUrl: MAKE_WEBHOOK_URL })
      // weekly-digest ignores the webhook response. Here a swallowed failure
      // would be recorded as delivered and then skipped forever on re-run, so
      // the send is only recorded once Make has actually accepted it.
      if (!res.ok) {
        failures.push({ email, reason: res.error ?? 'send failed' })
        continue
      }
    } catch (e) {
      failures.push({ email, reason: String(e) })
      continue
    }

    // broadcast_sends is the dedupe ledger for *this* campaign; email_log is the
    // rider-facing history the admin panel reads. Both, deliberately: the first
    // must stay a tight (campaign, email) key, the second spans every email type.
    await recordEmail({ email, kind: 'whats_new', campaign, meta: { tier } })

    const { error: recErr } = await supabase
      .from('broadcast_sends').insert({ campaign, email })
    if (recErr) {
      // Delivered but unrecorded: a re-run would double-send this person, so
      // surface it loudly rather than letting it look like a clean run.
      console.error(`[whats-new] delivered to ${email} but failed to record:`, recErr.message)
      failures.push({ email, reason: `delivered-but-unrecorded: ${recErr.message}` })
    }
    sent++
  }

  return json({
    campaign,
    dry_run: dryRun,
    total: recipients.length,
    sent,
    skipped,
    // Non-zero means the run hit its time budget: re-invoke to continue.
    deferred,
    delay_ms: delayMs,
    elapsed_ms: Date.now() - startedAt,
    estimated_ms: estimateRuntimeMs(recipients.length - skipped, delayMs),
    failed: failures.length,
    failures: failures.slice(0, 20),
    tiers,
  })
})

// Only used for the [[nickname]] value Make interpolates; the HTML builders in
// content.ts escape everything they emit themselves.
function escapeHtml(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

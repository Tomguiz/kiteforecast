// Sending email without going through Make.com.
//
// Every email currently leaves through a Make scenario that sends from
// kiteforecast@outlook.com. That is a consumer Microsoft mailbox, and Microsoft
// suspends consumer accounts that send transactional mail in series — which is
// exactly what kept happening. It also means no SPF or DKIM aligned to a domain
// we control, so Gmail files the mail as spam or drops it silently: a "What's
// new" test reached Make, was accepted, and never arrived.
//
// Resend fixes both: a signed domain, and sending limits meant for this.
//
// Nothing switches over until RESEND_API_KEY is set. Until then mailerReady()
// is false and callers keep posting to Make exactly as before, so deploying
// this changes nothing on its own.

// Read lazily rather than at import. Reading Deno.env at module scope makes
// the pure rendering below impossible to unit-test off Deno, and it also freezes
// the value at import time — a secret set later in the process would be missed.
const env = (k: string): string | undefined => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k) }
  catch { return undefined }
}
const RESEND_API_KEY = () => env('RESEND_API_KEY')
// Must be a domain verified in Resend, or Resend refuses the send.
const MAIL_FROM  = () => env('MAIL_FROM')  ?? 'KiteForecast <hello@kiteforecast.app>'
// Replies land on the domain, not a personal inbox. Cloudflare Email Routing
// forwards the whole domain onward, so this is a real address, not a black hole.
const MAIL_REPLY = () => env('MAIL_REPLY') ?? 'hello@kiteforecast.app'

const TEMPLATE_BASE =
  'https://raw.githubusercontent.com/Tomguiz/kiteforecast/main/emails/'

export const mailerReady = (): boolean => !!RESEND_API_KEY()

// Templates are fetched from main rather than bundled, so a copy change still
// ships by merging — the same deploy story the Make scenario had. Cached for
// the lifetime of the invocation, since one run sends many of the same email.
const templateCache = new Map<string, string>()

export async function fetchTemplate(name: string): Promise<string> {
  const cached = templateCache.get(name)
  if (cached) return cached
  const res = await fetch(`${TEMPLATE_BASE}${name}.html`)
  if (!res.ok) throw new Error(`template ${name}: HTTP ${res.status}`)
  const html = await res.text()
  templateCache.set(name, html)
  return html
}

// Resolves "session.wind_speed_peak_kn" against the payload, because that is
// how the templates address nested values.
function resolvePath(vars: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object') ? (acc as Record<string, unknown>)[key] : undefined,
    vars,
  )
}

export type RenderResult = { html: string; missing: string[] }

// Mirrors what Make did: a flat substitution of every [[placeholder]], no
// conditionals. An unresolved placeholder becomes empty rather than shipping
// literal "[[spot]]" to a real inbox, and is reported so the caller can log it.
export function renderTemplate(
  template: string, vars: Record<string, unknown>,
): RenderResult {
  const missing: string[] = []
  const html = template.replace(/\[\[([a-zA-Z0-9_.]+)\]\]/g, (_m, path: string) => {
    const v = resolvePath(vars, path)
    if (v === undefined || v === null) { missing.push(path); return '' }
    return String(v)
  })
  return { html, missing }
}

// Subjects carry the same placeholders as the bodies.
export function renderSubject(subject: string, vars: Record<string, unknown>): string {
  return renderTemplate(subject, vars).html
}

// ── Which template and subject belong to each kind of email ───────────────
//
// One table rather than the same two lines repeated in ten functions. Both
// values are copied verbatim from the Make scenario that used to render them,
// so the switch is invisible in an inbox. Subjects carry [[placeholders]] and
// go through the same renderer as the body.
//
// A `to` function says which field of the payload holds the recipient, because
// the notifications do not agree: some mail the rider, some mail the admin.
export type Delivery = {
  template: string
  subject: string
  to?: (p: Record<string, any>) => string | undefined
}

export const DELIVERIES: Record<string, Delivery> = {
  digest:                 { template: 'digest',            subject: '\u{1FA81} Your kite week \u2014 [[week_start]]' },
  whats_new:              { template: 'whats-new',         subject: '\u{1F381} More days on the water - what\'s new in KiteForecast' },
  friend_request:         { template: 'friend-request',    subject: '[[requester_nickname]] wants to kite with you \u{1FA81}' },
  session_attendance:     { template: 'session-attendance', subject: '\u{1F3C4} [[attendee_nickname]] is going kiting at [[spot_name]]!' },
  claim:                  { template: 'spot-claim',        subject: '\u{1F3F4} New spot claim \u2014 [[spot_name]]' },
  claim_accepted:         { template: 'claim-accepted',    subject: '\u{1F389} Your spot claim has been accepted \u2014 [[spot_name]]' },
  spot_suggestion:        { template: 'spot-request',      subject: '\u{1FA81} New spot request \u2014 [[spot_name]]' },
  spot_update:            { template: 'spot-update',       subject: '\u270D\uFE0F New spot update by the community \u2014 [[spot_name]]' },
  spot_request_approved:  { template: 'claim-accepted',    subject: '\u{1F389} Your spot request has been approved \u2014 [[spot_name]]' },
  onboarding:             { template: 'onboarding',        subject: 'Welcome to KiteForecast \u{1FA81}' },
  // Two weeks after signup, and the only email that sells. Separate kind from
  // 'onboarding' so email_log dedupes them independently.
  premium_pitch:          { template: 'premium-pitch',    subject: 'The half of KiteForecast you haven\'t used yet \u{1F451}' },
}

// Reminders pick their template from the ladder step and whether the session is
// on, so they are resolved separately rather than by notification_type.
export function reminderDelivery(hours: number, isOn: boolean): Delivery {
  const key = `${isOn ? 'ON' : 'OFF'}${hours}`
  const subjects: Record<string, string> = {
    ON24:  '\u{1F514} Tomorrow at [[spot]] \u2014 conditions confirmed, [[session.wind_speed_peak_kn]] kts [[session.wind_direction]]',
    OFF24: '\u{1F62E}\u200D\u{1F4A8} [[spot]] tomorrow \u2014 the wind gods aren\'t cooperating',
  }
  return { template: `reminder${key}`, subject: subjects[key] ?? '[[spot]] \u2014 [[date_label]]' }
}

export type SendResult = { ok: boolean; id?: string; error?: string }

export async function sendEmail(args: {
  to: string; subject: string; html: string; replyTo?: string;
}): Promise<SendResult> {
  const key = RESEND_API_KEY()
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM(),
        to: [args.to],
        subject: args.subject,
        html: args.html,
        reply_to: args.replyTo ?? MAIL_REPLY(),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}` }
    return { ok: true, id: body?.id }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

// One call for the common case: pick a template, fill it, send it.
export async function sendTemplate(args: {
  to: string; template: string; subject: string; vars: Record<string, unknown>; replyTo?: string;
}): Promise<SendResult> {
  const tpl = await fetchTemplate(args.template)
  const { html, missing } = renderTemplate(tpl, args.vars)
  if (missing.length) {
    // Not fatal — a template that gained a placeholder before the sender did
    // should still deliver, minus that value.
    console.warn(`[mailer] ${args.template}: unfilled ${[...new Set(missing)].join(', ')}`)
  }
  return await sendEmail({
    to: args.to,
    subject: renderSubject(args.subject, args.vars),
    html,
    replyTo: args.replyTo,
  })
}


// The single door every notifier goes through. Resend once the key is set,
// Make until then — so a deploy changes nothing on its own, and clearing the
// secret rolls every email type back at once.
export async function deliver(
  payload: Record<string, any>,
  opts: { to?: string; delivery?: Delivery; makeWebhookUrl: string },
): Promise<{ ok: boolean; via: 'resend' | 'make'; error?: string }> {
  const kind = String(payload?.notification_type ?? '')
  const d = opts.delivery ?? DELIVERIES[kind]

  if (mailerReady() && d) {
    const to = opts.to ?? d.to?.(payload) ?? payload.email
    if (!to) return { ok: false, via: 'resend', error: `no recipient for ${kind}` }
    const r = await sendTemplate({ to, template: d.template, subject: d.subject, vars: payload })
    return { ok: r.ok, via: 'resend', error: r.error }
  }

  // Either no key yet, or a kind with no mapping — Make still knows how to
  // render it, so falling back is safer than dropping the email.
  try {
    const res = await fetch(opts.makeWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { ok: res.ok, via: 'make', error: res.ok ? undefined : `webhook ${res.status}` }
  } catch (err) {
    return { ok: false, via: 'make', error: String(err) }
  }
}

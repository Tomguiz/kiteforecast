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
const MAIL_REPLY = () => env('MAIL_REPLY') ?? 'tom.guisgand@gmail.com'

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

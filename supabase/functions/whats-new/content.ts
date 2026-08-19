// Personalised blocks for the "What's new" announcement.
//
// Pure string builders, no network and no Supabase client, so the tier rules
// that decide what a paying customer sees can be tested directly rather than
// inferred from a sent email.

export type Tier = 'lifetime' | 'earned_active' | 'earned_expired' | 'free'

// Mirrors the in-app checkout button ("Get Lifetime Access — €19.99"). Naming
// the price in the upsell beats "upgrade" — the whole pitch is that it is one
// small payment rather than a subscription, and that only lands if it's a number.
export const LIFETIME_PRICE = '&euro;19.99'

export interface ProfileLike {
  email: string
  nickname?: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  contribution_points?: number | null
}

export interface FavouriteLike {
  email: string
  spot_name: string
  spot_label?: string | null
}

// Nicknames, spot labels and home labels are all user-supplied and land inside
// email HTML. Same escaping as weekly-digest.
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/**
 * Which variant of the announcement someone gets.
 *
 * `is_premium` is checked first and returns immediately. Premium is a one-time
 * payment (stripe-checkout uses mode:'payment'), so it never lapses — and a
 * lifetime customer who has also earned contribution points must be greeted as
 * a customer, not as a contributor working off a free month. Ordering these the
 * other way round would downgrade exactly the people we least want to downgrade.
 */
export function resolveTier(p: ProfileLike, now: Date = new Date()): Tier {
  if (p.is_premium) return 'lifetime'
  if (!p.premium_until) return 'free'
  const until = new Date(p.premium_until)
  if (Number.isNaN(until.getTime())) return 'free'
  return until > now ? 'earned_active' : 'earned_expired'
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000))

// Points are awarded 5 at a time and every 5 buys a month, so this is the same
// arithmetic the admin panel runs when it approves a spot update.
const monthsEarned = (points: number) => Math.floor(points / 5)

const row = (inner: string) => `
    <tr>
      <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:24px 32px;">
${inner}
      </td>
    </tr>`

const pointsLine = (points: number, color: string) => {
  if (points <= 0) return ''
  const months = monthsEarned(points)
  const earned = months > 0
    ? ` &mdash; ${months} free ${months === 1 ? 'month' : 'months'} earned`
    : ''
  return `
        <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:12px 0 0 0;font-size:12.5px;line-height:1.6;color:${color};">&#127894; <strong>${points} contribution ${points === 1 ? 'point' : 'points'}</strong>${earned}. Thanks for keeping the spot data honest.</p>`
}

/**
 * Lifetime customers. Gold rather than the email's usual cyan, a direct
 * thank-you, and a reply button addressed to them specifically.
 *
 * The button is a mailto: rather than a form — it opens their own mail client
 * with the reply already addressed, which is both the least friction and the
 * most personal thing an HTML email can actually do.
 */
export function buildLifetimeHtml(p: ProfileLike, replyTo: string): string {
  const name = escapeHtml(p.nickname || p.email.split('@')[0])
  const subject = encodeURIComponent('My KiteForecast wishlist')
  const body = encodeURIComponent(
    `Hi,\n\nHere's what would make KiteForecast better for me:\n\n\n` +
    `— ${p.nickname || p.email}`,
  )
  return row(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.35);border-radius:10px;">
          <tr>
            <td style="padding:20px 22px;">
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;color:#eab308;">&#11088; LIFETIME MEMBER</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 10px 0;font-size:16px;font-weight:700;line-height:1.35;color:#ffffff;">${name}, you paid for this before it was good.</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0;font-size:13.5px;line-height:1.65;color:#c8b273;">Everything below exists because a handful of people backed KiteForecast early &mdash; you're one of them, and your access never expires. So before the feature tour: thank you. Genuinely.</p>${pointsLine(p.contribution_points ?? 0, '#c8b273')}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="background:rgba(234,179,8,.16);border:1px solid rgba(234,179,8,.45);border-radius:9px;">
                    <a href="mailto:${escapeHtml(replyTo)}?subject=${subject}&amp;body=${body}" style="display:inline-block;padding:11px 20px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:13.5px;font-weight:600;color:#eab308;text-decoration:none;">&#9993;&#65039; Tell me what to build next &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:9px 0 0 0;font-size:11.5px;line-height:1.5;color:#8a7c52;">This one comes straight to me, and lifetime members get answered first.</p>
            </td>
          </tr>
        </table>`)
}

/** Someone currently riding a free month earned with contribution points. */
export function buildEarnedActiveHtml(p: ProfileLike, upgradeUrl: string, now: Date = new Date()): string {
  const name = escapeHtml(p.nickname || p.email.split('@')[0])
  const until = p.premium_until ? new Date(p.premium_until) : null
  const when = p.premium_until ? fmtDate(p.premium_until) : ''
  const left = until ? daysBetween(now, until) : 0
  return row(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(93,212,240,.08);border:1px solid rgba(93,212,240,.35);border-radius:10px;">
          <tr>
            <td style="padding:20px 22px;">
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;color:#5dd4f0;">&#127775; PREMIUM, ON THE HOUSE</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 10px 0;font-size:16px;font-weight:700;line-height:1.35;color:#ffffff;">${name}, you earned your premium.</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0;font-size:13.5px;line-height:1.65;color:#9fc9d8;">You fixed spot data other riders rely on, and premium is on us because of it. Everything new below is already unlocked for you.</p>${pointsLine(p.contribution_points ?? 0, '#9fc9d8')}
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#ffffff;">Your free access runs until <strong>${when}</strong> &mdash; ${left} ${left === 1 ? 'day' : 'days'} from today.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="background:rgba(93,212,240,.16);border:1px solid rgba(93,212,240,.45);border-radius:9px;">
                    <a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:13.5px;font-weight:600;color:#5dd4f0;text-decoration:none;">&#128274; Pay once, keep it for life &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:9px 0 0 0;font-size:11.5px;line-height:1.5;color:#6f8b99;">${LIFETIME_PRICE} once, no subscription, no renewal date to remember. Or keep earning months &mdash; both work.</p>
            </td>
          </tr>
        </table>`)
}

/** Contributors whose earned month has already lapsed. */
export function buildEarnedExpiredHtml(p: ProfileLike, upgradeUrl: string): string {
  const name = escapeHtml(p.nickname || p.email.split('@')[0])
  const when = p.premium_until ? fmtDate(p.premium_until) : ''
  const ended = when ? ` Your free access ended on <strong>${when}</strong>.` : ''
  return row(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.28);border-radius:10px;">
          <tr>
            <td style="padding:20px 22px;">
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;color:#fb923c;">&#128296; CONTRIBUTOR</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 10px 0;font-size:16px;font-weight:700;line-height:1.35;color:#ffffff;">${name}, your corrections are still in there.</p>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0;font-size:13.5px;line-height:1.65;color:#c2a184;">Every rider who checks one of the spots you fixed gets the right answer because you took the time.${ended}</p>${pointsLine(p.contribution_points ?? 0, '#c2a184')}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="background:rgba(249,115,22,.16);border:1px solid rgba(249,115,22,.45);border-radius:9px;">
                    <a href="${escapeHtml(upgradeUrl)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:13.5px;font-weight:600;color:#fb923c;text-decoration:none;">&#128274; Pay once, get lifetime access &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:9px 0 0 0;font-size:11.5px;line-height:1.5;color:#997a61;">${LIFETIME_PRICE} once, never again &mdash; no subscription. Or earn another month: 5 more points does it.</p>
            </td>
          </tr>
        </table>`)
}

/**
 * The block that goes where [[personal_html]] sits. Free users get an empty
 * string: Make has no conditional logic, so "no block" has to render as
 * literally nothing rather than as a hidden element.
 */
export function buildPersonalHtml(
  p: ProfileLike,
  opts: { replyTo: string; upgradeUrl: string; now?: Date },
): string {
  const now = opts.now ?? new Date()
  switch (resolveTier(p, now)) {
    case 'lifetime':       return buildLifetimeHtml(p, opts.replyTo)
    case 'earned_active':  return buildEarnedActiveHtml(p, opts.upgradeUrl, now)
    case 'earned_expired': return buildEarnedExpiredHtml(p, opts.upgradeUrl)
    default:               return ''
  }
}

/**
 * "The spots you're watching" recap. Empty string when they have none — the
 * email's own CTA already covers that case, and an empty card reads as a bug.
 */
export function buildYourSpotsHtml(favourites: FavouriteLike[], appLink: string): string {
  const names = favourites
    .map(f => String(f.spot_label || f.spot_name || '').trim())
    .filter(Boolean)
  if (names.length === 0) return ''

  const chips = names.map(n => `
                  <td style="padding:0 6px 6px 0;"><span style="display:inline-block;background:#0d131d;border:1px solid #1e2535;border-radius:99px;padding:5px 12px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:12px;color:#aab7c6;white-space:nowrap;">${escapeHtml(n)}</span></td>`).join('')

  return row(`
        <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 12px 0;font-size:13px;font-weight:700;color:#ffffff;">&#128278; ${names.length === 1 ? 'The spot you watch' : `The ${names.length} spots you watch`} &mdash; all of this applies to ${names.length === 1 ? 'it' : 'them'}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${chips}</tr></table>
        <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:12px 0 0 0;font-size:12px;line-height:1.6;color:#8494a6;"><a href="${escapeHtml(appLink)}" style="color:#5dd4f0;text-decoration:none;">Add another spot &rarr;</a></p>`)
}

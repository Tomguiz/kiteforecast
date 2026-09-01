// Personalised opening block for the premium email, two weeks after signup.
//
// By day 14 a rider has shown what they actually use the app for, and that is
// the whole reason this email is not one generic pitch. Somebody who added
// friends cares about a different premium feature than somebody who quietly
// sets alerts alone — leading with the wrong one wastes the only paid email
// they will get.
//
// Same shape as content.ts: pure string builders, no network, no Supabase
// client, so every branch can be tested directly.

export type PremiumStage = 'has_friends' | 'active_alerts' | 'default'

export interface PremiumState {
  reminderCount: number
  friendCount: number
}

export interface PremiumLinks {
  app: string
  /** Profile panel — where the upgrade card and checkout button live. */
  upgrade: string
}

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/**
 * Which premium feature to lead with.
 *
 * Ordered by how specific the signal is, not by what earns most. Friends are
 * the strongest tell — you only add riders you actually ride with, and the one
 * thing you then cannot do for free is tell them you're going. Alerts are the
 * next best: a rider setting them one session at a time is doing by hand what
 * the Monday digest does in one email. With neither signal there is nothing to
 * infer, so fall back to the limit every free account eventually meets.
 */
export function resolvePremiumStage(state: PremiumState): PremiumStage {
  const friends = Math.max(0, Number(state?.friendCount) || 0)
  const rems    = Math.max(0, Number(state?.reminderCount) || 0)
  if (friends > 0) return 'has_friends'
  if (rems > 0)    return 'active_alerts'
  return 'default'
}

const row = (inner: string) => `
    <tr>
      <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:24px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(234,179,8,.07);border:1px solid rgba(234,179,8,.30);border-radius:10px;">
          <tr>
            <td style="padding:20px 22px;">
${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>`

const label = (text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;color:#eab308;">${text}</p>`

const heading = (text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 10px 0;font-size:16px;font-weight:700;line-height:1.35;color:#ffffff;">${text}</p>`

const body = (text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0;font-size:13.5px;line-height:1.65;color:#c8b273;">${text}</p>`

const button = (href: string, text: string) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="background:rgba(234,179,8,.16);border:1px solid rgba(234,179,8,.45);border-radius:9px;">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:13.5px;font-weight:600;color:#eab308;text-decoration:none;">${text}</a>
                  </td>
                </tr>
              </table>`

/**
 * The block that fills [[hook_html]].
 *
 * Every stage renders something. Each one names what the rider already did,
 * then the single thing the free plan will not let them do next — one feature,
 * not a list. The full list is the body of the email underneath.
 */
export function buildPremiumHookHtml(
  state: PremiumState,
  links: PremiumLinks,
  name: string,
): string {
  const who = escapeHtml(name)

  switch (resolvePremiumStage(state)) {
    case 'has_friends': {
      const n = Math.max(0, Number(state?.friendCount) || 0)
      const who_much = n === 1 ? 'a rider' : `${n} riders`
      return row(
        label('&#127940; THE ONE THING YOU CAN\'T DO YET') +
        heading(`${who}, you've added ${who_much} &mdash; but they can't see you're going.`) +
        body('You can see when <em>they</em> commit to a session. They cannot see you &mdash; that direction is the premium half. Riders who turn it on stop organising sessions in a group chat altogether: the app tells the right people, and the difference between two of you showing up and six is usually just that nobody knew.') +
        button(links.upgrade, '&#11088; Unlock it &mdash; &euro;19.99 once &rarr;'))
    }

    case 'active_alerts': {
      const n = Math.max(0, Number(state?.reminderCount) || 0)
      const so_far = n === 1 ? 'set an alert' : `set ${n} alerts`
      return row(
        label('&#128236; YOU\'RE DOING THIS ONE DAY AT A TIME') +
        heading(`${who}, you've ${so_far} &mdash; the digest does the whole week at once.`) +
        body('Alerts are reactive by nature &mdash; you find a session, then ask to be reminded about it, which means you only ever plan as far ahead as you happened to look. The Monday digest inverts that. The week reaches you before you have gone looking, so the day worth taking off is on your radar on Monday rather than the night before.') +
        button(links.upgrade, '&#11088; Get the Monday digest &rarr;'))
    }

    default:
      // Leads with the planner rather than the spot cap: it is now the limit a
      // free rider actually runs into, because the button is right there on the
      // home screen with a padlock on it. An email that explains something they
      // have already seen beats one introducing an abstraction.
      return row(
        label('&#128274; THE BUTTON YOU CAN\'T PRESS') +
        heading(`${who}, "Where to ride?" answers the only question that matters.`) +
        body('Tell it how far you\'ll drive and which days you\'re free, and it checks every spot in range against your kite, your level and your weight &mdash; then ranks them by whether the session is worth the drive. It is the difference between reading seven forecasts and being told where to go. Premium also lifts the one-spot cap, because the forecast that matters is rarely at the same beach twice.') +
        button(links.upgrade, '&#11088; Unlock the planner &mdash; &euro;19.99 once &rarr;'))
  }
}

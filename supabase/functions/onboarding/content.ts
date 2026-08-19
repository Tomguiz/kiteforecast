// Personalised "next step" block for the onboarding email.
//
// The email lands 24 hours after signup, by which point riders have diverged:
// some added a spot and set an alert, some signed up and never came back. A
// single generic "here's how to start" would be wrong for half of them, so the
// opening block adapts to what they have actually done.
//
// Pure string builders — no network, no Supabase client — so the branching can
// be tested directly.

export type OnboardingStage = 'no_spot' | 'no_reminders' | 'ready'

export interface OnboardingState {
  favCount: number
  reminderCount: number
  favNames?: string[]
}

export interface OnboardingLinks {
  app: string
  /** Profile panel — where the home-location field and upgrade card live. */
  profile: string
  /** Notification settings tab. */
  notifs: string
}

export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/**
 * Where the rider got to in their first day.
 *
 * Deliberately ordered by what blocks the next action: without a spot nothing
 * else matters, and without a reminder the app only works when they remember to
 * open it. Only once both exist is there anything else worth suggesting.
 */
export function resolveStage(state: OnboardingState): OnboardingStage {
  const favs = Math.max(0, Number(state?.favCount) || 0)
  const rems = Math.max(0, Number(state?.reminderCount) || 0)
  if (favs === 0) return 'no_spot'
  if (rems === 0) return 'no_reminders'
  return 'ready'
}

const row = (bg: string, border: string, inner: string) => `
    <tr>
      <td style="background-color:#141b27;border-left:1px solid #1e2535;border-right:1px solid #1e2535;border-top:1px solid #1e2535;padding:24px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:10px;">
          <tr>
            <td style="padding:20px 22px;">
${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>`

const label = (color: string, text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1.6px;color:${color};">${text}</p>`

const heading = (text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0 0 10px 0;font-size:16px;font-weight:700;line-height:1.35;color:#ffffff;">${text}</p>`

const body = (color: string, text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:0;font-size:13.5px;line-height:1.65;color:${color};">${text}</p>`

const button = (href: string, bg: string, border: string, color: string, text: string) => `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="background:${bg};border:1px solid ${border};border-radius:9px;">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;font-size:13.5px;font-weight:600;color:${color};text-decoration:none;">${text}</a>
                  </td>
                </tr>
              </table>`

const footnote = (color: string, text: string) => `
              <p style="font-family:'Poppins','Trebuchet MS',Verdana,sans-serif;margin:9px 0 0 0;font-size:11.5px;line-height:1.5;color:${color};">${text}</p>`

/**
 * The block that fills [[next_step_html]].
 *
 * Every stage renders something — unlike the what's-new email there is no empty
 * case, because a rider one day in always has a sensible next action.
 */
export function buildNextStepHtml(
  state: OnboardingState,
  links: OnboardingLinks,
  name: string,
): string {
  const who = escapeHtml(name)

  switch (resolveStage(state)) {
    case 'no_spot':
      return row('rgba(93,212,240,.10)', 'rgba(93,212,240,.35)',
        label('#5dd4f0', '&#128205; START HERE') +
        heading(`${who}, pick your spot &mdash; it takes about a minute.`) +
        body('#9fc9d8', 'Everything else in KiteForecast hangs off this one step. Search for where you ride, save it, and tell us which wind directions actually work there. From then on the forecast is about <em>your</em> spot, not a generic coastline.') +
        button(links.app, 'rgba(93,212,240,.16)', 'rgba(93,212,240,.45)', '#5dd4f0', '&#11088; Add my spot &rarr;') +
        footnote('#6f8b99', 'The free plan covers one spot &mdash; that\'s the whole core of the app, no trial, no timer.'))

    case 'no_reminders': {
      const names = (state.favNames ?? []).map(n => escapeHtml(n)).filter(Boolean)
      const watching = names.length === 1
        ? `You've got <strong style="color:#ffffff;">${names[0]}</strong> saved.`
        : names.length > 1
          ? `You've got <strong style="color:#ffffff;">${names.slice(0, 3).join(', ')}</strong> saved.`
          : 'You\'ve got your spot saved.'
      return row('rgba(93,212,240,.10)', 'rgba(93,212,240,.35)',
        label('#5dd4f0', '&#128276; ONE MORE STEP') +
        heading(`${who}, now let it come to you.`) +
        body('#9fc9d8', `${watching} The bit most people miss is the alert: pick a session on the forecast and KiteForecast emails you before it, up to three days ahead and again an hour before you'd leave. That way you stop having to remember to check.`) +
        button(links.app, 'rgba(93,212,240,.16)', 'rgba(93,212,240,.45)', '#5dd4f0', '&#128276; Set my first alert &rarr;') +
        footnote('#6f8b99', 'Free, and you choose the timing &mdash; 72h, 48h, 24h, 6h or 1h before.'))
    }

    default:
      return row('rgba(34,197,94,.09)', 'rgba(34,197,94,.30)',
        label('#4ade80', '&#9989; YOU\'RE SET UP') +
        heading(`${who}, you've got the hang of this already.`) +
        body('#a7c9b4', 'Spot saved, alert set &mdash; that\'s the loop that matters, and it now runs without you. The rest of this email is the stuff riders usually find weeks later, so it\'s worth two minutes now.') +
        button(links.profile, 'rgba(34,197,94,.16)', 'rgba(34,197,94,.40)', '#4ade80', '&#127968; Add my home location &rarr;') +
        footnote('#7f9d8c', 'Ten seconds, and your weekly email starts including good spots near you that aren\'t on your list.'))
  }
}

// Where a reminder email's "Manage this alert" button points. The app reads
// spot+date off the query string, opens the notifications tab, expands that
// spot's card and highlights that day's row — see the ?tab= handler in
// index.html, which captures these two params before it strips the query.
//
// reminders.app_link is nullable and rows predating it exist, so the base URL
// is derived defensively rather than assumed: take everything before the '?'
// of app_link, or fall back to the production origin.
const FALLBACK_BASE = 'https://kiteforecast.app/'

// Make.com injects this value with a raw replace() — no escaping anywhere in
// the chain — so the result has to be safe in an HTML attribute on its own,
// whichever quote style the template uses. encodeURIComponent leaves ' unescaped
// (it is unreserved, along with !~*()), and ' is the one survivor that can close
// an attribute. Spot names are user-supplied via spot suggestions, so this is a
// real input, not a hypothetical.
const encodeParam = (v: string) => encodeURIComponent(v).replace(/'/g, '%27')

export function buildManageLink(
  appLink: string | null | undefined,
  spotName: string,
  sessionDate: string,
): string {
  const base = (appLink ?? '').split('?')[0].trim() || FALLBACK_BASE
  const q = `tab=notifs&spot=${encodeParam(spotName)}&date=${encodeParam(sessionDate)}`
  return `${base}?${q}`
}

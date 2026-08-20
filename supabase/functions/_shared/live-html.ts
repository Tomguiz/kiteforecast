import type { LiveWind } from './rws.ts'

// stationName is the one genuinely untrusted value in this payload: it comes
// from a third-party feed via cleanName(), which does no sanitisation. Every
// other interpolation below is a generated numeral or a literal from this file.
export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// The app marks live content with a blinking red dot (.webcam-dot, #ff6b6b).
// Email can't blink — Gmail strips @keyframes — so the badge carries the signal
// statically instead. The fill is darkened from the app's #ff6b6b because white
// on #ff6b6b is ~2.9:1, unreadable at 9px bold; #dc2626 is 4.8:1. Outlook on
// Windows drops the border-radius and renders a square tag, which still reads.
const LIVE_BADGE =
  '<span style="display:inline-block;vertical-align:middle;background-color:#dc2626;' +
  'color:#ffffff;font-size:9px;font-weight:700;letter-spacing:1.5px;padding:3px 7px;' +
  'border-radius:3px;margin-right:8px;">&#9679; LIVE</span>'

// Rendered server-side and injected whole, because the Make.com template is a
// flat replace() chain with no conditional logic — an empty string here makes
// the block vanish. See docs/superpowers/specs/2026-08-16-rws-live-wind-design.md
//
// The label is deliberately neutral: this same block renders inside the SESSION
// OFF 1h email too ("the wind never showed"), where "Measured right now — 22 kn"
// would read as a self-contradiction. One label serves both, no ON/OFF branch —
// and the LIVE badge keeps that property, since it dates the reading rather
// than passing a verdict on it.
export function renderLiveHtml(live: LiveWind): string {
  const gust = live.gustKn === null ? '' : ` &middot; gusts ${live.gustKn} kn`
  // The exact degree, not an 8-point compass letter. A letter hides where the
  // wind sits inside its 45-degree sector, which is precisely what decides
  // whether the spot's direction rule matches — the app shows degrees for the
  // same reason (WIND_DIR_TOLERANCE_DEG is 30, so "W" spans both sides of the
  // threshold). &deg; rather than a literal ° for older mail clients.
  const dir  = live.dirDeg === null ? '' : ` ${Math.round(live.dirDeg)}&deg;`
  const age  = live.ageMin <= 1 ? 'just now' : `${live.ageMin} min ago`
  return `<tr>
          <td style="background-color:#0f1520;border:1px solid #1e2535;border-top:none;padding:16px 32px;">
            <p style="margin:0 0 10px 0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4a5568;">${LIVE_BADGE}<span style="vertical-align:middle;">&#127788; Current reading at the nearest mast</span></p>
            <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;font-size:22px;font-weight:700;color:#5dd4f0;">${live.speedKn} kn${dir}${gust}</p>
            <p style="margin:6px 0 0 0;font-size:11px;color:#4a5568;">${escHtml(live.stationName)} &middot; ${live.distanceKm.toFixed(1)} km away &middot; ${age}</p>
          </td>
        </tr>`
}

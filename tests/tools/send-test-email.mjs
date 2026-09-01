#!/usr/bin/env node
// Fires ONE reminder payload at the Make.com webhook, addressed to a single
// recipient you name, so a template change can be checked in a real inbox
// before it goes to the community.
//
//   node tests/tools/send-test-email.mjs --email you@example.com --template ON24 --yes
//
// Refuses to run without --email and --yes. One recipient per run, by design:
// this posts to the live production webhook, and the scenario mails whatever
// address it is handed.
//
// IMPORTANT — Make.com GETs the template from `main` at send time, so by
// default this previews what main already has, NOT your branch. To stage a
// branch, temporarily repoint that route's template URL:
//   https://raw.githubusercontent.com/Tomguiz/kiteforecast/<branch>/emails/reminderON24.html
// and set it back to main afterwards.
const WEBHOOK = 'https://hook.eu1.make.com/6t9fgm6btixri2wf5lnx47requf416vs'

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null }
const email = arg('email')
const tpl = (arg('template') ?? 'ON24').toUpperCase()
const confirmed = process.argv.includes('--yes')

if (!email || !email.includes('@')) {
  console.error('refusing: pass a single recipient, e.g. --email you@example.com')
  process.exit(2)
}
const m = tpl.match(/^(ON|OFF)(1|6|24|48|72)$/)
if (!m) {
  console.error(`refusing: --template must be ON|OFF + 1|6|24|48|72 (got ${tpl})`)
  process.exit(2)
}
const [, onOff, hours] = m
const rh = Number(hours)

const date = new Date(Date.now() + rh * 3600 * 1000)
const dateStr = date.toISOString().slice(0, 10)
const base = 'https://kiteforecast.app/'

// The Make.com scenario de-duplicates against a Google Sheet, matching on
// email + spot + date_label + reminder_label all at once. reminder_label only
// encodes the hour, so two runs at the same --template — even ON then OFF —
// collide on all four and the second is silently suppressed as a duplicate.
// A per-run token in the spot name keeps every send distinct.
const token = Math.random().toString(36).slice(2, 6).toUpperCase()
const spot = `TEST ${tpl} ${token} — ignore this email`

// ON vs OFF is NOT a payload field — notif_type only ever carries 'spot' or
// 'day'. The Make.com router branches on session.rating CONTAINING ✅ or ❌,
// and rateDay() in process-reminders always prefixes one or the other. A
// rating without the emoji matches neither route, so the bundle is logged to
// the sheet and then silently dropped with no email sent and no error — which
// is indistinguishable from "the mail did not arrive". Keep these strings in
// the shape rateDay() actually emits.
const dead = onOff === 'OFF'

const payload = {
  notification_type: 'spot',
  reminder_label: rh === 1 ? '1 hour before' : `${rh} hours before`,
  email,
  spot,
  spot_city: 'Cadzand',
  spot_country: 'Netherlands',
  spot_map_link: 'https://www.google.com/maps?q=51.37,3.37',
  date: dateStr,
  day_of_week: date.toLocaleDateString('en', { weekday: 'long' }),
  date_label: date.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  app_link: `${base}?spot=${encodeURIComponent(spot)}&date=${dateStr}`,
  manage_link: `${base}?tab=notifs&spot=${encodeURIComponent(spot)}&date=${dateStr}`,
  calendar_html: '',
  live_html: '',
  session: dead ? {
    start_time: `${dateStr}T11:00`, end_time: '',
    start_time_formatted: '11:00', end_time_formatted: '',
    duration_hours: 0, wind_speed_peak_kn: 12, wind_speed_min_kn: 5,
    wind_gusts_kn: 15, wind_direction: 'SE', wind_consistency_pct: 18,
    rating: '❌ Too light',
  } : {
    start_time: `${dateStr}T11:00`, end_time: `${dateStr}T16:00`,
    start_time_formatted: '11:00', end_time_formatted: '16:00',
    duration_hours: 5, wind_speed_peak_kn: 24, wind_speed_min_kn: 17,
    wind_gusts_kn: 29, wind_direction: 'SW', wind_consistency_pct: 82,
    rating: '✅ 5h · Very Good',
  },
  conditions: {
    weather: 'Partly cloudy', temperature_max_c: 23, temperature_min_c: 16,
    sunrise: '06:41', sunset: '20:58', daylight_hours: 14,
  },
  user_good_wind_dirs: ['SW', 'W', 'NW'],
}

console.log(`template : reminder${tpl} (the scenario picks ON/OFF from the session figures)`)
console.log(`spot     : ${spot}`)
console.log(`recipient: ${email}   (1 recipient)`)
console.log(`webhook  : ${WEBHOOK}`)

if (!confirmed) {
  console.log('\ndry run — nothing sent. Re-run with --yes to send.')
  process.exit(0)
}

const res = await fetch(WEBHOOK, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
console.log(`\n${res.status} ${res.statusText} — ${await res.text()}`)

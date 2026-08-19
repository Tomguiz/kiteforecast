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
const base = 'https://tomguiz.github.io/kiteforecast/'
const spot = 'TEST — ignore this email'

const payload = {
  notification_type: onOff === 'ON' ? 'spot' : 'session_off',
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
  session: {
    start_time: `${dateStr}T11:00`, end_time: `${dateStr}T16:00`,
    start_time_formatted: '11:00', end_time_formatted: '16:00',
    duration_hours: 5, wind_speed_peak_kn: 24, wind_speed_min_kn: 17,
    wind_gusts_kn: 29, wind_direction: 'SW', wind_consistency_pct: 82,
    rating: 'Strong',
  },
  conditions: {
    weather: 'Partly cloudy', temperature_max_c: 23, temperature_min_c: 16,
    sunrise: '06:41', sunset: '20:58', daylight_hours: 14,
  },
  user_good_wind_dirs: ['SW', 'W', 'NW'],
}

console.log(`template : reminder${tpl}`)
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

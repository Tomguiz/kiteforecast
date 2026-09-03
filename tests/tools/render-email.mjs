#!/usr/bin/env node
// Renders an emails/*.html template against a payload the way Make.com does:
// a flat replace() of every [[placeholder]], no conditionals. Lets a template
// change be eyeballed BEFORE it reaches main — which matters because Make.com
// GETs these templates from main at send time, so merging IS the deploy.
//
//   node tests/tools/render-email.mjs reminderON24 > out.html
//   node tests/tools/render-email.mjs --all --out /tmp/preview
//
// Exits non-zero if the payload leaves any [[placeholder]] unfilled — the exact
// failure that ships literal markup to real inboxes.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EMAILS = join(ROOT, 'emails')

// Mirrors the process-reminders payload. Values are obviously fake on purpose:
// a preview that looks like real data invites shipping it as real data.
const SAMPLE = {
  reminder_label: '24 hours before',
  spot: 'Rivierwoods Beachclub',
  spot_city: 'Cadzand',
  spot_country: 'Netherlands',
  spot_map_link: 'https://www.google.com/maps?q=51.37,3.37',
  date_label: 'Saturday, August 22, 2026',
  app_link: 'https://kiteforecast.app/?spot=Rivierwoods&date=2026-08-22',
  manage_link: 'https://kiteforecast.app/?tab=notifs&spot=Rivierwoods&date=2026-08-22',
  user_good_wind_dirs: 'SW / W / NW',
  'session.start_time_formatted': '11:00',
  'session.end_time_formatted': '16:00',
  'session.duration_hours': '5',
  'session.wind_speed_peak_kn': '24',
  'session.wind_speed_avg_kn': '21',
  'session.wind_speed_min_kn': '17',
  'session.wind_gusts_kn': '29',
  'session.wind_direction': 'SW',
  'session.wind_consistency_pct': '82',
  'session.rating': '\u2705 5h \u00b7 Very Good',
  'session.rating_fg': '#fde047',
  'session.rating_bg': 'rgba(234,179,8,.16)',
  'session.rating_border': 'rgba(234,179,8,.36)',
  'conditions.weather': 'Partly cloudy',
  'conditions.temperature_max_c': '23',
  'conditions.temperature_min_c': '16',
  'conditions.sunrise': '06:41',
  'conditions.sunset': '20:58',
  'hype.subject': 'Rivierwoods tomorrow is EPIC',
  'hype.title': 'Cancel your plans.',
  'hype.title_accent': 'Tomorrow is epic.',
  'hype.tease': '31 knots on average for 5 hours, SW at Rivierwoods Beachclub, peaking at 34. Charge the camera, pump up early, and don\u2019t be the one who hears about it afterwards.',
  calendar_html: '',
  live_html: '',
}

function render(name, payload) {
  const file = join(EMAILS, `${name}.html`)
  let html = readFileSync(file, 'utf8')
  for (const [k, v] of Object.entries(payload)) {
    html = html.split(`[[${k}]]`).join(String(v))
  }
  const missing = [...new Set(html.match(/\[\[[^\]]+\]\]/g) ?? [])]
  return { html, missing }
}

const args = process.argv.slice(2)
const all = args.includes('--all')
const outIdx = args.indexOf('--out')
const outDir = outIdx > -1 ? args[outIdx + 1] : null
const names = all
  ? readdirSync(EMAILS).filter(f => f.startsWith('reminder') && f.endsWith('.html')).map(f => f.replace('.html', ''))
  : args.filter(a => !a.startsWith('--') && a !== outDir)

if (!names.length) {
  console.error('usage: render-email.mjs <template-name>... | --all [--out <dir>]')
  process.exit(2)
}

let failed = false
const parts = []
for (const name of names) {
  const { html, missing } = render(name, SAMPLE)
  if (missing.length) {
    console.error(`✗ ${name}: unfilled ${missing.join(', ')}`)
    failed = true
  } else {
    console.error(`✓ ${name}`)
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, `${name}.html`), html)
  }
  parts.push(`<p style="color:#94a3b8;font:13px system-ui;margin:24px 0 6px">${name}</p>${html}`)
}

if (outDir) {
  writeFileSync(join(outDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Reminder email preview</title>` +
    `<body style="margin:0;padding:24px;background:#0a0e16">${parts.join('')}</body>`)
  console.error(`\nwrote ${names.length} template(s) to ${outDir}`)
} else if (!outDir && names.length === 1) {
  process.stdout.write(render(names[0], SAMPLE).html)
}

process.exit(failed ? 1 : 0)

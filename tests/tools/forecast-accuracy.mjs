#!/usr/bin/env node
// Score what we ask Open-Meteo for against what actually happened.
//
// The app read 4.6 kn low and 2.9 kn gusty against Windfinder at Riverwoods on
// 31 Aug, and the only way to stop arguing about why is to measure it. This
// fetches the same spot under several request shapes and scores each one, so a
// change to the forecast request is defended by numbers rather than by a story.
//
//   node tests/tools/forecast-accuracy.mjs --spot "Riverwoods Beachclub"
//   node tests/tools/forecast-accuracy.mjs --lat 51.3627 --lon 3.3062 \
//        --ref refs/riverwoods-2026-08-31.json
//
// Without --ref it prints the configurations side by side, which already
// answers "does the sea cell change anything here". With --ref it scores them
// against observations and names a winner.
//
// A reference file is one JSON object:
//   { "date": "2026-08-31", "unit": "kn", "source": "windfinder superforecast",
//     "hours": { "7": [17, 25], "8": [19, 28] } }        // hour: [wind, gust]
// Read them off a trusted forecast, or off the RWS masts the app already uses
// for live wind — measurements beat another model's opinion.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }

// The configurations worth arguing about. `label` is what gets printed.
const CASES = [
  { label: 'land cell (Open-Meteo default)', params: { cell_selection: 'land' } },
  { label: 'sea cell  (what the app now asks for)', params: { cell_selection: 'sea' } },
  { label: 'nearest cell', params: { cell_selection: 'nearest' } },
  { label: 'sea + icon_seamless', params: { cell_selection: 'sea', models: 'icon_seamless' } },
  { label: 'sea + knmi_seamless', params: { cell_selection: 'sea', models: 'knmi_seamless' } },
  { label: 'sea + meteofrance_seamless', params: { cell_selection: 'sea', models: 'meteofrance_seamless' } },
]

async function fetchCase(lat, lon, params, days) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'windspeed_10m,windgusts_10m,winddirection_10m',
    forecast_days: String(days), timezone: 'auto', windspeed_unit: 'kn',
    ...params,
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`)
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
  const d = await r.json()
  if (d.error) throw new Error(d.reason || 'API error')
  return d
}

// hour -> [wind, gust] for one date
function hoursOf(data, date) {
  const h = data.hourly, out = new Map()
  h.time.forEach((t, i) => {
    if (t.slice(0, 10) !== date) return
    out.set(Number(t.slice(11, 13)), [h.windspeed_10m[i], h.windgusts_10m[i]])
  })
  return out
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length

function score(got, ref) {
  const hs = [...ref.keys()].filter(h => got.has(h)).sort((a, b) => a - b)
  if (!hs.length) return null
  const dw = hs.map(h => got.get(h)[0] - ref.get(h)[0])
  const dg = hs.map(h => got.get(h)[1] - ref.get(h)[1])
  return {
    n: hs.length,
    maeWind: mean(dw.map(Math.abs)), biasWind: mean(dw),
    maeGust: mean(dg.map(Math.abs)), biasGust: mean(dg),
    gustFactor: mean(hs.filter(h => got.get(h)[0] > 0).map(h => got.get(h)[1] / got.get(h)[0])),
  }
}

function spotFromCatalogue(name) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const re = new RegExp(`\\{name:'${name.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')
    }',loc:'[^']*',lat:([-\\d.]+),lon:([-\\d.]+)`, 'i')
  const m = html.match(re)
  if (!m) throw new Error(`spot "${name}" not found in the catalogue`)
  return { lat: Number(m[1]), lon: Number(m[2]) }
}

const spotName = arg('spot')
const here = spotName ? spotFromCatalogue(spotName)
  : { lat: Number(arg('lat', '51.3627')), lon: Number(arg('lon', '3.3062')) }
const refPath = arg('ref')
const ref = refPath ? JSON.parse(readFileSync(refPath, 'utf8')) : null
const date = arg('date', ref?.date) || new Date(Date.now() + 864e5).toISOString().slice(0, 10)
const days = Math.max(2, Math.ceil((Date.parse(date + 'T12:00:00Z') - Date.now()) / 864e5) + 1)

console.log(`spot ${spotName || `${here.lat},${here.lon}`}  ·  date ${date}` +
  (ref ? `  ·  reference: ${ref.source || refPath}` : '  ·  no reference (side-by-side only)'))
console.log()

const refHours = ref ? new Map(Object.entries(ref.hours).map(([h, v]) => [Number(h), v])) : null
const results = []
for (const c of CASES) {
  try {
    const data = await fetchCase(here.lat, here.lon, c.params, days)
    const hours = hoursOf(data, date)
    if (!hours.size) { console.log(`${c.label.padEnd(38)} no data for ${date}`); continue }
    results.push({ ...c, hours, elevation: data.elevation, score: refHours && score(hours, refHours) })
  } catch (e) {
    console.log(`${c.label.padEnd(38)} FAILED: ${e.message}`)
  }
}

if (refHours) {
  console.log('Lower MAE is better. Wind bias near 0 means no systematic offset.')
  console.log('Gust factor over open water sits near 1.1-1.3; 1.8+ means a rough surface.')
  console.log()
  console.log('config'.padEnd(38) + 'MAEwind  biasW  MAEgust  biasG  gustF   elev')
  for (const r of results) {
    const s = r.score
    if (!s) { console.log(r.label.padEnd(38) + 'no overlapping hours'); continue }
    console.log(r.label.padEnd(38) +
      `${s.maeWind.toFixed(1).padStart(7)}${s.biasWind.toFixed(1).padStart(7)}` +
      `${s.maeGust.toFixed(1).padStart(9)}${s.biasGust.toFixed(1).padStart(7)}` +
      `${s.gustFactor.toFixed(2).padStart(7)}${String(r.elevation ?? '?').padStart(7)}`)
  }
  const ranked = results.filter(r => r.score).sort((a, b) => a.score.maeWind - b.score.maeWind)
  if (ranked.length) console.log(`\nclosest to the reference: ${ranked[0].label} (MAE ${ranked[0].score.maeWind.toFixed(1)} kn)`)
}

console.log()
const hourList = refHours ? [...refHours.keys()].sort((a, b) => a - b)
  : [...Array(24).keys()].filter(h => h >= 6 && h <= 21)
console.log('hour' + (refHours ? '   ref' : '') + results.map(r => r.label.slice(0, 11).padStart(13)).join(''))
for (const h of hourList) {
  let line = String(h).padStart(4)
  if (refHours) line += refHours.has(h) ? `  ${String(refHours.get(h)[0]).padStart(2)}/${String(refHours.get(h)[1]).padEnd(2)}` : '      '
  for (const r of results) {
    const v = r.hours.get(h)
    line += v ? `${Math.round(v[0])}/${Math.round(v[1])}`.padStart(13) : '-'.padStart(13)
  }
  console.log(line)
}

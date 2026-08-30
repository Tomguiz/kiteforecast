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
//
// Or pass --rws to build the reference from MEASUREMENTS instead: the
// Rijkswaterstaat mast network the app already reads for live wind. A mast
// does not have an opinion, and unlike a forecast snapshot it does not expire,
// so this is the reference to prefer wherever a mast is in range.
//
//   node tests/tools/forecast-accuracy.mjs --spot "Riverwoods Beachclub" --rws
//
// READ THIS BEFORE QUOTING AN ABSOLUTE NUMBER FROM --rws. Open-Meteo's reply
// for hours that have already elapsed is not the forecast that was issued for
// them days ago — it is blended with the analysis, which has seen the weather
// it is being scored against. So the errors it reports are a FLOOR, flattering
// to every configuration. What survives that is the COMPARISON: the blending
// hits all six rows alike, so which one is closest stays meaningful, and that
// is the only question this tool is being asked. Verifying a forecast as
// issued means archiving it at issue time and scoring it days later, which is
// a standing job, not a script.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const flag = n => args.includes(`--${n}`)

// ── Measured reference: the RWS mast network ────────────────────────────────
// Mirrors supabase/functions/_shared/rws.ts — same base, same bbox, same feed
// ids. Kept to the three constants rather than importing, because that module
// is Deno TypeScript and this is a plain Node script.
const RWS_BASE = 'https://rwsos.rws.nl/wb-api'
const RWS_BBOX = '[2,48.56,7.5,57]'
const RWS_MAX_KM = 30
const MS_TO_KN = 1.94384

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = d => d * Math.PI / 180
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function rwsJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`RWS HTTP ${r.status}`)
  return await r.json()
}

// The speed feed carries every station in the box with its coordinates, so one
// request finds the nearest mast to any spot.
async function rwsNearestStation(lat, lon) {
  const q = new URLSearchParams({
    sourceName: 'datapush-1min', observationTypeId: 'WS1', boundingBox: RWS_BBOX,
  })
  const j = await rwsJson(`${RWS_BASE}/sp/dd/2.0/locations/geojson?${q}`)
  let best = null
  for (const f of j?.features || []) {
    const p = f?.properties, c = f?.geometry?.coordinates
    if (!p || typeof p.id !== 'string' || !Array.isArray(c)) continue
    if (typeof c[0] !== 'number' || typeof c[1] !== 'number') continue
    const d = haversineKm(lat, lon, c[1], c[0])
    if (d > RWS_MAX_KM) continue
    if (!best || d < best.distanceKm) best = {
      id: p.id,
      name: String(p.locationName ?? p.id).split(',').pop().trim(),
      distanceKm: d,
    }
  }
  return best
}

// One observation series for one station over one day, bucketed by local hour.
async function rwsSeries(stationId, obs, src, date, tzOffsetMin) {
  // The mast timestamps in UTC; the forecast is bucketed in the spot's local
  // hours. Ask for the window that covers the local day, then bucket by the
  // local hour each reading falls in — otherwise every comparison is silently
  // shifted by the offset, which at 2h is most of a sea breeze.
  const startMs = Date.parse(`${date}T00:00:00Z`) - tzOffsetMin * 60000
  const endMs = startMs + 24 * 3600 * 1000
  const q = new URLSearchParams({
    observationTypeId: obs, sourceName: src, locationCode: stationId,
    startTime: new Date(startMs).toISOString().slice(0, 19) + 'Z',
    endTime: new Date(endMs).toISOString().slice(0, 19) + 'Z',
  })
  const j = await rwsJson(`${RWS_BASE}/sp/dd/2.0/timeseries?${q}`)
  const events = j?.results?.[0]?.events
  const byHour = new Map()
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.value !== 'number' || typeof e.timeStamp !== 'string') continue
    const t = Date.parse(e.timeStamp)
    if (Number.isNaN(t)) continue
    const hr = new Date(t + tzOffsetMin * 60000).getUTCHours()
    if (!byHour.has(hr)) byHour.set(hr, [])
    byHour.get(hr).push(e.value)
  }
  return byHour
}

// hour -> [wind, gust] in knots, from measurements.
// Wind is the hourly MEAN and gust the hourly MAX, because that is what the
// two forecast fields mean: a mean wind and the strongest gust within the hour.
// Averaging the gusts instead would score the model against a quantity nobody
// forecasts.
async function rwsReference(lat, lon, date, tzOffsetMin) {
  const st = await rwsNearestStation(lat, lon)
  if (!st) throw new Error(`no RWS mast within ${RWS_MAX_KM} km — this network covers the Dutch and Belgian coast only`)
  const [speed, gust] = await Promise.all([
    rwsSeries(st.id, 'WS1', 'datapush-1min', date, tzOffsetMin),
    rwsSeries(st.id, 'WS10MXS3', 'datapush-10min', date, tzOffsetMin).catch(() => new Map()),
  ])
  const hours = new Map()
  for (const [hr, vals] of speed) {
    if (!vals.length) continue
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const g = gust.get(hr)
    hours.set(hr, [mean * MS_TO_KN, g && g.length ? Math.max(...g) * MS_TO_KN : null])
  }
  return { hours, station: st }
}

// The configurations worth arguing about. `label` is what gets printed.
const CASES = [
  { label: 'land cell (Open-Meteo default)', params: { cell_selection: 'land' } },
  { label: 'sea cell  (what the app now asks for)', params: { cell_selection: 'sea' } },
  { label: 'nearest cell', params: { cell_selection: 'nearest' } },
  { label: 'sea + icon_seamless', params: { cell_selection: 'sea', models: 'icon_seamless' } },
  { label: 'sea + knmi_seamless', params: { cell_selection: 'sea', models: 'knmi_seamless' } },
  { label: 'sea + meteofrance_seamless', params: { cell_selection: 'sea', models: 'meteofrance_seamless' } },
]

async function fetchCase(lat, lon, params, window) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: 'windspeed_10m,windgusts_10m,winddirection_10m',
    timezone: 'auto', windspeed_unit: 'kn',
    ...window, ...params,
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
  // A mast can report wind for an hour and no gust. Scoring a null as zero
  // would invent a 20-knot error; the gust columns simply cover fewer hours.
  const gh = hs.filter(h => ref.get(h)[1] != null)
  const dg = gh.map(h => got.get(h)[1] - ref.get(h)[1])
  return {
    n: hs.length, nGust: gh.length,
    maeWind: mean(dw.map(Math.abs)), biasWind: mean(dw),
    maeGust: dg.length ? mean(dg.map(Math.abs)) : null,
    biasGust: dg.length ? mean(dg) : null,
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
const useRws = flag('rws')
const refPath = useRws ? null : arg('ref')
const ref = refPath ? JSON.parse(readFileSync(refPath, 'utf8')) : null
// Measured hours are the ones already elapsed, so --rws defaults to today
// rather than tomorrow: there is nothing to measure about a day that has not
// happened.
const date = arg('date', ref?.date) ||
  new Date(Date.now() + (useRws ? 0 : 864e5)).toISOString().slice(0, 10)

// A past date needs past_days; a future one needs enough forecast_days to
// reach it. Both are clamped to what the API will serve.
const dayDelta = Math.round(
  (Date.parse(date + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5)
const window = dayDelta < 0
  ? { past_days: String(Math.min(-dayDelta, 92)), forecast_days: '1' }
  : { forecast_days: String(Math.min(Math.max(dayDelta + 1, 2), 16)) }

let refHours = null, refLabel = 'no reference (side-by-side only)'
if (useRws) {
  try {
    // The forecast is bucketed in the spot's local hours; ask one configuration
    // first purely to learn that offset, so the mast can be bucketed to match.
    const probe = await fetchCase(here.lat, here.lon, { cell_selection: 'sea' }, window)
    const tzOffsetMin = Math.round((probe.utc_offset_seconds ?? 0) / 60)
    const { hours, station } = await rwsReference(here.lat, here.lon, date, tzOffsetMin)
    refHours = hours
    refLabel = `RWS mast ${station.name}, ${station.distanceKm.toFixed(1)} km away — MEASURED`
  } catch (e) {
    // A stack trace here says nothing useful: the two ways this fails are a
    // spot with no mast in range and a host the network will not reach.
    console.error(`could not build a measured reference: ${e.message}`)
    process.exit(1)
  }
} else if (ref) {
  refHours = new Map(Object.entries(ref.hours).map(([h, v]) => [Number(h), v]))
  refLabel = `${ref.source || refPath} — a forecast, not a measurement`
}

console.log(`spot ${spotName || `${here.lat},${here.lon}`}  ·  date ${date}  ·  reference: ${refLabel}`)
if (useRws) console.log(
  'NOTE: elapsed hours come back blended with Open-Meteo\'s analysis, so these errors\n' +
  '      are a floor for every row alike. Read the RANKING, not the absolute numbers.')
console.log()
const results = []
for (const c of CASES) {
  try {
    const data = await fetchCase(here.lat, here.lon, c.params, window)
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
  console.log('config'.padEnd(38) + 'MAEwind  biasW  MAEgust  biasG  gustF   elev   n')
  const num = (v, w, d = 1) => (v == null ? '-' : v.toFixed(d)).padStart(w)
  for (const r of results) {
    const s = r.score
    if (!s) { console.log(r.label.padEnd(38) + 'no overlapping hours'); continue }
    console.log(r.label.padEnd(38) +
      num(s.maeWind, 7) + num(s.biasWind, 7) +
      num(s.maeGust, 9) + num(s.biasGust, 7) +
      num(s.gustFactor, 7, 2) + String(r.elevation ?? '?').padStart(7) +
      String(s.n).padStart(4))
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
  if (refHours) {
    const v = refHours.get(h)
    // RWS hands back floats; a file reference is already whole knots. Round
    // both, so the column reads the same whichever reference is in play.
    line += v ? `  ${String(Math.round(v[0])).padStart(2)}/${String(v[1] == null ? '-' : Math.round(v[1])).padEnd(2)}` : '      '
  }
  for (const r of results) {
    const v = r.hours.get(h)
    line += v ? `${Math.round(v[0])}/${Math.round(v[1])}`.padStart(13) : '-'.padStart(13)
  }
  console.log(line)
}

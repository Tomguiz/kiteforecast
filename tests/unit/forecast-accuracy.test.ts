import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The app read 4.6 kn LOW and 2.9 kn GUSTY against Windfinder at Riverwoods
// over 14 daylight hours on 31 Aug 2026 — low on 13 hours of 14, gusty on 10,
// at a gust factor of 1.93 against Windfinder's 1.30. Wind down and gusts up
// together is surface roughness, not a rival model: the forecast was being
// read out of a LAND grid cell for a spot on a beach. Open-Meteo's
// cell_selection defaults to `land`, which walks away from the water on
// purpose. Every spot in this catalogue is on water, so it must not.
//
// tests/tools/forecast-accuracy.mjs scores the alternatives against a
// reference; these are the invariants that must not quietly come undone.

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const fn = readFileSync(
  new URL('../../supabase/functions/forecast/index.ts', import.meta.url), 'utf8')
// The request itself moved next to its Stormglass sibling; the cell it asks
// for is pinned there now.
const src = readFileSync(
  new URL('../../supabase/functions/_shared/forecast-source.ts', import.meta.url), 'utf8')

describe('which grid cell the wind is read from', () => {
  it('the function asks Open-Meteo for a sea cell', () => {
    expect(src).toMatch(/export const CELL_SELECTION = 'sea'/)
    // The measurement that justifies it stays with the function, where the
    // next person to wonder will look.
    expect(fn).toContain('export { CELL_SELECTION }')
  })

  it('it asks for that cell on BOTH the forecast and the marine call', () => {
    expect(src.match(/cell_selection: CELL_SELECTION/g) || []).toHaveLength(2)
  })

  it('the client fallback asks for the same cell', () => {
    // When the shared cache is unreachable the app goes straight to Open-Meteo.
    // If that call kept the default the numbers would jump the moment the
    // function was down — the same spot, two different forecasts.
    expect(html.match(/cell_selection:'sea'/g) || []).toHaveLength(2)
  })

  it('the stored row is keyed by the request shape, not only the coordinate', () => {
    // Rows live two hours, and the stale fallback serves them for a week. A
    // change to what we ASK for that did not change the key would keep handing
    // back land-cell numbers long after the deploy.
    expect(fn).toMatch(/const REQUEST_VERSION = '[^']+'/)
    expect(fn).toContain('${REQUEST_VERSION}:${lat.toFixed(3)},${lon.toFixed(3)}')
  })
})

describe('how far ahead the app is willing to make a promise', () => {
  const confident = Number(html.match(/const CONFIDENT_DAYS=(\d+);/)![1])

  it('counts rideable days inside a confident window', () => {
    expect(confident).toBe(10)
  })

  it('that window ends exactly where the spot page starts fading days', () => {
    // The strip fades index >= 10 and captions days 11-16 as a lower-confidence
    // outlook. The homepage badge counted all sixteen while its own tooltip
    // said "in the next 10". The two must name the same boundary.
    expect(html).toContain('days 11–16 are a lower-confidence outlook')
    expect(html).toContain("i>=10?' day-lowconf':''")
    expect(html).toContain("i>=10?' tds-lowconf':''")
    expect(confident).toBe(10)
  })

  it('every path that counts good days honours it', () => {
    // fetchChipQualDays counts the badge and builds days10; the detail page
    // mirrors both in reconcileChipCacheFromDetail. All three must agree, or
    // the badge and the spot page contradict each other.
    expect(html.match(/if\(i>=CONFIDENT_DAYS\) return;/g) || []).toHaveLength(3)
  })

  it('the badge tooltip states the window rather than restating it by hand', () => {
    expect(html).toContain('in the next ${CONFIDENT_DAYS}')
  })
})

describe('the batched home-screen request', () => {
  it('the client cap matches the function cap', () => {
    const client = Number(html.match(/const MAX_BATCH_SPOTS=(\d+);/)![1])
    const server = Number(fn.match(/MAX_BATCH_SPOTS = (\d+)/)![1])
    expect(client).toBe(server)
  })

  it('the function echoes back the token it was sent', () => {
    // The client matches answers to cards by that string. Dropping it would
    // force it to re-derive a key from a float it already formatted once.
    expect(fn).toContain('q: w.q')
  })

  it('a slim answer still carries everything the badge counts', () => {
    // The badge reads wind, direction, gusts, the weather code and the daylight
    // window. Trimming one of those to save bytes would make every count wrong.
    for (const k of ['time', 'weather_code', 'windspeed_10m', 'winddirection_10m', 'windgusts_10m'])
      expect(fn).toContain(`'${k}'`)
    expect(fn).toMatch(/SLIM_DAILY\s*=\s*\['time', 'sunrise', 'sunset'\]/)
  })
})

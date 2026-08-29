import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The two-hour window exists in two places that cannot import each other: the
// edge function decides how long a stored row is served, and the client decides
// how old data may be before it re-fetches on open. If they drift, the app
// either re-fetches data the server will just hand straight back, or sits on a
// row the server already considers expired. Pin them together.

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const fn = readFileSync(
  new URL('../../supabase/functions/forecast/index.ts', import.meta.url), 'utf8')

const TWO_HOURS = 2 * 60 * 60 * 1000

describe('the shared forecast cache window', () => {
  it('the edge function serves a row for two hours', () => {
    const m = fn.match(/FORECAST_TTL_MS\s*=\s*([\d\s*]+)/)
    expect(m).toBeTruthy()
    // eslint-disable-next-line no-eval
    expect(eval(m![1])).toBe(TWO_HOURS)
  })

  it('the client re-fetches on open at the same age', () => {
    const m = html.match(/const STALE_AFTER_MS=([\d*]+)/)
    expect(m).toBeTruthy()
    expect(eval(m![1])).toBe(TWO_HOURS)
  })

  it('the on-device cache does not outlive the shared one', () => {
    const m = html.match(/const WX_CACHE_TTL=([\d*]+)/)
    expect(m).toBeTruthy()
    expect(eval(m![1])).toBeLessThanOrEqual(TWO_HOURS)
  })

  it('the function asks Open-Meteo for the full 16-day window', () => {
    // The "16-day overview" is the app's headline promise. Building the
    // Open-Meteo URL moved from the client into the function, so this is where
    // the window now has to be pinned — for the forecast and the marine call
    // alike, which must cover the same days or the wave data runs short.
    expect(fn.match(/forecast_days: '16'/g) || []).toHaveLength(2)
  })

  it('forecasts go through the shared cache, not straight to Open-Meteo', () => {
    // The only surviving direct call must be the fallback inside
    // fetchForecastBundle — everything else routes through the function.
    const direct = html.match(/api\.open-meteo\.com\/v1\/forecast/g) || []
    expect(direct).toHaveLength(1)
    expect(html).toContain('functions/v1/forecast')
  })
})

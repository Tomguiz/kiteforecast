import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_PLAN_DAYS, KM_PER_DRIVE_HOUR, MAX_CANDIDATES,
} from '../../supabase/functions/_shared/planner.ts'

// Third mirrored module, same bargain as rideability and kite-size: index.html
// is a plain script and cannot import. The bound that matters most here is
// MAX_CANDIDATES — it is the number of forecast requests one search fires, so
// a drift there is not cosmetic, it is a load problem.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const num = (n: string) => {
  const m = html.match(new RegExp(`const ${n}\\s*=\\s*([\\d.]+)`))
  if (!m) throw new Error(`${n} not found in index.html`)
  return parseFloat(m[1])
}

describe('the two copies of the planner agree', () => {
  it('same date window — the cap the rider asked for', () => {
    expect(num('MAX_PLAN_DAYS')).toBe(MAX_PLAN_DAYS)
  })
  it('same shortlist budget, which is a request count', () => {
    expect(num('MAX_CANDIDATES')).toBe(MAX_CANDIDATES)
  })
  it('same straight-line bound used before routing', () => {
    expect(num('KM_PER_DRIVE_HOUR')).toBe(KM_PER_DRIVE_HOUR)
  })
})

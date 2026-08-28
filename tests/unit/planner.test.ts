import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  shortlistCandidates, rankPlan, planDates,
  MAX_PLAN_DAYS, KM_PER_DRIVE_HOUR, MAX_CANDIDATES,
} from '../../supabase/functions/_shared/planner.ts'

const HOME = { lat: 50.7175, lon: 4.3978 }          // Waterloo
const spot = (name: string, lat: number, lon: number, waterType?: string) =>
  ({ name, lat, lon, waterType })

describe('shortlisting, which is what keeps the search affordable', () => {
  // 399 spots would be 399 forecast requests. The list is cut geographically
  // BEFORE any of them are made.
  it('never returns more candidates than the forecast budget', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      spot(`s${i}`, 51 + i * 0.01, 3 + i * 0.01))
    const got = shortlistCandidates(many, HOME, { maxDriveMin: 600, minSeparationKm: 5 })
    expect(got.length).toBeLessThanOrEqual(MAX_CANDIDATES)
  })

  it('spreads them out instead of returning one stretch of coast', () => {
    // six beaches within a few km of each other, plus one far away
    const cluster = Array.from({ length: 6 }, (_, i) => spot(`c${i}`, 51.30 + i * 0.01, 3.20))
    const far = spot('far', 51.90, 4.40)
    const got = shortlistCandidates([...cluster, far], HOME, { maxDriveMin: 300, minSeparationKm: 25 })
    expect(got.filter(s => s.name.startsWith('c'))).toHaveLength(1)
    expect(got.map(s => s.name)).toContain('far')
  })

  it('cannot shortlist a spot that could not fit the drive budget', () => {
    // roads are never shorter than the crow flies, so the straight-line radius
    // is a safe upper bound rather than a guess
    const got = shortlistCandidates([spot('miles away', 58, 12)], HOME, { maxDriveMin: 60, minSeparationKm: 5 })
    expect(got).toHaveLength(0)
    expect(KM_PER_DRIVE_HOUR).toBeGreaterThan(0)
  })

  it('filters on spot style when one is asked for', () => {
    const got = shortlistCandidates(
      [spot('flat one', 51.3, 3.2, 'Flat'), spot('wavy one', 51.6, 3.4, 'Waves')],
      HOME, { maxDriveMin: 300, minSeparationKm: 5, waterType: 'flat' })
    expect(got.map(s => s.name)).toEqual(['flat one'])
  })
})

describe('ranking whole spots, not days', () => {
  const day = (dateStr: string, goodHours: number, peakKn: number) =>
    ({ dateStr, goodHours, peakKn, startHr: 11, dir: 'W' })
  const s = (name: string, driveMin: number, days: any[]) =>
    ({ name, lat: 51, lon: 3, distanceKm: driveMin, driveMin, days })

  it('drops a spot with no day worth the trip', () => {
    const got = rankPlan([
      s('windless', 60, [day('2026-08-29', 4, 11)]),
      s('good', 60, [day('2026-08-29', 4, 24)]),
    ], { minWindKn: 15, sort: 'best' })
    expect(got.map(x => x.name)).toEqual(['good'])
  })

  it('drops the day, not the spot, when only one day is weak', () => {
    const got = rankPlan([s('mixed', 60, [day('a', 4, 10), day('b', 5, 25)])],
      { minWindKn: 15, sort: 'best' })
    expect(got[0].days.map(d => d.dateStr)).toEqual(['b'])
  })

  it('"most wind" and "nearest" really do sort differently', () => {
    const list = [
      s('far but windy', 240, [day('a', 4, 30)]),
      s('near but calm', 30, [day('a', 4, 18)]),
    ]
    expect(rankPlan(list, { minWindKn: 15, sort: 'wind' })[0].name).toBe('far but windy')
    expect(rankPlan(list, { minWindKn: 15, sort: 'near' })[0].name).toBe('near but calm')
  })

  it('"best" makes a long drive earn its keep', () => {
    // four hours of driving for 3 kn more is not a better session
    const got = rankPlan([
      s('4h away, 27 kn', 240, [day('a', 4, 27)]),
      s('30 min away, 24 kn', 30, [day('a', 4, 24)]),
    ], { minWindKn: 15, sort: 'best' })
    expect(got[0].name).toBe('30 min away, 24 kn')
  })

  it('respects the drive budget even if a spot slipped through', () => {
    const got = rankPlan([s('too far', 400, [day('a', 5, 30)])],
      { minWindKn: 15, sort: 'best', maxDriveMin: 180 })
    expect(got).toHaveLength(0)
  })
})

describe('the date window is bounded, and stays bounded', () => {
  it('covers today plus three, and no more', () => {
    const d = planDates('2026-08-28')
    expect(d).toEqual(['2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'])
    expect(d).toHaveLength(MAX_PLAN_DAYS)
  })

  it('cannot be talked into a longer window', () => {
    // the rider's reason: past J+3 the forecast is not reliable enough to
    // plan a drive on, so this is a cap and not a default
    expect(planDates('2026-08-28', 14)).toHaveLength(MAX_PLAN_DAYS)
  })

  it('crosses a month boundary correctly', () => {
    expect(planDates('2026-08-30')).toEqual(['2026-08-30','2026-08-31','2026-09-01','2026-09-02'])
  })
})

// Oesterdam was catalogued 35 km north-west of the real dam, in the
// Brouwersdam area. From Waterloo that is a 2h06 drive instead of 1h19, so the
// planner ranked it as far more expensive than it is. Coordinates are the one
// input the planner cannot sanity-check at runtime, so pin the fix.
describe('spot coordinates used for routing', () => {
  it('places Oesterdam on the actual Oesterdam', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const m = html.match(/\{name:'Oesterdam',loc:'([^']+)',lat:([\d.]+),lon:([\d.]+)/)
    expect(m).toBeTruthy()
    const lat = Number(m![2]), lon = Number(m![3])
    // The dam runs between Tholen and Zuid-Beveland.
    expect(lat).toBeGreaterThan(51.44); expect(lat).toBeLessThan(51.55)
    expect(lon).toBeGreaterThan(4.15);  expect(lon).toBeLessThan(4.25)
  })
})

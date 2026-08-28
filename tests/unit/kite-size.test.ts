import { describe, it, expect } from 'vitest'
import {
  suggestKiteSize, riderScale, QUIVER_SIZES, WIND_BANDS, MIN_WIND_KN, MAX_WIND_KN,
} from '../../supabase/functions/_shared/kite-size.ts'

// Bands, not a curve. The first version fitted size = K * weight / wind and
// was wrong in a way no smoothing could fix: it wanted 18.3 m at 14 kn and
// 11.6 m at 22 kn, while the rider it was calibrated on flies ONE 12 m across
// that whole range. These tests are his actual quiver.
describe('the reference quiver it is built from', () => {
  const me = (windKn: number) =>
    suggestKiteSize({ weightKg: 80, level: 'Advanced', pref: 'overpowered', windKn })!.size

  it('holds 12 m from 14 to 22 kn', () => {
    for (const kn of [14, 16, 18, 20, 22]) expect(me(kn)).toBe(12)
  })

  it('holds 10 m from just above 22 to 32 kn', () => {
    for (const kn of [23, 26, 30, 32]) expect(me(kn)).toBe(10)
  })

  it('drops to 8 m above 32 kn', () => {
    for (const kn of [33, 38, 45]) expect(me(kn)).toBe(8)
  })

  it('changes size exactly at the stated thresholds, not around them', () => {
    expect(me(22)).toBe(12); expect(me(23)).toBe(10)
    expect(me(32)).toBe(10); expect(me(33)).toBe(8)
  })
})

// The two other points he gave, which is all the calibration there is for
// scaling away from his own body and level.
describe('scaling to other riders', () => {
  it('a 60 kg advanced rider is on 9 m where he is on 12', () => {
    const s = suggestKiteSize({ weightKg: 60, level: 'Advanced', pref: 'overpowered', windKn: 18 })!.size
    expect(s).toBe(9)          // he said 9-10
  })

  it('a beginner at his own weight is on 10 m where he is on 12', () => {
    const s = suggestKiteSize({ weightKg: 80, level: 'Beginner', pref: 'neutral', windKn: 18 })!.size
    expect(s).toBe(10)         // he said 10-11
  })

  it('orders the levels without letting preference outrank them', () => {
    const at = (level: any, pref: any) =>
      suggestKiteSize({ weightKg: 80, level, pref, windKn: 18 })!.size
    expect(at('Beginner', 'overpowered')).toBeLessThan(at('Advanced', 'underpowered'))
  })

  it('is linear in weight, which is the only scaling rule there is evidence for', () => {
    expect(riderScale(80, 'Advanced', 'overpowered')).toBeCloseTo(1, 6)
    expect(riderScale(40, 'Advanced', 'overpowered')).toBeCloseTo(0.5, 6)
  })
})

// Bands are what stop the hourly column flickering. The previous version
// needed explicit hysteresis to fake this; here it falls out of the model.
describe('stability across the day', () => {
  it('never changes size while the wind stays inside one band', () => {
    const sizes = [15, 19, 16, 21, 18, 22].map(kn =>
      suggestKiteSize({ weightKg: 80, level: 'Advanced', pref: 'overpowered', windKn: kn })!.size)
    expect(new Set(sizes).size).toBe(1)
  })
})

describe('refuses rather than guesses', () => {
  it('says nothing without a weight or a level', () => {
    expect(suggestKiteSize({ weightKg: null, level: 'Advanced', windKn: 20 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 80, level: null, windKn: 20 })).toBeNull()
  })
  it('says nothing for an implausible weight or an unknown level', () => {
    expect(suggestKiteSize({ weightKg: 7, level: 'Advanced', windKn: 20 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 80, level: 'Expert' as any, windKn: 20 })).toBeNull()
  })
  it('says nothing outside the wind band', () => {
    expect(suggestKiteSize({ weightKg: 80, level: 'Advanced', windKn: MIN_WIND_KN - 1 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 80, level: 'Advanced', windKn: MAX_WIND_KN + 1 })).toBeNull()
  })
})

describe('outside the quiver it caps and says so', () => {
  it('flags the top rather than silently pretending', () => {
    const r = suggestKiteSize({ weightKg: 150, level: 'Advanced', pref: 'overpowered', windKn: 15 })!
    expect(r.size).toBe(QUIVER_SIZES[QUIVER_SIZES.length - 1])
    expect(r.limit).toBe('over')
    expect(r.exact).toBeGreaterThan(r.size)
  })
  it('marks nothing when the size lands inside the quiver', () => {
    expect(suggestKiteSize({ weightKg: 80, level: 'Advanced', pref: 'overpowered', windKn: 18 })!.limit).toBeNull()
  })
  it('reports which band it used, so the UI can name the range', () => {
    expect(suggestKiteSize({ weightKg: 80, level: 'Advanced', windKn: 18 })!.bandMaxKn).toBe(WIND_BANDS[0].maxKn)
  })
})

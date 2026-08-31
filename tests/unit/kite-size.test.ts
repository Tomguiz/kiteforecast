import { describe, it, expect } from 'vitest'
import {
  suggestKiteSize, powerFactor, QUIVER_SIZES, MIN_WIND_KN, MAX_WIND_KN,
} from '../../supabase/functions/_shared/kite-size.ts'

// The formula is calibrated on the rider's own numbers, so those are the
// tests that matter: if these drift, the suggestion no longer reflects what
// he actually rides.
describe('kite size — the reference point it was built from', () => {
  const at = (level: any, pref: any = 'neutral') =>
    suggestKiteSize({ weightKg: 75, level, pref, windKn: 20 })!.size

  it('75 kg at 20 kn: 9 / 10 / 11-12 by level', () => {
    expect(at('Beginner')).toBe(9)
    expect(at('Intermediate')).toBe(10)
    expect(at('Advanced')).toBeGreaterThanOrEqual(11)
    expect(at('Advanced')).toBeLessThanOrEqual(12)
  })

  it('a heavier rider needs more kite, a lighter one less', () => {
    const s = (w: number) => suggestKiteSize({ weightKg: w, level: 'Intermediate', windKn: 20 })!.size
    expect(s(60)).toBeLessThan(s(75))
    expect(s(90)).toBeGreaterThan(s(75))
  })

  it('more wind means less kite, monotonically', () => {
    const sizes = [16, 20, 25, 30, 35].map(kn =>
      suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: kn })!.size)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
  })
})

describe('power preference', () => {
  it('shifts the size, in the direction the words mean', () => {
    const s = (pref: any) => suggestKiteSize({ weightKg: 75, level: 'Intermediate', pref, windKn: 20 })!.size
    expect(s('underpowered')).toBeLessThan(s('neutral'))
    expect(s('overpowered')).toBeGreaterThan(s('neutral'))
  })

  it('cannot outrank the level it refines', () => {
    // A beginner who likes being overpowered must still end up on less kite
    // than an advanced rider who likes being underpowered.
    const begOver = suggestKiteSize({ weightKg: 75, level: 'Beginner', pref: 'overpowered', windKn: 20 })!.size
    const advUnder = suggestKiteSize({ weightKg: 75, level: 'Advanced', pref: 'underpowered', windKn: 20 })!.size
    expect(begOver).toBeLessThan(advUnder)
  })

  it('is clamped so advanced + overpowered stays inside the stated range', () => {
    const s = suggestKiteSize({ weightKg: 75, level: 'Advanced', pref: 'overpowered', windKn: 20 })!.size
    expect(s).toBeLessThanOrEqual(12)     // he said 11-12, not 13
    expect(powerFactor('Advanced', 'overpowered')).toBeLessThanOrEqual(1.20)
  })

  it('defaults to neutral rather than refusing when unset', () => {
    const a = suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: 20 })
    const b = suggestKiteSize({ weightKg: 75, level: 'Intermediate', pref: 'neutral', windKn: 20 })
    expect(a!.size).toBe(b!.size)
  })
})

// This is advice that puts a person on the water. Refusing to answer is a
// valid answer; inventing a default body weight is not.
describe('refuses rather than guesses', () => {
  it('says nothing without a weight or a level', () => {
    expect(suggestKiteSize({ weightKg: null, level: 'Intermediate', windKn: 20 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 75, level: null, windKn: 20 })).toBeNull()
    expect(suggestKiteSize({ weightKg: null, level: null, windKn: 20 })).toBeNull()
  })

  it('says nothing for an implausible weight, even if stored somehow', () => {
    expect(suggestKiteSize({ weightKg: 7, level: 'Intermediate', windKn: 20 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 700, level: 'Intermediate', windKn: 20 })).toBeNull()
  })

  it('says nothing outside the wind band', () => {
    expect(suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: MIN_WIND_KN - 1 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: MAX_WIND_KN + 1 })).toBeNull()
    expect(suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: NaN })).toBeNull()
  })

  it('says nothing for a level it does not know', () => {
    expect(suggestKiteSize({ weightKg: 75, level: 'Expert' as any, windKn: 20 })).toBeNull()
  })
})

describe('the number is usable', () => {
  it('lands on a size people actually own', () => {
    for (const w of [55, 65, 75, 85, 95]) for (const kn of [15, 18, 22, 28, 34]) {
      const r = suggestKiteSize({ weightKg: w, level: 'Intermediate', windKn: kn })
      if (r) expect(QUIVER_SIZES).toContain(r.size)
    }
  })

  it('keeps the unrounded value, so the UI can show how close a call it was', () => {
    const r = suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: 20 })!
    expect(r.exact).toBeCloseTo(10, 1)
  })
})

// Snapping only makes sense inside the quiver. An 80 kg rider who likes being
// overpowered computes 18.3 m at 14 kn; answering "14 m" is not advice, it is
// the largest number in the list pretending to be advice — and 14 m in 14 kn
// for someone who wanted 18 is a materially different session.
describe('outside the quiver it caps, and says that it capped', () => {
  // Snapping 17.1 silently to 14 is a lie. Returning null is a shrug that
  // removes the number the rider opened the card for. Capping with a marker
  // is the only option that is both true and useful.
  it('caps at the top and flags it, rather than pretending', () => {
    const r = suggestKiteSize({ weightKg: 80, level: 'Advanced', pref: 'overpowered', windKn: 15 })!
    expect(r.size).toBe(14)
    expect(r.limit).toBe('over')
    expect(r.exact).toBeGreaterThan(14)   // the honest number survives for the tooltip
  })

  it('caps at the bottom the same way', () => {
    const r = suggestKiteSize({ weightKg: 45, level: 'Beginner', pref: 'underpowered', windKn: 40 })
    if (r) { expect(r.size).toBe(5); expect(r.limit).toBe('under') }
  })

  it('marks nothing when the size lands inside the quiver', () => {
    const r = suggestKiteSize({ weightKg: 75, level: 'Intermediate', windKn: 20 })!
    expect(r.size).toBe(10)
    expect(r.limit).toBeNull()
  })

  it('still shows a size in the case that prompted this', () => {
    // Oesterdam, 15 kn, the profile on the screenshot. Before: a bare "14 m",
    // silently 3 m off. After the first attempt: nothing at all, which was
    // worse. Now: 14 m flagged as the top of the range.
    const r = suggestKiteSize({ weightKg: 80, level: 'Advanced', pref: 'overpowered', windKn: 15 })
    expect(r).not.toBeNull()
    expect(r!.limit).toBe('over')
  })
})

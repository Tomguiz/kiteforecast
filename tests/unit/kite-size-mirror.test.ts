import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  KITE_SIZE_K, QUIVER_SIZES, MIN_WIND_KN, MAX_WIND_KN, powerFactor,
} from '../../supabase/functions/_shared/kite-size.ts'

// index.html is a plain script and cannot import the shared module, so the
// formula exists twice — the same bargain WIND_DIR_TOLERANCE_DEG already
// makes. That is only safe if something notices when the copies drift, which
// is what this file is. Change one, this fails until you change the other.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

const num = (name: string) => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`))
  if (!m) throw new Error(`${name} not found in index.html`)
  return parseFloat(m[1])
}

describe('the two copies of the kite-size formula agree', () => {
  it('same constant', () => {
    expect(num('KITE_SIZE_K')).toBeCloseTo(KITE_SIZE_K, 4)
  })

  it('same quiver', () => {
    const m = html.match(/const QUIVER_SIZES\s*=\s*\[([^\]]+)\]/)!
    expect(m[1].split(',').map(s => parseInt(s.trim(), 10))).toEqual(QUIVER_SIZES)
  })

  it('same wind band', () => {
    expect(num('KITE_MIN_WIND_KN')).toBe(MIN_WIND_KN)
    expect(num('KITE_MAX_WIND_KN')).toBe(MAX_WIND_KN)
  })

  it('same level and preference factors, and the same clamp', () => {
    const lv = html.match(/const _LEVEL_FACTOR\s*=\s*\{([^}]+)\}/)![1]
    const pf = html.match(/const _PREF_FACTOR\s*=\s*\{([^}]+)\}/)![1]
    const parse = (s: string) => Object.fromEntries(
      s.split(',').map(p => { const [k, v] = p.split(':'); return [k.trim(), parseFloat(v)] }))
    const L = parse(lv), P = parse(pf)

    // Rebuild the client's factor from the parsed numbers and compare it to
    // the module's, across every combination — this catches a changed clamp
    // as well as a changed factor.
    for (const level of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const pref of ['underpowered', 'neutral', 'overpowered'] as const) {
        const client = Math.min(1.20, Math.max(0.85, L[level] * P[pref]))
        expect(client).toBeCloseTo(powerFactor(level, pref), 6)
      }
  })
})

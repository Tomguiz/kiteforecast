import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  QUIVER_SIZES, WIND_BANDS, REF_WEIGHT_KG, MIN_WIND_KN, MAX_WIND_KN, riderScale,
  GUST_NORMAL_RATIO, GUST_EXCESS_WEIGHT,
} from '../../supabase/functions/_shared/kite-size.ts'

// index.html is a plain script and cannot import the shared module, so the
// model exists twice — the same bargain WIND_DIR_TOLERANCE_DEG makes. That is
// only safe if something notices when the copies drift. Change one, this fails
// until you change the other.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const num = (name: string) => {
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`))
  if (!m) throw new Error(`${name} not found in index.html`)
  return parseFloat(m[1])
}

describe('the two copies of the kite-size model agree', () => {
  it('same quiver and reference weight', () => {
    const q = html.match(/const QUIVER_SIZES\s*=\s*\[([^\]]+)\]/)![1]
    expect(q.split(',').map(s => parseInt(s.trim(), 10))).toEqual(QUIVER_SIZES)
    expect(num('REF_WEIGHT_KG')).toBe(REF_WEIGHT_KG)
  })

  it('same gust handling — the whole point of it is that it is not a guess', () => {
    expect(num('GUST_NORMAL_RATIO')).toBe(GUST_NORMAL_RATIO)
    expect(num('GUST_EXCESS_WEIGHT')).toBe(GUST_EXCESS_WEIGHT)
  })

  it('same wind band', () => {
    expect(num('KITE_MIN_WIND_KN')).toBe(MIN_WIND_KN)
    expect(num('KITE_MAX_WIND_KN')).toBe(MAX_WIND_KN)
  })

  it('same bands — the thresholds ARE the model', () => {
    const raw = html.match(/const WIND_BANDS\s*=\s*\[([^\]]+)\]/)![1]
    const got = [...raw.matchAll(/maxKn:\s*([\d.]+|Infinity)\s*,\s*refSize:\s*(\d+)/g)]
      .map(m => ({ maxKn: m[1] === 'Infinity' ? Infinity : parseFloat(m[1]), refSize: parseInt(m[2], 10) }))
    expect(got).toEqual(WIND_BANDS.map(b => ({ maxKn: b.maxKn, refSize: b.refSize })))
  })

  it('same level and preference scaling, across every combination', () => {
    const parse = (name: string) => {
      const body = html.match(new RegExp(`const ${name}\\s*=\\s*\\{([^}]+)\\}`))![1]
      return Object.fromEntries(body.split(',').map(p => {
        const [k, v] = p.split(':'); return [k.trim(), parseFloat(v)]
      }))
    }
    const L = parse('_LEVEL_REL'), P = parse('_PREF_REL')
    for (const level of ['Beginner', 'Intermediate', 'Advanced'] as const)
      for (const pref of ['underpowered', 'neutral', 'overpowered'] as const)
        for (const w of [55, 80, 95]) {
          const client = (w / num('REF_WEIGHT_KG')) * L[level] * P[pref]
          expect(client).toBeCloseTo(riderScale(w, level, pref), 6)
        }
  })
})

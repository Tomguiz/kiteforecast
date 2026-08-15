import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSpotsArray, toSeedSql } from '../tools/generate-spots-seed.mjs'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('spots catalogue', () => {
  it('parses every spot out of index.html', () => {
    const spots = parseSpotsArray(html)
    expect(spots.length).toBeGreaterThan(300)
    for (const s of spots) {
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(Number.isFinite(s.lat)).toBe(true)
      expect(Number.isFinite(s.lon)).toBe(true)
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90)
      expect(Math.abs(s.lon)).toBeLessThanOrEqual(180)
    }
  })

  it('has no duplicate spot names (name is the table primary key)', () => {
    const names = parseSpotsArray(html).map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  // The committed seed must match the array. If someone edits SPOTS without
  // regenerating, this fails — that drift is the whole risk of having two copies.
  it('committed seed-spots.sql is up to date with the array', () => {
    const seed = readFileSync(new URL('../../supabase/seed-spots.sql', import.meta.url), 'utf8')
    expect(seed).toBe(toSeedSql(parseSpotsArray(html)))
  })

  it('escapes apostrophes in spot names', () => {
    const sql = toSeedSql([{ name: "L'Almanarre", loc: 'Hyères', lat: 43.09, lon: 6.15, dirs: [90] }])
    expect(sql).toContain("'L''Almanarre'")
  })
})

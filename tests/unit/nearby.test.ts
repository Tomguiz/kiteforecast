import { describe, it, expect } from 'vitest'
import { haversineKm, selectNearbySpots } from '../../supabase/functions/_shared/nearby.ts'

const spot = (name: string, lat: number, lon: number) =>
  ({ name, loc: 'x', lat, lon, dirs: [270] })

// Knokke-Heist, Belgium
const HOME = { lat: 51.3500, lon: 3.2800 }

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(51.35, 3.28, 51.35, 3.28)).toBe(0)
  })

  it('matches a known distance (Knokke → Oostduinkerke ≈ 45km)', () => {
    const d = haversineKm(51.3500, 3.2800, 51.1420, 2.6976)
    expect(d).toBeGreaterThan(40)
    expect(d).toBeLessThan(50)
  })

  it('is symmetric', () => {
    const a = haversineKm(51.35, 3.28, 43.09, 6.15)
    const b = haversineKm(43.09, 6.15, 51.35, 3.28)
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
  })

  it('is finite for near-antipodal points (~180° apart)', () => {
    const d = haversineKm(0, 0, 0.0001, 179.9999)
    expect(Number.isFinite(d)).toBe(true)
  })
})

describe('selectNearbySpots', () => {
  const spots = [
    spot('Near1',  51.36, 3.30),   // ~2km
    spot('Near2',  51.14, 2.70),   // ~45km
    spot('Mid',    50.80, 3.20),   // ~62km
    spot('Far',    43.09, 6.15),   // ~1000km
  ]

  it('keeps only spots inside the radius', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2', 'Mid'])
  })

  it('sorts by distance ascending and reports the distance', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(selected[0].name).toBe('Near1')
    expect(selected[0].distanceKm).toBeLessThan(selected[1].distanceKm)
    expect(Number.isFinite(selected[0].distanceKm)).toBe(true)
  })

  it('excludes spots the user already favourites', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [{ name: 'Near1', lat: 51.36, lon: 3.30 }], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near2', 'Mid'])
  })

  it('caps at the limit and reports how many it dropped', () => {
    const { selected, droppedByCap } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 2 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2'])
    expect(droppedByCap).toBe(1)
  })

  it('reports zero dropped when everything fits', () => {
    const { droppedByCap } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [], limit: 10 })
    expect(droppedByCap).toBe(0)
  })

  it('returns nothing when no spot is in range', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 1, exclude: [], limit: 10 })
    expect(selected).toEqual([])
  })

  it('matches excluded names exactly, not by prefix', () => {
    const { selected } = selectNearbySpots(spots, HOME, { radiusKm: 120, exclude: [{ name: 'Near', lat: 51.36, lon: 3.30 }], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near1', 'Near2', 'Mid'])
  })

  it('excludes a favourite that matches by name and position', () => {
    const { selected } = selectNearbySpots(spots, HOME,
      { radiusKm: 120, exclude: [{ name: 'Near1', lat: 51.36, lon: 3.30 }], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Near2', 'Mid'])
  })

  it('does NOT exclude a same-named spot on the other side of the world', () => {
    // Favouriting Queensland's 'Surfers Paradise' must not hide the Belgian one.
    const catalogue = [spot('Surfers Paradise', 51.1150, 2.6350)]
    const { selected } = selectNearbySpots(catalogue, HOME,
      { radiusKm: 120, exclude: [{ name: 'Surfers Paradise', lat: -28.0022, lon: 153.4309 }], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Surfers Paradise'])
  })

  it('tolerates small coordinate drift between a favourite and the catalogue row', () => {
    const { selected } = selectNearbySpots(spots, HOME,
      { radiusKm: 120, exclude: [{ name: 'Near1', lat: 51.365, lon: 3.305 }], limit: 10 })
    expect(selected.map(s => s.name)).not.toContain('Near1')
  })
})

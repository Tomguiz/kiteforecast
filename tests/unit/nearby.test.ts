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

  it('is finite for antipodal points where floating-point error pushes h above 1', () => {
    // These specific coordinates produce h = 1.0000000000000004 in the haversine
    // intermediate, and critically Math.sqrt(h) itself still rounds to a value
    // strictly greater than 1 (1.0000000000000002) rather than rounding back down
    // to 1 — verified directly against this project's Node runtime, since nearby
    // near-antipodal pairs round back to sqrt(h) === 1 and don't actually exercise
    // the guard. Without the Math.min(1, ...) clamp, Math.asin receives a value
    // outside its domain and returns NaN. Do not "simplify" these numbers — most
    // near-antipodal pairs would pass with the clamp removed.
    const d = haversineKm(-51.97962031476099, 160.89394411720957, 51.97962018640434, -19.106056096629914)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThan(19000) // ~half the Earth's circumference
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

  it('does not exclude a same-named spot beyond SAME_SPOT_KM', () => {
    // ~11 km from Near1 (51.36, 3.30) — same name, too far to be the same spot.
    const { selected } = selectNearbySpots(spots, HOME,
      { radiusKm: 120, exclude: [{ name: 'Near1', lat: 51.46, lon: 3.30 }], limit: 10 })
    expect(selected.map(s => s.name)).toContain('Near1')
  })
})

import { minHoursForDistance, rankNearbySpots } from '../../supabase/functions/_shared/nearby.ts'

const rankable = (name: string, distanceKm: number, peakKn: number, totalHours: number) =>
  ({ name, distanceKm, peakKn, totalHours })

describe('minHoursForDistance', () => {
  it('asks only for the session floor when the spot is close', () => {
    expect(minHoursForDistance(0)).toBe(2)
    expect(minHoursForDistance(49)).toBe(2)
  })

  it('asks for an extra hour per 50km', () => {
    expect(minHoursForDistance(50)).toBe(3)
    expect(minHoursForDistance(100)).toBe(4)
    expect(minHoursForDistance(150)).toBe(5)
  })
})

describe('rankNearbySpots', () => {
  it('drops a far spot that only offers a short window', () => {
    // 2 rideable hours is worth 15km and not worth 120km.
    const { selected, droppedAsNotWorthTheDrive } = rankNearbySpots([
      rankable('Close', 15, 20, 2),
      rankable('Far', 120, 30, 2),
    ], 5)
    expect(selected.map(s => s.name)).toEqual(['Close'])
    expect(droppedAsNotWorthTheDrive).toBe(1)
  })

  it('keeps a far spot when the session is long enough to justify it', () => {
    const { selected } = rankNearbySpots([rankable('Far', 120, 30, 4)], 5)
    expect(selected.map(s => s.name)).toEqual(['Far'])
  })

  it('ranks by peak wind first', () => {
    const { selected } = rankNearbySpots([
      rankable('Breezy', 10, 18, 6),
      rankable('Windy',  10, 28, 3),
    ], 5)
    expect(selected.map(s => s.name)).toEqual(['Windy', 'Breezy'])
  })

  it('breaks a peak-wind tie on total rideable hours', () => {
    const { selected } = rankNearbySpots([
      rankable('Short', 10, 25, 3),
      rankable('Long',  10, 25, 7),
    ], 5)
    expect(selected.map(s => s.name)).toEqual(['Long', 'Short'])
  })

  it('breaks a full tie on distance', () => {
    const { selected } = rankNearbySpots([
      rankable('Further', 40, 25, 4),
      rankable('Nearer',  12, 25, 4),
    ], 5)
    expect(selected.map(s => s.name)).toEqual(['Nearer', 'Further'])
  })

  it('caps at the limit and reports what it cut', () => {
    const spots = [1,2,3,4,5,6,7].map(i => rankable(`S${i}`, 10, 30 - i, 5))
    const { selected, droppedByLimit } = rankNearbySpots(spots, 5)
    expect(selected).toHaveLength(5)
    expect(droppedByLimit).toBe(2)
    expect(selected.map(s => s.name)).toEqual(['S1','S2','S3','S4','S5'])
  })

  it('counts the drive gate before the limit, not after', () => {
    // 6 spots, 2 unworthy -> 4 worthy, so the limit cuts nothing.
    const { droppedAsNotWorthTheDrive, droppedByLimit } = rankNearbySpots([
      rankable('A', 10, 25, 4), rankable('B', 10, 24, 4),
      rankable('C', 10, 23, 4), rankable('D', 10, 22, 4),
      rankable('E', 200, 30, 2), rankable('F', 200, 29, 2),
    ], 5)
    expect(droppedAsNotWorthTheDrive).toBe(2)
    expect(droppedByLimit).toBe(0)
  })

  it('handles an empty list', () => {
    const { selected, droppedAsNotWorthTheDrive, droppedByLimit } = rankNearbySpots([], 5)
    expect(selected).toEqual([])
    expect(droppedAsNotWorthTheDrive).toBe(0)
    expect(droppedByLimit).toBe(0)
  })
})

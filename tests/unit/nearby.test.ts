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

// bestSessionHours defaults to totalHours so existing single-session-style
// callers below are unaffected; pass it explicitly to model a spot whose week
// total is padded out by several short, separate sessions.
const rankable = (name: string, distanceKm: number, peakKn: number, totalHours: number, bestSessionHours: number = totalHours) =>
  ({ name, distanceKm, peakKn, totalHours, bestSessionHours })

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

  it('drops a far spot whose week total clears the gate only by summing several short sessions', () => {
    // 130km needs 4h (the gate). Three separate 2h sessions sum to a 6h week
    // total, which would wrongly clear the gate — but each one alone is still
    // just a 2h session at the end of a 260km round trip, exactly the case
    // the gate exists to prevent. The gate must look at the best SINGLE
    // session (2h), not the week total (6h).
    const { selected, droppedAsNotWorthTheDrive } = rankNearbySpots([
      rankable('FarSplit', 130, 25, 6, 2),
    ], 5)
    expect(selected).toEqual([])
    expect(droppedAsNotWorthTheDrive).toBe(1)
  })

  it('keeps a far spot whose single best session (not the week total) clears the gate', () => {
    // 130km needs 4h. A single 5h session clears the gate even though other
    // shorter sessions elsewhere in the week would not have on their own.
    const { selected } = rankNearbySpots([
      rankable('FarLong', 130, 25, 5, 5),
    ], 5)
    expect(selected.map(s => s.name)).toEqual(['FarLong'])
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

describe('selectNearbySpots — geographic spread', () => {
  // Spots a few km apart share an Open-Meteo grid cell, so they share a
  // forecast. Suggesting several of them is padding, not choice.
  const HOME2 = { lat: 50.7175, lon: 4.3978 }  // Waterloo, inland
  const coast = (name: string, lat: number, lon: number) =>
    ({ name, loc: 'coast', lat, lon, dirs: [270] })

  it('keeps only one spot from a tight cluster', () => {
    // Heist / Zeebrugge / Duinbergen sit within ~8km of each other.
    const spots = [
      coast('Heist',      51.3400, 3.2400),
      coast('Duinbergen', 51.3468, 3.2660),
      coast('Zeebrugge',  51.3300, 3.2000),
    ]
    const { selected, droppedAsTooClose } = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 10 })
    expect(selected).toHaveLength(1)
    expect(droppedAsTooClose).toBe(2)
  })

  it('keeps the nearest member of each cluster', () => {
    // Verified against haversineKm from Waterloo: 104.9km vs 106.5km. The
    // greedy walk is nearest-first, so the closer one represents the cluster.
    const spots = [
      coast('Further', 51.3400, 3.2400),  // 106.5km
      coast('Nearer',  51.3600, 3.3000),  // 104.9km
    ]
    const { selected } = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 10 })
    expect(selected.map(s => s.name)).toEqual(['Nearer'])
  })

  it('keeps spots that are genuinely far apart', () => {
    // De Panne and Knokke are opposite ends of the Belgian coast (~60km).
    const spots = [
      coast('Knokke',  51.3500, 3.2900),
      coast('DePanne', 51.0980, 2.5900),
    ]
    const { selected, droppedAsTooClose } = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 10 })
    expect(selected).toHaveLength(2)
    expect(droppedAsTooClose).toBe(0)
  })

  it('honours an explicit minSeparationKm', () => {
    const spots = [
      coast('A', 51.3400, 3.2400),
      coast('B', 51.3468, 3.2660),
    ]
    const tight = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 10, minSeparationKm: 1 })
    expect(tight.selected).toHaveLength(2)
    const wide = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 10, minSeparationKm: 50 })
    expect(wide.selected).toHaveLength(1)
  })

  it('counts the cap over spread spots, not raw in-range ones', () => {
    // 3 clustered + 2 distant, limit 2 -> spread yields 3, cap drops 1.
    const spots = [
      coast('C1', 51.3400, 3.2400),
      coast('C2', 51.3468, 3.2660),
      coast('C3', 51.3300, 3.2000),
      // Verified with haversineKm: D1<->D2 30.1km, D2<->nearest cluster 31.5km,
      // so all three survive the spread and only the limit cuts one.
      coast('D1', 51.0500, 2.4500),
      coast('D2', 51.1500, 2.8500)
    ]
    const { selected, droppedAsTooClose, droppedByCap } = selectNearbySpots(spots, HOME2,
      { radiusKm: 200, exclude: [], limit: 2 })
    expect(droppedAsTooClose).toBe(2)
    expect(selected).toHaveLength(2)
    expect(droppedByCap).toBe(1)
  })
})

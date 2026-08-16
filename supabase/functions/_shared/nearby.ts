// Spot selection for the digest's "near you" section.
// Pure: no DB, no network — so it is unit-testable without deploying.

export interface CatalogueSpot {
  name: string; loc: string; lat: number; lon: number; dirs: number[]
}
export interface NearbySpot extends CatalogueSpot { distanceKm: number }

// Favourites are keyed by name, but catalogue names are not unique — two real
// spots are called 'Surfers Paradise' (Koksijde, Belgium and Queensland,
// Australia). Match on name AND proximity so favouriting one does not hide the
// other. 5 km absorbs the coordinate drift the app already handles elsewhere
// (index.html deletes favourites by name AND lat/lon for the same reason),
// while keeping same-named spots on different continents distinct.
export const SAME_SPOT_KM = 5

export interface ExcludedSpot { name: string; lat: number; lon: number }

const R_EARTH_KM = 6371
const rad = (deg: number) => deg * Math.PI / 180

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Two spots a few km apart share an Open-Meteo grid cell (~11km) and therefore
// share a forecast — listing both is padding, not choice. Keep suggestions far
// enough apart that the conditions can genuinely differ. 25km is roughly the
// scale at which coastal wind starts to diverge along a shoreline.
export const MIN_SPOT_SEPARATION_KM = 25

export function selectNearbySpots(
  spots: CatalogueSpot[],
  home: { lat: number; lon: number },
  opts: { radiusKm: number; exclude: ExcludedSpot[]; limit: number; minSeparationKm?: number },
): { selected: NearbySpot[]; droppedByCap: number; droppedAsTooClose: number } {
  const isExcluded = (s: CatalogueSpot) =>
    opts.exclude.some(e => e.name === s.name && haversineKm(e.lat, e.lon, s.lat, s.lon) <= SAME_SPOT_KM)

  const inRange = spots
    .filter(s => !isExcluded(s))
    .map(s => ({ ...s, distanceKm: haversineKm(home.lat, home.lon, s.lat, s.lon) }))
    .filter(s => s.distanceKm <= opts.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  // Greedy spread: walk nearest-first and keep a spot only when it is far
  // enough from everything already kept. Nearest-first means the closest
  // representative of each area wins, so spreading never costs extra travel.
  const sep = opts.minSeparationKm ?? MIN_SPOT_SEPARATION_KM
  const spread: NearbySpot[] = []
  for (const s of inRange) {
    if (spread.every(k => haversineKm(k.lat, k.lon, s.lat, s.lon) >= sep)) spread.push(s)
  }

  return {
    selected: spread.slice(0, opts.limit),
    droppedAsTooClose: inRange.length - spread.length,
    droppedByCap: Math.max(0, spread.length - opts.limit),
  }
}

// A long drive has to buy its way in. Two rideable hours is a fine reason to
// pop down the road and a poor reason to cross the country, so the minimum
// session length scales with distance: the 2-hour session floor, plus an hour
// for every 50km travelled.
export const DRIVE_FLOOR_HOURS = 2
export const KM_PER_EXTRA_HOUR = 50

export function minHoursForDistance(distanceKm: number): number {
  return DRIVE_FLOOR_HOURS + Math.floor(distanceKm / KM_PER_EXTRA_HOUR)
}

export interface RankableSpot { distanceKm: number; peakKn: number; bestSessionHours: number; totalHours: number }

// Peak wind first (it is what makes a session memorable), then total rideable
// hours (a spot you can ride all afternoon beats a one-hour blip), then
// nearest. Spots that fail the worth-the-drive gate are removed before ranking,
// so the limit never spends a slot on a trip not worth taking.
//
// The gate itself must look at the best SINGLE session, not the week's total.
// totalHours sums every good day in the 7-day window, so a spot 130km away
// with three separate 2-hour sessions sums to 6h and would clear a 4h gate —
// even though it means three 260km round trips for two hours of riding each.
// bestSessionHours (the longest contiguous window at that spot) is what
// actually answers "is this one trip worth the drive". totalHours remains a
// ranking tiebreak afterwards: among spots that already cleared the gate, one
// you can ride all week still beats a one-off.
export function rankNearbySpots<T extends RankableSpot>(
  spots: T[], limit: number,
): { selected: T[]; droppedAsNotWorthTheDrive: number; droppedByLimit: number } {
  const worth = spots.filter(s => s.bestSessionHours >= minHoursForDistance(s.distanceKm))
  worth.sort((a, b) =>
    (b.peakKn - a.peakKn) ||
    (b.totalHours - a.totalHours) ||
    (a.distanceKm - b.distanceKm))
  return {
    selected: worth.slice(0, limit),
    droppedAsNotWorthTheDrive: spots.length - worth.length,
    droppedByLimit: Math.max(0, worth.length - limit),
  }
}

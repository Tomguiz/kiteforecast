// Spot selection for the digest's "near you" section.
// Pure: no DB, no network — so it is unit-testable without deploying.

export interface CatalogueSpot {
  name: string; loc: string; lat: number; lon: number; dirs: number[]
}
export interface NearbySpot extends CatalogueSpot { distanceKm: number }

const R_EARTH_KM = 6371
const rad = (deg: number) => deg * Math.PI / 180

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function selectNearbySpots(
  spots: CatalogueSpot[],
  home: { lat: number; lon: number },
  opts: { radiusKm: number; exclude: string[]; limit: number },
): { selected: NearbySpot[]; droppedByCap: number } {
  const excluded = new Set(opts.exclude)
  const inRange = spots
    .filter(s => !excluded.has(s.name))
    .map(s => ({ ...s, distanceKm: haversineKm(home.lat, home.lon, s.lat, s.lon) }))
    .filter(s => s.distanceKm <= opts.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  return {
    selected: inRange.slice(0, opts.limit),
    droppedByCap: Math.max(0, inRange.length - opts.limit),
  }
}

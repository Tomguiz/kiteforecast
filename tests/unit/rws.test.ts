import { describe, it, expect } from 'vitest'
import {
  parseFeed, mergeFeeds, nearestStation, toLiveWind, viewerUrl,
  RWS_MAX_KM, RWS_MAX_AGE_MIN, type RwsStation,
} from '../../supabase/functions/_shared/rws.ts'

// Captured from the live API on 2026-08-16. locationName carries the raw
// tab-separated source row for some stations and a plain name for others —
// both shapes appear in production, so both are covered here.
const speedFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2 \t,3.621747\t,51.766527\t,Brouwershavense Gat 2',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 4.78 }] } },
    { geometry: { coordinates: [3.37906, 51.37989] },
      properties: { id: 'CAWI', locationName: 'CAWI \t,3.37906\t,51.37989\t,Cadzand wind',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.01 }] } },
    { geometry: { coordinates: [3.8593, 51.544] },
      properties: { id: 'KATS', locationName: 'Kats wind (Zandkreeksluis VM zijde)',
        events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 4.2 }] } },
  ],
}
const dirFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 350.8 }] } },
    { geometry: { coordinates: [3.37906, 51.37989] },
      properties: { id: 'CAWI', locationName: 'CAWI', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 339.4 }] } },
  ],
}
// The gust feed covers a different station set (48 vs 37 live) — BG2 only.
const gustFeed = {
  features: [
    { geometry: { coordinates: [3.621747, 51.766527] },
      properties: { id: 'BG2', locationName: 'BG2', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.77 }] } },
  ],
}

const NOW = new Date('2026-08-16T12:34:00Z')
const stations = () => mergeFeeds(parseFeed(speedFeed), parseFeed(dirFeed), parseFeed(gustFeed))

// Brouwersdam, the spot BG2 serves
const BROUWERSDAM = { lat: 51.7629, lon: 3.6217 }
// Cadzand Bad, ~1km from the CAWI mast
const CADZAND = { lat: 51.3722, lon: 3.3706 }

describe('parseFeed', () => {
  it('extracts the human-readable name from the tab-separated locationName', () => {
    const m = parseFeed(speedFeed)
    expect(m.get('BG2')!.name).toBe('Brouwershavense Gat 2')
  })

  it('keeps a plain locationName unchanged', () => {
    const m = parseFeed(speedFeed)
    expect(m.get('KATS')!.name).toBe('Kats wind (Zandkreeksluis VM zijde)')
  })

  it('reads coordinates as [lon, lat] GeoJSON order', () => {
    const s = parseFeed(speedFeed).get('CAWI')!
    expect(s.lat).toBeCloseTo(51.37989, 4)
    expect(s.lon).toBeCloseTo(3.37906, 4)
  })

  it('returns an empty map for a malformed payload', () => {
    expect(parseFeed({}).size).toBe(0)
    expect(parseFeed(null).size).toBe(0)
    expect(parseFeed({ features: [{ properties: {} }] }).size).toBe(0)
  })

  it('yields a null value when events is empty', () => {
    const f = { features: [{ geometry: { coordinates: [3, 51] },
      properties: { id: 'X', locationName: 'X', events: [] } }] }
    expect(parseFeed(f).get('X')!.value).toBeNull()
  })
})

describe('mergeFeeds', () => {
  it('joins speed, direction and gust by station id', () => {
    const bg2 = stations().find(s => s.id === 'BG2')!
    expect(bg2.speedMs).toBe(4.78)
    expect(bg2.dirDeg).toBe(350.8)
    expect(bg2.gustMs).toBe(5.77)
  })

  it('leaves gust null for a station missing from the gust feed', () => {
    const cawi = stations().find(s => s.id === 'CAWI')!
    expect(cawi.gustMs).toBeNull()
  })

  it('leaves direction null for a station missing from the direction feed', () => {
    const kats = stations().find(s => s.id === 'KATS')!
    expect(kats.dirDeg).toBeNull()
  })

  it('is driven by the speed feed — no speed means no station', () => {
    expect(stations().map(s => s.id).sort()).toEqual(['BG2', 'CAWI', 'KATS'])
  })
})

describe('nearestStation', () => {
  it('picks the closest station', () => {
    const hit = nearestStation(stations(), BROUWERSDAM.lat, BROUWERSDAM.lon)!
    expect(hit.station.id).toBe('BG2')
    expect(hit.distanceKm).toBeLessThan(2)
  })

  it('matches Cadzand Bad to its mast about 1km away', () => {
    const hit = nearestStation(stations(), CADZAND.lat, CADZAND.lon)!
    expect(hit.station.id).toBe('CAWI')
    expect(hit.distanceKm).toBeLessThan(2)
  })

  it('returns null when everything is beyond the cap', () => {
    // Kite Beach Maui — nothing within 30km, or 10000km
    expect(nearestStation(stations(), 20.9, -156.4)).toBeNull()
  })

  it('respects an explicit maxKm', () => {
    expect(nearestStation(stations(), BROUWERSDAM.lat, BROUWERSDAM.lon, 0.1)).toBeNull()
  })

  it('returns null for an empty station list', () => {
    expect(nearestStation([], BROUWERSDAM.lat, BROUWERSDAM.lon)).toBeNull()
  })
})

describe('toLiveWind', () => {
  const withTs = (ts: string | null, speedMs: number | null = 5.0): RwsStation =>
    ({ id: 'BG2', name: 'Brouwershavense Gat 2', lat: 51.766527, lon: 3.621747,
       speedMs, dirDeg: 350.8, gustMs: 5.77, ts })

  it('converts m/s to knots', () => {
    const lw = toLiveWind(withTs('2026-08-16T12:30:00Z', 5.0), 1.2, NOW)!
    expect(lw.speedKn).toBe(10)   // 5.0 * 1.94384 = 9.72 -> 10
    expect(lw.gustKn).toBe(11)    // 5.77 * 1.94384 = 11.2 -> 11
  })

  it('reports the reading age in minutes', () => {
    expect(toLiveWind(withTs('2026-08-16T12:30:00Z'), 1.2, NOW)!.ageMin).toBe(4)
  })

  it('accepts a reading 29 minutes old', () => {
    expect(toLiveWind(withTs('2026-08-16T12:05:00Z'), 1.2, NOW)).not.toBeNull()
  })

  it('rejects a reading older than the age cap', () => {
    expect(toLiveWind(withTs('2026-08-16T11:00:00Z'), 1.2, NOW)).toBeNull()
  })

  it('rejects a station with no speed reading', () => {
    expect(toLiveWind(withTs('2026-08-16T12:30:00Z', null), 1.2, NOW)).toBeNull()
  })

  it('rejects a station with no timestamp', () => {
    expect(toLiveWind(withTs(null), 1.2, NOW)).toBeNull()
  })

  it('rejects an unparseable timestamp rather than throwing', () => {
    expect(toLiveWind(withTs('not-a-date'), 1.2, NOW)).toBeNull()
  })

  it('keeps gust null rather than throwing when absent', () => {
    const st = { ...withTs('2026-08-16T12:30:00Z'), gustMs: null }
    expect(toLiveWind(st, 1.2, NOW)!.gustKn).toBeNull()
  })

  it('carries the station identity, distance and viewer url through', () => {
    const lw = toLiveWind(withTs('2026-08-16T12:30:00Z'), 1.23, NOW)!
    expect(lw.stationId).toBe('BG2')
    expect(lw.stationName).toBe('Brouwershavense Gat 2')
    expect(lw.distanceKm).toBeCloseTo(1.23, 2)
    expect(lw.viewerUrl).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/BG2')
  })
})

describe('viewerUrl', () => {
  it('builds the per-station RWSOS deep link', () => {
    expect(viewerUrl('CAWI')).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/CAWI')
  })

  it('encodes an id with unexpected characters', () => {
    expect(viewerUrl('A B')).toBe('https://rwsos.rws.nl/viewer/map/noordzee/meteo/location/A%20B')
  })
})

describe('constants', () => {
  it('matches the spec thresholds', () => {
    expect(RWS_MAX_KM).toBe(30)
    expect(RWS_MAX_AGE_MIN).toBe(30)
  })
})

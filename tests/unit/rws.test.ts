import { describe, it, expect } from 'vitest'
import {
  FIRING_MIN_KN,
  parseFeed, mergeFeeds, nearestStation, toLiveWind, viewerUrl,
  RWS_MAX_KM, RWS_MAX_AGE_MIN, RWS_MAX_FUTURE_MIN, type RwsStation,
  fetchStations, liveWindFor, type FetchLike, isFiringNow,
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
const BROUWERSDAM = { lat: 51.7629, lon: 3.8512 }
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

  it('skips a feature with non-numeric string coordinates', () => {
    const f = { features: [{ geometry: { coordinates: ['not', 'numbers'] },
      properties: { id: 'BAD', locationName: 'Bad', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.0 }] } }] }
    expect(parseFeed(f).size).toBe(0)
  })

  it('skips a feature with null or NaN coordinate elements', () => {
    const f = { features: [{ geometry: { coordinates: [null, 51] },
      properties: { id: 'BAD', locationName: 'Bad', events: [{ timeStamp: '2026-08-16T12:30:00Z', value: 5.0 }] } }] }
    expect(parseFeed(f).size).toBe(0)
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
    // The real Brouwersdam spot is ~15.8km from its mast — well inside the
    // 30km cap, and the reason that cap exists. Most spots have no mast on top.
    expect(hit.distanceKm).toBeGreaterThan(14)
    expect(hit.distanceKm).toBeLessThan(17)
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

  it('ignores malformed stations with NaN coordinates', () => {
    // A malformed station occurring first would become best if not filtered out.
    // This test proves parseFeed catches the malformation, but also tests
    // the layer here: ensure a valid station is selected even if a malformed
    // entry somehow made it through.
    const malformed: RwsStation = {
      id: 'BROKEN', name: 'Broken', lat: NaN, lon: NaN,
      speedMs: 5.0, dirDeg: 350, gustMs: 5.0, ts: '2026-08-16T12:30:00Z',
    }
    const valid: RwsStation = stations().find(s => s.id === 'CAWI')!
    const mixedList = [malformed, valid]
    const hit = nearestStation(mixedList, CADZAND.lat, CADZAND.lon)!
    expect(hit.station.id).toBe('CAWI')
    expect(hit.distanceKm).toBeLessThan(2)
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

  // The age gate is two-sided. With an upper bound only, a future timestamp
  // sails through and then hits `ageMin <= 1 -> 'just now'` in both renderers,
  // so the most broken reading displays as the freshest one. The realistic
  // trigger is a timeStamp missing its timezone designator: the browser parses
  // the bare ISO form as LOCAL time, so a Dutch user in CEST sees every reading
  // 2h in the future, permanently "just now", permanently wrong.
  it('rejects a reading timestamped hours in the future', () => {
    // NOW is 12:34Z; a CEST-misparsed 12:30 reading lands at 14:30 -> -116 min.
    expect(toLiveWind(withTs('2026-08-16T14:30:00Z'), 1.2, NOW)).toBeNull()
  })

  it('accepts small negative skew inside the future tolerance', () => {
    // 2 minutes ahead: ageMin === -2, the boundary, still accepted.
    expect(toLiveWind(withTs('2026-08-16T12:36:00Z'), 1.2, NOW)!.ageMin).toBe(-2)
  })

  it('rejects a reading just past the future tolerance', () => {
    // 3 minutes ahead: ageMin === -3, one minute beyond the boundary.
    expect(toLiveWind(withTs('2026-08-16T12:37:00Z'), 1.2, NOW)).toBeNull()
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
    expect(RWS_MAX_FUTURE_MIN).toBe(2)
  })
})

const feedFor = (url: string) =>
  url.includes('WS10MXS3') ? gustFeed : url.includes('WR1') ? dirFeed : speedFeed

const okFetch: FetchLike = async (url) => ({ ok: true, json: async () => feedFor(url) })

describe('fetchStations', () => {
  it('requests all three feeds and merges them', async () => {
    const seen: string[] = []
    const spy: FetchLike = async (url) => { seen.push(url); return { ok: true, json: async () => feedFor(url) } }
    const sts = await fetchStations(spy)
    expect(seen.length).toBe(3)
    expect(seen.some(u => u.includes('observationTypeId=WS1&'))).toBe(true)
    expect(seen.some(u => u.includes('observationTypeId=WR1'))).toBe(true)
    expect(seen.some(u => u.includes('observationTypeId=WS10MXS3'))).toBe(true)
    expect(sts.map(s => s.id).sort()).toEqual(['BG2', 'CAWI', 'KATS'])
  })

  it('sends the bounding box on every request', async () => {
    const seen: string[] = []
    await fetchStations(async (url) => { seen.push(url); return { ok: true, json: async () => feedFor(url) } })
    expect(seen.every(u => u.includes('boundingBox='))).toBe(true)
  })

  it('returns an empty list when the speed feed fails', async () => {
    // 'observationTypeId=WS1&' matches WS1 only — WS10MXS3 has no '&' there.
    const failing: FetchLike = async (url) =>
      url.includes('observationTypeId=WS1&')
        ? { ok: false, json: async () => feedFor(url) }
        : { ok: true, json: async () => feedFor(url) }
    expect(await fetchStations(failing)).toEqual([])
  })

  it('still returns stations when only the optional gust feed fails', async () => {
    const partial: FetchLike = async (url) =>
      url.includes('WS10MXS3')
        ? { ok: false, json: async () => feedFor(url) }
        : { ok: true, json: async () => feedFor(url) }
    const sts = await fetchStations(partial)
    expect(sts.length).toBe(3)
    expect(sts.find(s => s.id === 'BG2')!.gustMs).toBeNull()
  })

  it('returns an empty list rather than throwing when fetch rejects', async () => {
    expect(await fetchStations(async () => { throw new Error('network down') })).toEqual([])
  })
})

describe('liveWindFor', () => {
  it('returns the reading for a covered spot', async () => {
    const lw = await liveWindFor(BROUWERSDAM.lat, BROUWERSDAM.lon, { fetchFn: okFetch, now: NOW })
    expect(lw!.stationId).toBe('BG2')
    expect(lw!.speedKn).toBe(9)   // 4.78 * 1.94384 = 9.29 -> 9
  })

  it('returns null for a spot with no station in range', async () => {
    expect(await liveWindFor(20.9, -156.4, { fetchFn: okFetch, now: NOW })).toBeNull()
  })

  it('returns null rather than throwing when the network fails', async () => {
    const boom: FetchLike = async () => { throw new Error('down') }
    expect(await liveWindFor(BROUWERSDAM.lat, BROUWERSDAM.lon, { fetchFn: boom, now: NOW })).toBeNull()
  })
})

// The "firing now" bubble on the favourites list. Deliberately reuses the
// app's own rideability rule rather than a fresh threshold: speedTier(kn) > 0
// IS 15 knots, and it is what the "good days" badge already means. A spot
// blowing 25 kn from the wrong quarter is not firing, so direction is part of
// the rule — a false "firing" badge is the one that gets someone in the car
// for nothing.
describe('isFiringNow', () => {
  // Cadzand Bad / Knokke: good on W and NW
  const DIRS = [270, 315]

  it('fires at 15 kn from a good direction', () => {
    expect(isFiringNow(15, 270, DIRS)).toBe(true)
  })

  it('does not fire at 14 kn, however good the direction', () => {
    expect(isFiringNow(14, 270, DIRS)).toBe(false)
  })

  it('does not fire at 25 kn from the wrong direction', () => {
    expect(isFiringNow(25, 90, DIRS)).toBe(false)
  })

  // Tolerance is +/-30 deg per good dir. Tested against a SINGLE-dir spot on
  // purpose: with [270,315] the two tolerance bands overlap, so no direction
  // between them can ever be excluded and the boundary would be untestable.
  it('accepts a direction within 30 degrees of a good dir', () => {
    expect(isFiringNow(20, 300, [270])).toBe(true)   // 30 deg off, on the edge
    expect(isFiringNow(20, 301, [270])).toBe(false)  // 31 deg off
  })

  // Riverwoods, live: 23 kn at 250.1 deg on a spot listed [270, 315]. Under
  // the old +/-22.5 rule a swing to 246 deg silently stopped it firing.
  it('fires on the WSW the old tolerance turned away', () => {
    expect(isFiringNow(23, 250.1, [270, 315])).toBe(true)
    expect(isFiringNow(26, 246.3, [270, 315])).toBe(true)
  })

  it('has continuous cover between two good dirs 45 deg apart', () => {
    // The real reason the boundary test above needs a single-dir spot.
    expect(isFiringNow(20, 293, DIRS)).toBe(true)
  })

  it('treats an empty dirs list as "works in any direction"', () => {
    expect(isFiringNow(18, 90, [])).toBe(true)
  })

  it('returns false for a null direction rather than guessing', () => {
    expect(isFiringNow(25, null, DIRS)).toBe(false)
  })

  it('returns false when the spot works in any direction but the wind is weak', () => {
    expect(isFiringNow(10, 270, [])).toBe(false)
  })
})

describe('isFiringNow — the 15kn bar', () => {
  // Same bar as the rest of the app: speedTier(kn)>0 is 15, which is what the
  // good-days badge counts, so bubble and badge cannot disagree.
  const DIRS = [0, 45, 225, 270, 315]

  it('does not fire below the rideable threshold', () => {
    expect(isFiringNow(14, 270, DIRS)).toBe(false)
    expect(isFiringNow(9, 270, DIRS)).toBe(false)
  })

  it('fires from 15kn', () => {
    expect(isFiringNow(15, 270, DIRS)).toBe(true)
    expect(isFiringNow(25, 270, DIRS)).toBe(true)
  })

  it('does not fire on the wrong direction however strong', () => {
    expect(isFiringNow(35, 135, DIRS)).toBe(false)
  })

  it('treats an unknown direction as not firing', () => {
    // A false "firing" bubble is the one that costs someone a drive.
    expect(isFiringNow(30, null, DIRS)).toBe(false)
  })

  it('fires in any direction for a spot with no listed dirs', () => {
    expect(isFiringNow(20, 135, [])).toBe(true)
  })

  it('exports the threshold rather than hiding a magic number', () => {
    expect(FIRING_MIN_KN).toBe(15)
  })
})

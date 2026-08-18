import { describe, it, expect } from 'vitest'
import { providerFromUrl } from '../../supabase/functions/_shared/providers.ts'

describe('providerFromUrl', () => {
  it('reads a weatherlink embeddable-page uuid', () => {
    expect(providerFromUrl('https://www.weatherlink.com/embeddablePage/show/87ca27e8616443678fffe486311370ee/signature'))
      .toEqual({ provider: 'weatherlink', stationId: '87ca27e8616443678fffe486311370ee' })
  })

  it('reads a holfuy station id from either URL shape', () => {
    expect(providerFromUrl('https://api.holfuy.com/live/?s=101&m=JSON'))
      .toEqual({ provider: 'holfuy', stationId: '101' })
    expect(providerFromUrl('https://holfuy.com/en/weather/101'))
      .toEqual({ provider: 'holfuy', stationId: '101' })
  })

  it('reads a pioupiou id from the api and openwindmap shapes', () => {
    expect(providerFromUrl('https://api.pioupiou.fr/v1/live/1234'))
      .toEqual({ provider: 'pioupiou', stationId: '1234' })
    expect(providerFromUrl('https://www.openwindmap.org/PP-1234'))
      .toEqual({ provider: 'pioupiou', stationId: '1234' })
  })

  it('refuses lookalike hosts and non-provider URLs', () => {
    expect(providerFromUrl('https://weatherlink.com.attacker.example/embeddablePage/show/abc/signature')).toBeNull()
    expect(providerFromUrl('https://notholfuy.com/en/weather/101')).toBeNull()
    expect(providerFromUrl('https://www.sycod.be/nl/meteo')).toBeNull()
    expect(providerFromUrl('javascript:alert(1)')).toBeNull()
    expect(providerFromUrl('')).toBeNull()
  })
})

import { toLiveWindFrom } from '../../supabase/functions/_shared/providers.ts'

const NOW = new Date('2026-08-18T08:40:00Z')

// Captured: weatherlink.com/embeddablePage/summaryData/87ca27e8... (Sycod)
const weatherlink = {
  ownerName: 'Sycod',
  lastReceived: Date.parse('2026-08-18T08:38:48Z'),
  currConditionValues: [
    { displayName: 'Wind Speed',             value: 25,  convertedValue: 22, unitLabel: 'knots' },
    { displayName: 'Wind Direction',         value: 251, convertedValue: 5648, unitLabel: '' },
    { displayName: '10 Min High Wind Speed', value: 28,  convertedValue: 24, unitLabel: 'knots' },
  ],
}

// Captured: api.holfuy.com/live/?s=101&m=JSON — speed/gust in km/h
const holfuy = {
  stationId: 101, stationName: 'TestStation', dateTime: '2026-08-18 08:38:00',
  wind: { speed: 40.7, gust: 51.9, min: 20, unit: 'km/h', direction: 268 },
}

describe('toLiveWindFrom', () => {
  it('takes weatherlink speed from convertedValue and direction from value', () => {
    const lw = toLiveWindFrom('weatherlink', '87ca27e8', weatherlink, NOW)!
    expect(lw.speedKn).toBe(22)      // NOT 25 — value is mph, convertedValue is knots
    expect(lw.dirDeg).toBe(251)      // NOT 5648 — convertedValue is meaningless here
    expect(lw.gustKn).toBe(24)
    expect(lw.stationName).toBe('Sycod')
    expect(lw.ageMin).toBe(1)
  })

  it('converts holfuy km/h to knots', () => {
    const lw = toLiveWindFrom('holfuy', '101', holfuy, NOW)!
    expect(lw.speedKn).toBe(22)      // 40.7 km/h
    expect(lw.gustKn).toBe(28)       // 51.9 km/h
    expect(lw.dirDeg).toBe(268)
  })

  it('converts pioupiou m/s to knots and reads its nested shape', () => {
    const pioupiou = { data: { id: 1234, meta: { name: 'Zeebrugge' },
      measurements: { date: '2026-08-18T08:38:00Z', wind_speed_avg: 11.3, wind_speed_max: 14.4, wind_heading: 251 } } }
    const lw = toLiveWindFrom('pioupiou', '1234', pioupiou, NOW)!
    expect(lw.speedKn).toBe(22)      // 11.3 m/s
    expect(lw.gustKn).toBe(28)       // 14.4 m/s
    expect(lw.stationName).toBe('Zeebrugge')
  })

  it('rejects a stale reading and a future one', () => {
    const stale = { ...weatherlink, lastReceived: Date.parse('2026-08-18T08:00:00Z') } // 40 min
    expect(toLiveWindFrom('weatherlink', 'x', stale, NOW)).toBeNull()
    const future = { ...weatherlink, lastReceived: Date.parse('2026-08-18T08:50:00Z') } // +10 min
    expect(toLiveWindFrom('weatherlink', 'x', future, NOW)).toBeNull()
  })

  it('returns null rather than throwing on junk', () => {
    expect(toLiveWindFrom('holfuy', '1', null, NOW)).toBeNull()
    expect(toLiveWindFrom('holfuy', '1', {}, NOW)).toBeNull()
    expect(toLiveWindFrom('weatherlink', '1', { currConditionValues: [] }, NOW)).toBeNull()
  })
})

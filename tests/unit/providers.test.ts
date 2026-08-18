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

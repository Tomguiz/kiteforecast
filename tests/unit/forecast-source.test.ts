import { describe, it, expect } from 'vitest'
import {
  toWmoCode, localHourKey, overlayStormglass, fetchForecastBundle, trimDays,
  stormglassUrl, openMeteoForecastUrl, openMeteoMarineUrl, QuotaGuard,
  STORMGLASS_PARAMS, FORECAST_DAYS,
} from '../../supabase/functions/_shared/forecast-source.ts'
import { fetchSharedForecast } from '../../supabase/functions/_shared/forecast-client.ts'

// The forecast now comes from two upstreams laid over one another: Stormglass
// for the numbers riders decide on, Open-Meteo for the calendar underneath and
// for the outlook past Stormglass's horizon. These tests pin the seam.

// An Open-Meteo-shaped scaffold: `days` days of light wind, local clock UTC+2.
function scaffold(days = 16, offset = 7200) {
  const time: string[] = [], ws: number[] = [], wg: number[] = [], wd: number[] = [], t2: number[] = [], code: number[] = []
  const daily = { time: [] as string[], weather_code: [] as number[], temperature_2m_max: [] as number[],
                  temperature_2m_min: [] as number[], windgusts_10m_max: [] as number[], sunrise: [] as string[], sunset: [] as string[] }
  for (let d = 0; d < days; d++) {
    const day = `2026-09-${String(4 + d).padStart(2, '0')}`
    daily.time.push(day); daily.weather_code.push(1); daily.temperature_2m_max.push(20); daily.temperature_2m_min.push(14)
    daily.windgusts_10m_max.push(4); daily.sunrise.push(`${day}T06:50`); daily.sunset.push(`${day}T20:15`)
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, '0')}:00`)
      ws.push(3); wg.push(4); wd.push(250); t2.push(17); code.push(1)
    }
  }
  return {
    latitude: 51.36, longitude: 3.31, timezone: 'Europe/Brussels', utc_offset_seconds: offset,
    hourly: { time, windspeed_10m: ws, windgusts_10m: wg, winddirection_10m: wd, temperature_2m: t2, weather_code: code },
    daily,
  }
}

// Stormglass hours: UTC, one object per hour, values keyed by source.
function sgHour(utc: string, v: Partial<Record<string, number | null>>) {
  const o: any = { time: utc }
  for (const [k, val] of Object.entries(v)) o[k] = { sg: val }
  return o
}

describe('the weather picture derived from cloud and rain', () => {
  it('is dry and clear to overcast on cloud cover alone', () => {
    expect(toWmoCode(0, 0, 15)).toBe(0)
    expect(toWmoCode(30, 0, 15)).toBe(1)
    expect(toWmoCode(60, 0, 15)).toBe(2)
    expect(toWmoCode(95, 0, 15)).toBe(3)
  })
  it('counts as rain from a tenth of a millimetre — the rideability rule reads code >= 51', () => {
    expect(toWmoCode(80, 0.05, 15)).toBeLessThan(51)
    expect(toWmoCode(80, 0.2, 15)).toBe(51)
    expect(toWmoCode(80, 1, 15)).toBe(61)
    expect(toWmoCode(80, 4, 15)).toBe(63)
    expect(toWmoCode(80, 9, 15)).toBe(65)
  })
  it('turns to snow at freezing', () => {
    expect(toWmoCode(80, 1, -1)).toBe(71)
    expect(toWmoCode(80, 4, 0)).toBe(73)
    expect(toWmoCode(80, 9, -3)).toBe(75)
  })
  it('treats missing values as dry and clear rather than throwing', () => {
    expect(toWmoCode(null, null, null)).toBe(0)
  })
})

describe('lining a UTC hour up with the spot clock', () => {
  it('shifts by the offset Open-Meteo used', () => {
    expect(localHourKey('2026-09-04T12:00:00+00:00', 7200)).toBe('2026-09-04T14:00')
    expect(localHourKey('2026-09-04T23:00:00+00:00', 7200)).toBe('2026-09-05T01:00')
    expect(localHourKey('2026-09-04T02:00:00+00:00', -18000)).toBe('2026-09-03T21:00')
  })
  it('gives nothing back for a timestamp it cannot read', () => {
    expect(localHourKey('not a time', 0)).toBeNull()
  })
})

describe('laying Stormglass over the Open-Meteo scaffold', () => {
  it('replaces wind, gusts, direction, temperature and the weather code for the hours it has', () => {
    const wx = scaffold()
    const sg = [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9.5, gust: 12.1, windDirection: 300, airTemperature: 19.2, cloudCover: 90, precipitation: 1.2 })]
    const { wx: out, covered } = overlayStormglass(wx, null, sg, 'sg')
    const i = out.hourly.time.indexOf('2026-09-04T14:00')
    expect(covered).toBe(1)
    expect(out.hourly.windspeed_10m[i]).toBe(9.5)
    expect(out.hourly.windgusts_10m[i]).toBe(12.1)
    expect(out.hourly.winddirection_10m[i]).toBe(300)
    expect(out.hourly.temperature_2m[i]).toBe(19.2)
    expect(out.hourly.weather_code[i]).toBe(61)
    // The hour before is untouched — a gap in Stormglass never becomes a hole.
    expect(out.hourly.windspeed_10m[i - 1]).toBe(3)
    expect(out.provider).toEqual({ name: 'stormglass', source: 'sg', hours: 1, through: '2026-09-04T14:00' })
  })

  it('does not touch the input', () => {
    const wx = scaffold()
    overlayStormglass(wx, null, [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9.5 })], 'sg')
    expect(wx.hourly.windspeed_10m[14]).toBe(3)
    expect((wx as any).provider).toBeUndefined()
  })

  it('redoes the daily summaries from the merged hours', () => {
    const wx = scaffold()
    const sg = [
      sgHour('2026-09-04T10:00:00+00:00', { windSpeed: 9, gust: 15, airTemperature: 23, cloudCover: 10, precipitation: 0 }),
      sgHour('2026-09-04T11:00:00+00:00', { windSpeed: 9, gust: 13, airTemperature: 24.5, cloudCover: 95, precipitation: 3 }),
    ]
    const { wx: out } = overlayStormglass(wx, null, sg, 'sg')
    expect(out.daily.windgusts_10m_max[0]).toBe(15)
    expect(out.daily.temperature_2m_max[0]).toBe(24.5)
    expect(out.daily.temperature_2m_min[0]).toBe(17)   // the untouched hours still count
    expect(out.daily.weather_code[0]).toBe(63)
    expect(out.daily.windgusts_10m_max[1]).toBe(4)     // a day Stormglass did not reach is left alone
    expect(out.daily.sunrise[0]).toBe('2026-09-04T06:50')
  })

  it('skips an hour with no wind in it rather than writing zeros', () => {
    const wx = scaffold()
    const sg = [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: null, gust: 12 })]
    const { wx: out, covered } = overlayStormglass(wx, null, sg, 'sg')
    expect(covered).toBe(0)
    expect(out.hourly.windgusts_10m[14]).toBe(4)
    expect(out.provider.name).toBe('open-meteo')
  })

  it('ignores hours outside the scaffold — the horizon is Open-Meteo\'s calendar', () => {
    const wx = scaffold(2)
    const sg = [sgHour('2026-09-20T12:00:00+00:00', { windSpeed: 9 })]
    expect(overlayStormglass(wx, null, sg, 'sg').covered).toBe(0)
  })

  it('writes waves into the marine block, and builds one when Open-Meteo had none', () => {
    const wx = scaffold(1)
    const sg = [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9, waveHeight: 1.4, wavePeriod: 6, waveDirection: 310 })]
    const { marine } = overlayStormglass(wx, null, sg, 'sg')
    expect(marine.hourly.time).toEqual(wx.hourly.time)
    expect(marine.hourly.wave_height[14]).toBe(1.4)
    expect(marine.hourly.wave_period[14]).toBe(6)
    expect(marine.hourly.wave_direction[14]).toBe(310)
    expect(marine.hourly.wave_height[13]).toBeNull()
  })

  it('leaves an inland spot without a marine block', () => {
    const wx = scaffold(1)
    const sg = [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9, waveHeight: null })]
    expect(overlayStormglass(wx, null, sg, 'sg').marine).toBeNull()
  })

  it('reads a value however the source keyed it', () => {
    // With no source filter Stormglass answers { windSpeed: { sg, icon, noaa } };
    // the first is the one asked for. A bare number is accepted too.
    const wx = scaffold(1)
    const sg = [{ time: '2026-09-04T12:00:00+00:00', windSpeed: { icon: 7, noaa: 6 }, gust: 11 }]
    const { wx: out } = overlayStormglass(wx, null, sg as any, 'icon')
    expect(out.hourly.windspeed_10m[14]).toBe(7)
    expect(out.hourly.windgusts_10m[14]).toBe(11)
  })
})

describe('the requests', () => {
  it('asks Stormglass for everything the app draws, with the key out of the URL', () => {
    const u = new URL(stormglassUrl(51.3627, 3.3062))
    expect(u.hostname).toBe('api.stormglass.io')
    expect(u.pathname).toBe('/v2/weather/point')
    expect(u.searchParams.get('source')).toBe('sg')
    expect(u.searchParams.get('params')!.split(',')).toEqual(STORMGLASS_PARAMS)
    for (const p of ['windSpeed', 'gust', 'windDirection', 'airTemperature', 'cloudCover', 'precipitation', 'waveHeight'])
      expect(STORMGLASS_PARAMS).toContain(p)
    expect(u.search).not.toMatch(/key|token/i)
    // No start/end: Stormglass's default is its full ten-day horizon.
    expect(u.searchParams.has('start')).toBe(false)
  })
  it('still asks Open-Meteo for the sea cell and the full 16-day window', () => {
    for (const url of [openMeteoForecastUrl(1, 2), openMeteoMarineUrl(1, 2)]) {
      const u = new URL(url)
      expect(u.searchParams.get('cell_selection')).toBe('sea')
      expect(u.searchParams.get('forecast_days')).toBe(String(FORECAST_DAYS))
    }
    expect(FORECAST_DAYS).toBe(16)
  })
})

describe('the daily quota', () => {
  it('stops asking once the reserve is reached, and forgets at midnight', () => {
    const q = new QuotaGuard(5)
    const d1 = new Date('2026-09-04T10:00:00Z')
    expect(q.canSpend(d1)).toBe(true)
    q.note({ dailyQuota: 500, requestCount: 494 }, d1)
    expect(q.canSpend(d1)).toBe(true)
    q.note({ dailyQuota: 500, requestCount: 495 }, d1)
    expect(q.canSpend(d1)).toBe(false)
    expect(q.canSpend(new Date('2026-09-05T00:01:00Z'))).toBe(true)
  })
  it('a 402 ends the day', () => {
    const q = new QuotaGuard()
    const d = new Date('2026-09-04T10:00:00Z')
    q.markExhausted(d)
    expect(q.canSpend(d)).toBe(false)
    expect(q.canSpend(new Date('2026-09-05T10:00:00Z'))).toBe(true)
  })
})

// A fetch double keyed by host. Each entry is a status + body, or a throw.
function fakeFetch(routes: Record<string, { status?: number; body?: unknown; throws?: string }>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    // Match the host exactly, or a path fragment: 'api.open-meteo.com' must
    // not also answer for 'marine-api.open-meteo.com'.
    const u = new URL(url)
    const r = Object.entries(routes).find(([k]) => u.hostname === k || (k.startsWith('/') && u.pathname.includes(k)))?.[1]
    if (!r) throw new TypeError(`no route for ${url}`)
    if (r.throws) throw new TypeError(r.throws)
    const status = r.status ?? 200
    return new Response(JSON.stringify(r.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fn, calls }
}

describe('fetching the bundle', () => {
  const sgBody = {
    hours: [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9.5, gust: 12, windDirection: 300, airTemperature: 19, cloudCover: 20, precipitation: 0 })],
    meta: { cost: 1, dailyQuota: 500, requestCount: 12 },
  }

  it('is Stormglass on Open-Meteo\'s calendar when both answer', async () => {
    const { fn, calls } = fakeFetch({
      'api.open-meteo.com': { body: scaffold() },
      'marine-api.open-meteo.com': { body: { hourly: { time: scaffold().hourly.time, wave_height: [], wave_period: [], wave_direction: [] } } },
      'api.stormglass.io': { body: sgBody },
    })
    const q = new QuotaGuard()
    const b = await fetchForecastBundle(51.36, 3.31, { stormglassKey: 'k', fetchFn: fn, quota: q })
    expect(b.provider.name).toBe('stormglass')
    expect(b.wx.hourly.windspeed_10m[14]).toBe(9.5)
    expect(b.wx.daily.sunrise[0]).toBe('2026-09-04T06:50')
    expect(b.wx.hourly.time).toHaveLength(16 * 24)
    const sgCall = calls.find(c => c.url.includes('stormglass'))!
    expect((sgCall.init!.headers as any).Authorization).toBe('k')
    expect(q.remaining).toBe(488)
  })

  it('is Open-Meteo alone, and says why, when Stormglass fails', async () => {
    for (const [route, reason] of [
      [{ status: 500, body: {} }, 'HTTP 500'],
      [{ throws: 'connection refused' }, 'unreachable: connection refused'],
      [{ body: { nope: true } }, 'malformed response'],
    ] as const) {
      const { fn } = fakeFetch({ 'api.open-meteo.com': { body: scaffold() }, 'marine-api.open-meteo.com': { status: 404 }, 'api.stormglass.io': route })
      const b = await fetchForecastBundle(51.36, 3.31, { stormglassKey: 'k', fetchFn: fn })
      expect(b.provider).toEqual({ name: 'open-meteo', reason })
      expect(b.wx.provider).toEqual({ name: 'open-meteo', reason })
      expect(b.wx.hourly.windspeed_10m[14]).toBe(3)
      expect(b.marine).toBeNull()
    }
  })

  it('a 402 spends nothing more that day', async () => {
    const q = new QuotaGuard()
    const { fn, calls } = fakeFetch({ 'api.open-meteo.com': { body: scaffold() }, 'marine-api.open-meteo.com': { status: 404 }, 'api.stormglass.io': { status: 402, body: { errors: { key: 'quota' } } } })
    const a = await fetchForecastBundle(51.36, 3.31, { stormglassKey: 'k', fetchFn: fn, quota: q, now: new Date('2026-09-04T10:00:00Z') })
    expect(a.provider.reason).toBe('HTTP 402 (quota)')
    const b = await fetchForecastBundle(51.36, 3.31, { stormglassKey: 'k', fetchFn: fn, quota: q, now: new Date('2026-09-04T11:00:00Z') })
    expect(b.provider.reason).toBe('quota reserve reached')
    expect(calls.filter(c => c.url.includes('stormglass'))).toHaveLength(1)
  })

  it('never calls Stormglass without a key', async () => {
    const { fn, calls } = fakeFetch({ 'api.open-meteo.com': { body: scaffold() }, 'marine-api.open-meteo.com': { status: 404 } })
    const b = await fetchForecastBundle(51.36, 3.31, { fetchFn: fn })
    expect(b.provider).toEqual({ name: 'open-meteo', reason: 'no STORMGLASS_KEY' })
    expect(calls.some(c => c.url.includes('stormglass'))).toBe(false)
  })

  it('still fails when Open-Meteo fails — there is no calendar to lay Stormglass on', async () => {
    const { fn } = fakeFetch({ 'api.open-meteo.com': { body: { error: true, reason: 'nope' } }, 'marine-api.open-meteo.com': { status: 404 }, 'api.stormglass.io': { body: sgBody } })
    await expect(fetchForecastBundle(51.36, 3.31, { stormglassKey: 'k', fetchFn: fn })).rejects.toThrow('nope')
  })
})

describe('trimming a row for the jobs', () => {
  it('keeps the first N days of both series and nothing else', () => {
    const out = trimDays(scaffold(16), 10)
    expect(out.daily.time).toHaveLength(10)
    expect(out.daily.sunrise).toHaveLength(10)
    expect(out.hourly.time).toHaveLength(240)
    expect(out.hourly.time.at(-1)).toBe('2026-09-13T23:00')
    expect(out.utc_offset_seconds).toBe(7200)
  })
})

describe('the jobs read the shared row', () => {
  it('go to the forecast function with the service key, trimmed to their window', async () => {
    const { fn, calls } = fakeFetch({ '/functions/v1/forecast': { body: { wx: scaffold(16), source: 'cache' } } })
    const wx = await fetchSharedForecast(51.36, 3.31, 7, { fetchFn: fn, functionUrl: 'https://x.supabase.co', serviceKey: 'svc', stormglassKey: null })
    expect(wx.daily.time).toHaveLength(7)
    expect(calls).toHaveLength(1)
    expect((calls[0].init!.headers as any).Authorization).toBe('Bearer svc')
    expect(calls[0].url).toContain('lat=51.36&lon=3.31')
  })

  it('fetch upstream themselves when the function is down', async () => {
    const { fn, calls } = fakeFetch({
      '/functions/v1/forecast': { status: 503 },
      'api.open-meteo.com': { body: scaffold() }, 'marine-api.open-meteo.com': { status: 404 },
      'api.stormglass.io': { body: { hours: [sgHour('2026-09-04T12:00:00+00:00', { windSpeed: 9.5 })], meta: {} } },
    })
    const wx = await fetchSharedForecast(51.36, 3.31, 10, { fetchFn: fn, functionUrl: 'https://x.supabase.co', serviceKey: 'svc', stormglassKey: 'k' })
    expect(wx.daily.time).toHaveLength(10)
    expect(wx.hourly.windspeed_10m[14]).toBe(9.5)
    expect(calls.some(c => c.url.includes('stormglass'))).toBe(true)
  })
})
